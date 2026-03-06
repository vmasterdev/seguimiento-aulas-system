import { promises as fs, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import {
  normalizeProgramKey,
  normalizeTeacherId,
  OutboxExportSchema,
  OutboxGenerateSchema,
  OutboxSendSchema,
} from '@seguimiento/shared';
import type { Period } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';
import { isCourseExcludedFromReview } from '../common/review-eligibility.util';

type GeneratePayload = {
  periodCode: string;
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2';
  audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
  teacherId?: string;
};

type SendPayload = {
  ids?: string[];
  periodCode?: string;
  phase?: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2';
  audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
  status?: 'DRAFT' | 'EXPORTED' | 'SENT_MANUAL' | 'SENT_AUTO';
  limit?: number;
  forceTo?: string;
  dryRun?: boolean;
};

type OutboxTrackingQuery = {
  periodCode?: string;
  phase?: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2';
  audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
  status?: string;
  search?: string;
  page?: string;
  pageSize?: string;
};

type SendCandidate = {
  id: string;
  originalTo: string;
  to: string;
  cc?: string;
  recipientName: string;
  fingerprint: string;
  subject: string;
  htmlBody: string;
  audience: string;
  periodCode: string;
  periodId: string;
  phase: string;
  moment: string;
  teacherId?: string;
  coordinatorId?: string;
};

type SendAuditLogDetail = {
  to?: string;
  error?: string;
  messageId?: string | null;
  deliveryMode?: 'SMTP' | 'OUTLOOK';
  forceToApplied?: boolean;
  recipientName?: string;
  fingerprint?: string;
};

const OutboxResendUpdatedSchema = z.object({
  id: z.string().trim().min(1),
  forceTo: z.string().trim().email().optional(),
  dryRun: z.coerce.boolean().optional().default(false),
});

const OutboxResendByCourseSchema = z.object({
  courseId: z.string().trim().min(1),
  phase: z.enum(['ALISTAMIENTO', 'EJECUCION']).default('ALISTAMIENTO'),
  forceTo: z.string().trim().email().optional(),
  dryRun: z.coerce.boolean().optional().default(false),
});

const SUPPORTED_MOMENTS = ['MD1', 'MD2', '1', 'INTER', 'RM1', 'RM2'] as const;

function sanitizeForFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function toEml(payload: { to: string; cc?: string; subject: string; html: string }) {
  const headers = [
    `To: ${payload.to}`,
    payload.cc ? `Cc: ${payload.cc}` : null,
    `Subject: ${payload.subject.replace(/[\r\n]+/g, ' ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  return `${headers}\n${payload.html}`;
}

function parseEnvBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'si', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMomentLabel(value: string): string {
  const normalized = (value || '').trim().toUpperCase();
  if (normalized === 'MD1') return 'M1';
  if (normalized === 'MD2') return 'M2';
  if (normalized === '1') return 'RYC';
  return value || '-';
}

type CourseCoordinationRow = {
  teacherName: string;
  nrc: string;
  subject: string;
  moment: string;
  status: string;
  template: string;
  score: number | null;
  coordinationKey: string;
  coordinationName: string;
};

const TEACHER_BOOKING_URL =
  'https://outlook.office.com/book/CampusVirtual1@uniminuto.edu/s/y4TJLlHIjkmqPphvip1Piw2?ismsaljsauthenabled';
const CAMPUS_VIRTUAL_COMMUNICADO_URL = 'https://comunicado2026.netlify.app/';

@Injectable()
export class OutboxService {
  private readonly templateStyleCache = new Map<string, string>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private resolveOutboxDir() {
    const raw = process.env.OUTBOX_DIR ?? '../../data/outbox';
    return path.resolve(process.cwd(), raw);
  }

  private resolveReportTemplatesDir() {
    const raw = process.env.REPORT_TEMPLATES_DIR ?? '../../ejemplo_reportes';
    const primary = path.resolve(process.cwd(), raw);
    if (existsSync(primary)) return primary;

    const fallback = path.resolve(process.cwd(), 'ejemplo_reportes');
    if (existsSync(fallback)) return fallback;

    return primary;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private isTemporalChecklistCourse(rawJson: unknown): boolean {
    const root = this.asRecord(rawJson);
    const marker = this.asRecord(root.specialChecklistQueue);
    return marker.active === true;
  }

  private hasPhaseScore(
    evaluations: Array<{ phase?: string | null; score?: number | null }> | undefined,
    phase: 'ALISTAMIENTO' | 'EJECUCION',
  ): boolean {
    if (!Array.isArray(evaluations) || !evaluations.length) return false;
    const normalizedPhase = phase.toUpperCase();

    return evaluations.some((evaluation) => {
      const evaluationPhase = String(evaluation?.phase ?? '').trim().toUpperCase();
      if (evaluationPhase && evaluationPhase !== normalizedPhase) return false;
      return evaluation?.score != null;
    });
  }

  private shouldIncludeTeacherReportCourse(
    input: {
      rawJson: unknown;
      templateDeclared: string | null | undefined;
      moodleCheck:
        | {
            status?: string | null;
            detectedTemplate?: string | null;
            errorCode?: string | null;
            moodleCourseUrl?: string | null;
            moodleCourseId?: string | null;
          }
        | null
        | undefined;
      evaluations?: Array<{ phase?: string | null; score?: number | null }>;
      phase: 'ALISTAMIENTO' | 'EJECUCION';
    },
  ): boolean {
    const excluded = isCourseExcludedFromReview({
      rawJson: input.rawJson,
      template: input.moodleCheck?.detectedTemplate ?? input.templateDeclared ?? 'UNKNOWN',
      moodleCheck: input.moodleCheck ?? null,
    });
    if (!excluded) return true;

    // Permite incluir NRC en cola temporal cuando ya tienen calificacion guardada en la fase.
    return this.isTemporalChecklistCourse(input.rawJson) && this.hasPhaseScore(input.evaluations, input.phase);
  }

  private loadTemplateStyle(fileName: string): string {
    const cached = this.templateStyleCache.get(fileName);
    if (cached !== undefined) return cached;

    try {
      const absolutePath = path.join(this.resolveReportTemplatesDir(), fileName);
      const template = readFileSync(absolutePath, 'utf8');
      const styleMatch = template.match(/<style[^>]*>[\s\S]*?<\/style>/i);
      const style = styleMatch?.[0] ?? '';
      this.templateStyleCache.set(fileName, style);
      return style;
    } catch {
      this.templateStyleCache.set(fileName, '');
      return '';
    }
  }

  private buildTeacherHtml(options: {
    teacherName: string;
    phase: string;
    moment: string;
    periodCode: string;
    rows: Array<{
      nrc: string;
      reviewedNrc: string;
      moment: string;
      resultType: 'REVISADO' | 'REPLICADO';
      subject: string;
      program: string;
      template: string;
      score: number | null;
      observations: string;
    }>;
  }) {
    const templateStyle =
      this.loadTemplateStyle('reporte_docente_albeiro_m1_ryc_alistamiento_preview.html') ||
      this.loadTemplateStyle('ejemplo Docentes - Profesores.html');
    const phaseUpper = options.phase.toUpperCase();
    const phaseLabel = options.phase === 'ALISTAMIENTO' ? 'Alistamiento' : 'Ejecucion';
    const scoreScale = phaseUpper === 'ALISTAMIENTO' ? 50 : 100;
    const selectedCount = options.rows.filter((row) => row.resultType === 'REVISADO').length;
    const replicatedCount = options.rows.filter((row) => row.resultType === 'REPLICADO').length;
    const scoredRows = options.rows.filter((row) => row.score != null);
    const average = scoredRows.length
      ? scoredRows.reduce((acc, row) => acc + (row.score ?? 0), 0) / scoredRows.length
      : null;
    const byBand = {
      EXCELENTE: 0,
      BUENO: 0,
      ACEPTABLE: 0,
      INSATISFACTORIO: 0,
    } as const;
    const bandCounter = { ...byBand };
    for (const row of options.rows) {
      const band = this.toScoreBandForPhase(row.score, phaseUpper);
      bandCounter[band] += 1;
    }
    const asPercent = (count: number) =>
      options.rows.length ? Number(((count / options.rows.length) * 100).toFixed(1)) : 0;
    const scoreSeg = {
      EXCELENTE: asPercent(bandCounter.EXCELENTE),
      BUENO: asPercent(bandCounter.BUENO),
      ACEPTABLE: asPercent(bandCounter.ACEPTABLE),
      INSATISFACTORIO: asPercent(bandCounter.INSATISFACTORIO),
    };
    const rowsHtml = options.rows
      .map(
        (row) => {
          const band = this.toScoreBandForPhase(row.score, phaseUpper);
          const bandLabel =
            band === 'EXCELENTE'
              ? 'Excelente'
              : band === 'BUENO'
                ? 'Bueno'
                : band === 'ACEPTABLE'
                  ? 'Aceptable'
                  : 'Insatisfactorio';
          const scoreLabel = this.formatScoreForPhase(row.score, phaseUpper);
          const resultBadgeClass = row.resultType === 'REPLICADO' ? 'badge-secondary' : 'badge-primary';
          return [
            '<div class="course-card">',
            '<div class="course-card-head">',
            `<div class="course-card-title">NRC ${escapeHtml(row.nrc)}</div>`,
            `<span class="result-badge ${resultBadgeClass}">${escapeHtml(row.resultType)}</span>`,
            '</div>',
            `<div class="course-card-score">${escapeHtml(scoreLabel)} | ${escapeHtml(bandLabel)}</div>`,
            '<table class="course-kv" role="presentation" cellspacing="0" cellpadding="0" border="0">',
            `<tr><td class="kv-key">Momento</td><td class="kv-val">${escapeHtml(formatMomentLabel(row.moment))} (${escapeHtml(row.moment)})</td></tr>`,
            `<tr><td class="kv-key">NRC revisado</td><td class="kv-val">${escapeHtml(row.reviewedNrc)}</td></tr>`,
            `<tr><td class="kv-key">Asignatura</td><td class="kv-val">${escapeHtml(row.subject)}</td></tr>`,
            `<tr><td class="kv-key">Programa</td><td class="kv-val">${escapeHtml(row.program)}</td></tr>`,
            `<tr><td class="kv-key">Tipo aula</td><td class="kv-val">${escapeHtml(row.template)}</td></tr>`,
            `<tr><td class="kv-key">Observaciones</td><td class="kv-val">${escapeHtml(row.observations || 'Sin observaciones registradas.')}</td></tr>`,
            '</table>',
            '</div>',
          ].join('');
        },
      )
      .join('');
    const extraStyle = [
      '<style>',
      '.course-cards{display:block;}',
      '.course-card{border:1px solid #d4d7dd;border-radius:12px;background:#ffffff;padding:12px 12px 10px 12px;margin:0 0 10px 0;}',
      '.course-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;}',
      '.course-card-title{font-size:14px;font-weight:800;color:#002b5c;}',
      '.course-card-score{font-size:12px;font-weight:700;color:#25364d;margin-bottom:8px;}',
      '.result-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;}',
      '.badge-primary{background:#dbeafe;color:#0b3b73;border:1px solid #b7d3fb;}',
      '.badge-secondary{background:#ffedd5;color:#7a2e0d;border:1px solid #f7cfad;}',
      '.course-kv{width:100%;border-collapse:collapse;table-layout:fixed;}',
      '.course-kv .kv-key{width:32%;font-size:11px;color:#5c6c82;text-transform:uppercase;letter-spacing:.25px;padding:6px 8px 6px 0;vertical-align:top;border-top:1px solid #e4e9f1;}',
      '.course-kv .kv-val{width:68%;font-size:12px;color:#1f2937;padding:6px 0;border-top:1px solid #e4e9f1;vertical-align:top;}',
      '.course-kv tr:first-child .kv-key,.course-kv tr:first-child .kv-val{border-top:none;}',
      '@media only screen and (max-width:640px){.shell{margin:12px auto!important;border-radius:10px!important;}.body-wrap{padding:14px!important;}.hero{padding:14px!important;}.course-card{padding:10px!important;}.course-card-title{font-size:13px!important;}.course-kv .kv-key,.course-kv .kv-val{display:block!important;width:100%!important;padding:4px 0!important;}.course-kv .kv-key{border-top:none!important;padding-top:8px!important;}}',
      '</style>',
    ].join('');
    const summaryNotes = [
      `<li><strong>${escapeHtml(formatMomentLabel(options.moment))}:</strong> ${selectedCount} NRC revisado(s) base y ${replicatedCount} NRC replicado(s).</li>`,
      `<li><strong>Total reportado:</strong> ${options.rows.length} NRC en el correo.</li>`,
      phaseUpper === 'ALISTAMIENTO'
        ? `<li><strong>Escala de fase:</strong> esta fase se califica sobre ${scoreScale} puntos (${scoreScale}/${scoreScale} = Excelente).</li>`
        : `<li><strong>Escala de fase:</strong> esta fase se califica sobre ${scoreScale} puntos.</li>`,
    ].join('');

    return [
      '<html><head>',
      templateStyle,
      extraStyle,
      '</head><body>',
      '<div class="shell"><div class="top-strip" style="background:#ffc300;background-image:linear-gradient(90deg,#ffc300 0%,#ffd95c 100%);"></div>',
      '<div class="hero" style="background:#002b5c;background-image:linear-gradient(120deg,#002b5c 0%,#0057a4 100%);color:#ffffff;">',
      '<h2 class="hero-title">Reporte de seguimiento - <span class="hero-highlight">Campus Virtual RCS</span></h2>',
      `<div class="hero-subtitle">Periodo ${escapeHtml(options.periodCode)} | Fase de ${escapeHtml(phaseLabel)} | Momentos: M1 (MD1) y RYC (1)</div>`,
      `<div class="hero-period-pill">Periodo reportado: ${escapeHtml(options.periodCode)}</div>`,
      '</div>',
      '<div class="body-wrap">',
      `<div class="period-banner">PERIODO REPORTADO: ${escapeHtml(options.periodCode)} | FASE: ${escapeHtml(options.phase)} | MOMENTO: ${escapeHtml(formatMomentLabel(options.moment))} (${escapeHtml(options.moment)})</div>`,
      '<div class="quick-access"><p class="quick-access-title">Acceso rapido</p><p class="quick-access-text">Antes de revisar el detalle, puedes consultar los criterios oficiales del seguimiento.</p><div class="quick-access-actions">',
      `<a class="cta-btn alt" href="${CAMPUS_VIRTUAL_COMMUNICADO_URL}" target="_blank" rel="noopener">Ver comunicado Campus Virtual</a>`,
      '</div></div>',
      `<p><strong>Cordial saludo, ${escapeHtml(options.teacherName)},</strong></p>`,
      `<p>Desde Campus Virtual compartimos el consolidado para el periodo ${escapeHtml(options.periodCode)}. A continuacion encontrara el detalle por NRC con su momento, NRC revisado base y NRC replicados.</p>`,
      '<div class="panel">',
      '<div class="section-title">Resumen de desempeno de sus aulas</div>',
      '<div class="kpi-grid">',
      '<div class="kpi">',
      '<div class="kpi-label">Aulas revisadas</div>',
      `<div class="kpi-value">${options.rows.length}</div>`,
      '</div>',
      '<div class="kpi">',
      '<div class="kpi-label">Promedio final</div>',
      `<div class="kpi-value">${average == null ? 'N/A' : average.toFixed(1)}</div>`,
      `<div class="kpi-meta">(0-${scoreScale})</div>`,
      '</div>',
      '<div class="kpi kpi-success">',
      '<div class="kpi-label">Excelente</div>',
      `<div class="kpi-value">${bandCounter.EXCELENTE}</div>`,
      `<div class="kpi-meta">${scoreSeg.EXCELENTE}%</div>`,
      '</div>',
      '<div class="kpi kpi-info">',
      '<div class="kpi-label">Bueno</div>',
      `<div class="kpi-value">${bandCounter.BUENO}</div>`,
      `<div class="kpi-meta">${scoreSeg.BUENO}%</div>`,
      '</div>',
      '<div class="kpi kpi-warning">',
      '<div class="kpi-label">Aceptable</div>',
      `<div class="kpi-value">${bandCounter.ACEPTABLE}</div>`,
      `<div class="kpi-meta">${scoreSeg.ACEPTABLE}%</div>`,
      '</div>',
      '<div class="kpi kpi-danger">',
      '<div class="kpi-label">Insatisfactorio</div>',
      `<div class="kpi-value">${bandCounter.INSATISFACTORIO}</div>`,
      `<div class="kpi-meta">${scoreSeg.INSATISFACTORIO}%</div>`,
      '</div>',
      '</div>',
      '<div class="score-bar-wrap"><p class="score-bar-title">Barra de desempeno (Excelente / Bueno / Aceptable / Insatisfactorio)</p>',
      '<div class="score-bar">',
      `<div class="score-seg seg-exc" style="width:${scoreSeg.EXCELENTE}%;">${scoreSeg.EXCELENTE > 0 ? `Excelente ${scoreSeg.EXCELENTE}%` : ''}</div>`,
      `<div class="score-seg seg-good" style="width:${scoreSeg.BUENO}%;">${scoreSeg.BUENO > 0 ? `Bueno ${scoreSeg.BUENO}%` : ''}</div>`,
      `<div class="score-seg seg-ok" style="width:${scoreSeg.ACEPTABLE}%;">${scoreSeg.ACEPTABLE > 0 ? `Aceptable ${scoreSeg.ACEPTABLE}%` : ''}</div>`,
      `<div class="score-seg seg-bad" style="width:${scoreSeg.INSATISFACTORIO}%;">${scoreSeg.INSATISFACTORIO > 0 ? `Insatisf. ${scoreSeg.INSATISFACTORIO}%` : ''}</div>`,
      '</div>',
      '<div class="score-legend">',
      `<span class="legend-item"><span class="legend-dot dot-exc"></span>Excelente: ${bandCounter.EXCELENTE} (${scoreSeg.EXCELENTE}%)</span>`,
      `<span class="legend-item"><span class="legend-dot dot-good"></span>Bueno: ${bandCounter.BUENO} (${scoreSeg.BUENO}%)</span>`,
      `<span class="legend-item"><span class="legend-dot dot-ok"></span>Aceptable: ${bandCounter.ACEPTABLE} (${scoreSeg.ACEPTABLE}%)</span>`,
      `<span class="legend-item"><span class="legend-dot dot-bad"></span>Insatisfactorio: ${bandCounter.INSATISFACTORIO} (${scoreSeg.INSATISFACTORIO}%)</span>`,
      '</div></div>',
      '</div>',
      '<div class="panel">',
      `<div class="section-title">Detalle por NRC - ${escapeHtml(formatMomentLabel(options.moment))} (${escapeHtml(options.moment)})</div>`,
      `<div class="course-cards">${rowsHtml}</div>`,
      '</div>',
      '<div class="panel panel-warm">',
      '<div class="section-title" style="color:#7a5b00;">Observaciones priorizadas para siguiente ciclo</div>',
      `<ul class="obs-list">${summaryNotes}</ul>`,
      '</div>',
      '<div class="action-panel">',
      '<p class="action-title">Acompanamiento</p>',
      '<p class="action-text">Si necesitas revisar este reporte por periodo y resolver dudas puntuales, agenda un espacio.</p>',
      '<div class="cta-wrap" style="margin-top:0;">',
      `<a class="cta-btn" href="${TEACHER_BOOKING_URL}" target="_blank" rel="noopener">Agendar llamada / videollamada</a>`,
      '</div>',
      '</div>',
      '<div style="margin-top:16px;text-align:center;color:#334155;font-size:13px;">Campus Virtual - Rectoria Centro Sur</div>',
      `<div class="report-footer">Generado el ${new Date().toISOString().slice(0, 10)} - Reporte automatico de seguimiento de aulas.</div>`,
      '</div></div>',
      '</body></html>',
    ].join('');
  }

  private buildCoordinatorHtml(options: {
    coordinatorName: string;
    programId: string;
    phase: string;
    moment: string;
    periodCode: string;
    uniqueTeachers: number;
    rows: Array<{
      teacherName: string;
      nrc: string;
      subject: string;
      moment: string;
      status: string;
      template: string;
      score: number | null;
    }>;
  }) {
    const templateStyle = this.loadTemplateStyle('ejemplo Programas - Coordinaciones.html');
    const rowsHtml = options.rows
      .map(
        (row) =>
          `<tr><td>${row.teacherName}</td><td>${row.nrc}</td><td>${row.subject}</td><td>${row.moment}</td><td>${row.status}</td><td>${row.template}</td><td class="t-center">${row.score ?? 'N/A'}</td></tr>`,
      )
      .join('');

    return [
      '<html><head>',
      templateStyle,
      '</head><body class="mail-bg">',
      '<div class="shell"><div class="top-strip"></div>',
      `<div class="hero"><h2 class="hero-title">Reporte por coordinacion academica - ${options.phase}</h2><div class="hero-subtitle">Periodo ${options.periodCode} | Momento ${options.moment}</div></div>`,
      '<div class="body-wrap">',
      `<p class="intro-note"><strong>Coordinador:</strong> ${options.coordinatorName}<br/><strong>Coordinacion:</strong> ${options.programId}<br/><strong>Total docentes:</strong> ${options.uniqueTeachers} | <strong>Total NRC:</strong> ${options.rows.length}</p>`,
      '<div class="panel">',
      '<div class="section-title">Detalle de aulas por docente</div>',
      '<div class="table-container">',
      '<table class="report-table">',
      '<thead><tr><th>Docente</th><th>NRC</th><th>Asignatura</th><th>Momento</th><th>Estado Moodle</th><th>Plantilla</th><th>Puntaje fase</th></tr></thead>',
      `<tbody>${rowsHtml}</tbody>`,
      '</table></div></div>',
      '<p class="note">Este correo fue generado por el sistema de seguimiento de aulas.</p>',
      '</div></div>',
      '</body></html>',
    ].join('');
  }

  private buildGlobalHtml(options: {
    phase: string;
    moment: string;
    periodCode: string;
    totalCourses: number;
    averageScore: number | null;
    excellent: number;
    good: number;
    acceptable: number;
    unsatisfactory: number;
    rows: Array<{
      coordination: string;
      total: number;
      average: number | null;
      excellent: number;
      good: number;
      acceptable: number;
      unsatisfactory: number;
    }>;
  }) {
    const templateStyle = this.loadTemplateStyle('ejemplo global .html');
    const averageLabel = options.averageScore == null ? 'N/A' : options.averageScore.toFixed(2);
    const rowsHtml = options.rows
      .map((row, idx) => {
        const background = idx % 2 === 0 ? '#ffffff' : '#f8fbff';
        return [
          `<tr style="background:${background};font-size:14px;">`,
          `<td style="padding:8px 12px;text-align:left;font-weight:600;color:#0057A4;">${row.coordination}</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.total}</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.average == null ? 'N/A' : row.average.toFixed(2)}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dcfce7;">${row.excellent}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dbeafe;">${row.good}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#ffedd5;">${row.acceptable}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#fee2e2;">${row.unsatisfactory}</td>`,
          '</tr>',
        ].join('');
      })
      .join('');

    return [
      '<html><head>',
      templateStyle,
      '</head><body class="global-theme">',
      `<span class="preheader">Informe global de seguimiento - ${options.moment} (${options.phase}).</span>`,
      "<div style='max-width:980px;margin:0 auto 24px auto;font-family:Segoe UI,Arial,sans-serif;'>",
      '<div style="background:linear-gradient(120deg,#002B5C 0%,#0057A4 100%);color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;border:1px solid #002449;">',
      '<div style="font-size:20px;font-weight:700;">Informe global - Coordinaciones académicas</div>',
      `<div style="font-size:12px;font-weight:400;margin-top:6px;color:#e6eaf2;">Periodo ${options.periodCode} | ${options.moment} | Fase ${options.phase}</div>`,
      '</div>',
      '<div style="border:1px solid #D4D7DD;border-top:none;border-radius:0 0 10px 10px;padding:20px;background:#f8fafc;">',
      '<div style="display:flex;flex-wrap:wrap;gap:12px;margin:12px 0 16px 0;">',
      '<div style="flex:1 1 180px;background:#ffffff;border:1px solid #D4D7DD;border-radius:12px;padding:14px 16px;box-shadow:0 2px 6px rgba(0,0,0,.05);">',
      '<div style="font-size:12px;color:#667;letter-spacing:.4px;text-transform:uppercase;">Aulas total</div>',
      `<div style="font-size:28px;font-weight:800;color:#002B5C;line-height:1.2;">${options.totalCourses}</div>`,
      '</div>',
      '<div style="flex:1 1 180px;background:#ffffff;border:1px solid #D4D7DD;border-radius:12px;padding:14px 16px;box-shadow:0 2px 6px rgba(0,0,0,.05);">',
      '<div style="font-size:12px;color:#667;letter-spacing:.4px;text-transform:uppercase;">Promedio</div>',
      `<div style="font-size:28px;font-weight:800;color:#002B5C;line-height:1.2;">${averageLabel}</div>`,
      '<div style="font-size:12px;color:#667;">(0-100)</div>',
      '</div>',
      '<div style="flex:1 1 180px;background:#dcfce7;border:1px solid #cfead7;border-radius:12px;padding:14px 16px;box-shadow:0 2px 6px rgba(0,0,0,.05);">',
      '<div style="font-size:12px;color:#14532d;letter-spacing:.4px;text-transform:uppercase;">Excelente / Bueno</div>',
      `<div style="font-size:28px;font-weight:800;color:#14532d;line-height:1.2;">${options.excellent + options.good}</div>`,
      '</div>',
      '<div style="flex:1 1 180px;background:#fee2e2;border:1px solid #f3c9cf;border-radius:12px;padding:14px 16px;box-shadow:0 2px 6px rgba(0,0,0,.05);">',
      '<div style="font-size:12px;color:#7f1d1d;letter-spacing:.4px;text-transform:uppercase;">Acep. / Insat.</div>',
      `<div style="font-size:28px;font-weight:800;color:#7f1d1d;line-height:1.2;">${options.acceptable + options.unsatisfactory}</div>`,
      '</div>',
      '</div>',
      '<div style="font-size:15px;color:#0057A4;font-weight:600;margin:8px 0 12px 0;">Resumen consolidado por coordinación</div>',
      '<table width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:14px;border-radius:8px;overflow:hidden;table-layout:fixed;border:1px solid #D4D7DD">',
      '<thead><tr style="background:#002B5C;color:#fff;">',
      '<th style="padding:10px 12px;text-align:left;color:#fff!important;width:32%;">Coordinación</th>',
      '<th style="padding:10px 12px;text-align:center;color:#fff!important;width:10%;">Aulas</th>',
      '<th style="padding:10px 12px;text-align:center;color:#fff!important;width:10%;">Promedio</th>',
      '<th style="padding:10px 12px;text-align:center;color:#fff!important;width:12%;">Excelente</th>',
      '<th style="padding:10px 12px;text-align:center;color:#fff!important;width:12%;">Bueno</th>',
      '<th style="padding:10px 12px;text-align:center;color:#fff!important;width:12%;">Aceptable</th>',
      '<th style="padding:10px 12px;text-align:center;color:#fff!important;width:12%;">Insatisf.</th>',
      '</tr></thead>',
      `<tbody>${rowsHtml}</tbody>`,
      '</table>',
      '<div style="margin-top:12px;font-size:11px;color:#556175;">Este correo fue generado por el sistema de seguimiento de aulas.</div>',
      '</div></div>',
      '</body></html>',
    ].join('');
  }

  private toScoreBand(score: number | null): 'EXCELENTE' | 'BUENO' | 'ACEPTABLE' | 'INSATISFACTORIO' {
    if (score == null) return 'INSATISFACTORIO';
    if (score >= 90) return 'EXCELENTE';
    if (score >= 80) return 'BUENO';
    if (score >= 70) return 'ACEPTABLE';
    return 'INSATISFACTORIO';
  }

  private toScoreBandForPhase(
    score: number | null,
    phase: string,
  ): 'EXCELENTE' | 'BUENO' | 'ACEPTABLE' | 'INSATISFACTORIO' {
    if (score == null) return 'INSATISFACTORIO';
    const normalized = phase === 'ALISTAMIENTO' ? score * 2 : score;
    return this.toScoreBand(normalized);
  }

  private formatScoreForPhase(score: number | null, phase: string): string {
    if (score == null) return 'N/A';
    const fixed = Number(score).toFixed(1);
    return phase === 'ALISTAMIENTO' ? `${fixed}/50` : `${fixed}/100`;
  }

  private extractCourseTeacherIdentifiers(course: { teacherId: string | null; rawJson: unknown }): string[] {
    const values: Array<unknown> = [course.teacherId];

    if (course.rawJson && typeof course.rawJson === 'object') {
      const raw = course.rawJson as Record<string, unknown>;
      const row = raw.row;
      if (row && typeof row === 'object') {
        const normalizedRow = row as Record<string, unknown>;
        values.push(
          normalizedRow.id_docente,
          normalizedRow.docente_id,
          normalizedRow.identificacion,
          normalizedRow.cedula,
          normalizedRow.identificacion_docente,
          normalizedRow.cedula_docente,
        );
      }
    }

    const identifiers: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = normalizeTeacherId(value ?? '');
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      identifiers.push(normalized);
    }

    return identifiers;
  }

  private async buildCourseCoordinationRows(
    periodId: string,
    moment: GeneratePayload['moment'],
    phase: GeneratePayload['phase'],
  ): Promise<CourseCoordinationRow[]> {
    const courses = await this.prisma.course.findMany({
      where: {
        periodId,
        moment,
      },
      include: {
        teacher: true,
        moodleCheck: true,
        evaluations: true,
      },
      orderBy: [{ programName: 'asc' }, { teacher: { fullName: 'asc' } }, { nrc: 'asc' }],
    });

    if (!courses.length) return [];

    const teachers = await this.prisma.teacher.findMany({
      select: {
        id: true,
        sourceId: true,
        documentId: true,
        fullName: true,
        costCenter: true,
        coordination: true,
      },
    });
    const teacherByIdentifier = new Map<
      string,
      {
        id: string;
        fullName: string;
        costCenter: string | null;
        coordination: string | null;
      }
    >();
    for (const teacher of teachers) {
      const identifiers = [teacher.id, teacher.sourceId, teacher.documentId]
        .map((value) => normalizeTeacherId(value ?? ''))
        .filter(Boolean);
      for (const identifier of identifiers) {
        if (!teacherByIdentifier.has(identifier)) {
          teacherByIdentifier.set(identifier, {
            id: teacher.id,
            fullName: teacher.fullName,
            costCenter: teacher.costCenter,
            coordination: teacher.coordination,
          });
        }
      }
    }

    return courses
      .filter(
        (course) =>
          !isCourseExcludedFromReview({
            rawJson: course.rawJson,
            template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
            moodleCheck: course.moodleCheck,
          }),
      )
      .map((course) => {
        const identifiers = this.extractCourseTeacherIdentifiers({
          teacherId: course.teacherId,
          rawJson: course.rawJson,
        });
        const mappedTeacher = identifiers
          .map((identifier) => teacherByIdentifier.get(identifier) ?? null)
          .find((teacher): teacher is NonNullable<typeof teacher> => Boolean(teacher));
        const teacherName =
          mappedTeacher?.fullName ?? course.teacher?.fullName ?? 'Docente sin identificar';
        const coordinationName = mappedTeacher?.coordination ?? mappedTeacher?.costCenter ?? null;
        const coordinationLabel = coordinationName?.trim() || 'SIN_COORDINACION';
        const coordinationKey = normalizeProgramKey(coordinationLabel);

        const evaluation = course.evaluations.find((item) => item.phase === phase);
        return {
          teacherName,
          nrc: course.nrc,
          subject: course.subjectName ?? '-',
          moment: course.moment ?? '-',
          status: course.moodleCheck?.status ?? 'SIN_CHECK',
          template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
          score: evaluation?.score ?? null,
          coordinationKey,
          coordinationName: coordinationLabel,
        };
      })
      .filter((row) => Boolean(row.coordinationKey));
  }

  private async generateTeacherOutbox(
    period: Period,
    payload: GeneratePayload,
  ) {
    const sampleGroups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: period.id,
        moment: payload.moment,
        teacherId: payload.teacherId,
      },
      include: {
        teacher: true,
        selectedCourse: {
          include: {
            teacher: true,
            moodleCheck: true,
            evaluations: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    if (!sampleGroups.length) {
      if (!payload.teacherId || !payload.moment) {
        return {
          ok: true,
          audience: 'DOCENTE',
          created: 0,
          reason: 'No hay grupos de muestreo para ese criterio.',
        };
      }

      const teacher = await this.prisma.teacher.findUnique({
        where: { id: payload.teacherId },
      });
      if (!teacher) {
        return {
          ok: true,
          audience: 'DOCENTE',
          created: 0,
          reason: `Docente ${payload.teacherId} no encontrado para regenerar correo sin muestreo.`,
        };
      }

      const courses = await this.prisma.course.findMany({
        where: {
          periodId: period.id,
          teacherId: teacher.id,
          moment: payload.moment,
        },
        include: {
          teacher: true,
          moodleCheck: true,
          evaluations: {
            where: {
              phase: payload.phase,
            },
          },
        },
        orderBy: [{ nrc: 'asc' }],
      });

      const filteredCourses = courses.filter((course) =>
        this.shouldIncludeTeacherReportCourse({
          rawJson: course.rawJson,
          templateDeclared: course.templateDeclared,
          moodleCheck: course.moodleCheck,
          evaluations: course.evaluations,
          phase: payload.phase,
        }),
      );
      if (!filteredCourses.length) {
        return {
          ok: true,
          audience: 'DOCENTE',
          created: 0,
          reason: `Docente ${teacher.fullName} sin cursos revisables en ${payload.moment}.`,
        };
      }

      const referenceIds = Array.from(
        new Set(
          filteredCourses
            .map((course) => course.evaluations[0]?.replicatedFromCourseId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const referencedCourses = referenceIds.length
        ? await this.prisma.course.findMany({
            where: { id: { in: referenceIds } },
            select: { id: true, nrc: true },
          })
        : [];
      const nrcByCourseId = new Map<string, string>();
      for (const course of filteredCourses) nrcByCourseId.set(course.id, course.nrc);
      for (const course of referencedCourses) nrcByCourseId.set(course.id, course.nrc);

      const rows = filteredCourses
        .map((course) => {
          const evaluation = course.evaluations[0];
          const replicatedFromCourseId = evaluation?.replicatedFromCourseId ?? null;
          const isReplicated = Boolean(replicatedFromCourseId);
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: course.teacher?.costCenter ?? teacher.costCenter ?? null,
            teacherLinked: !!course.teacherId,
            courseProgramCode: course.programCode,
            courseProgramName: course.programName,
          });

          return {
            nrc: course.nrc,
            reviewedNrc: replicatedFromCourseId
              ? (nrcByCourseId.get(replicatedFromCourseId) ?? course.nrc)
              : course.nrc,
            moment: course.moment ?? payload.moment ?? '1',
            resultType: isReplicated ? ('REPLICADO' as const) : ('REVISADO' as const),
            subject: course.subjectName ?? '-',
            program:
              resolvedProgram.programName ??
              resolvedProgram.programCode ??
              'SIN_PROGRAMA_VALIDADO',
            template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
            score: evaluation?.score ?? null,
            observations: evaluation?.observations?.trim() || 'Sin observaciones registradas.',
          };
        })
        .sort((left, right) => left.nrc.localeCompare(right.nrc));

      const subject = `[Seguimiento Aulas] ${payload.phase} ${payload.moment} - ${period.code}`;
      const htmlBody = this.buildTeacherHtml({
        teacherName: teacher.fullName,
        phase: payload.phase,
        moment: payload.moment,
        periodCode: period.code,
        rows,
      });

      await this.prisma.outboxMessage.deleteMany({
        where: {
          teacherId: teacher.id,
          periodId: period.id,
          phase: payload.phase,
          moment: payload.moment,
          audience: 'DOCENTE',
        },
      });

      const createdMessage = await this.prisma.outboxMessage.create({
        data: {
          audience: 'DOCENTE',
          teacherId: teacher.id,
          coordinatorId: null,
          programCode: teacher.costCenter ?? null,
          periodId: period.id,
          phase: payload.phase,
          moment: payload.moment,
          subject,
          recipientName: teacher.fullName,
          recipientEmail: teacher.email,
          htmlBody,
          status: 'DRAFT',
        },
      });

      return {
        ok: true,
        audience: 'DOCENTE',
        created: 1,
        period: period.code,
        phase: payload.phase,
        moment: payload.moment,
        reason: 'Regenerado sin muestreo activo (fallback por cursos del docente).',
        createdMessages: [
          {
            id: createdMessage.id,
            teacherId: teacher.id,
            moment: payload.moment,
          },
        ],
      };
    }

    const buckets = new Map<string, typeof sampleGroups>();
    for (const group of sampleGroups) {
      const key = `${group.teacherId}|${group.moment}`;
      const current = buckets.get(key) ?? [];
      current.push(group);
      buckets.set(key, current);
    }

    let created = 0;
    const createdMessages: Array<{ id: string; teacherId: string; moment: string }> = [];
    for (const groups of buckets.values()) {
      const teacher = groups[0].teacher;
      const moment = groups[0].moment;
      const programCode = teacher.costCenter ?? groups[0].programCode;
      const selectedCourses = groups
        .map((group) => group.selectedCourse)
        .filter((course): course is NonNullable<typeof course> => Boolean(course));
      const selectedCourseIds = selectedCourses.map((course) => course.id);
      const selectedCourseIdSet = new Set(selectedCourseIds);
      const replicatedCourses = selectedCourseIds.length
        ? await this.prisma.course.findMany({
            where: {
              periodId: period.id,
              teacherId: teacher.id,
              moment,
              evaluations: {
                some: {
                  phase: payload.phase,
                  replicatedFromCourseId: {
                    in: selectedCourseIds,
                  },
                },
              },
            },
            include: {
              teacher: true,
              moodleCheck: true,
              evaluations: {
                where: {
                  phase: payload.phase,
                },
              },
            },
            orderBy: [{ nrc: 'asc' }],
          })
        : [];
      const groupByCourseId = new Map(
        groups
          .filter((group) => Boolean(group.selectedCourseId))
          .map((group) => [group.selectedCourseId as string, group]),
      );
      const coursesById = new Map<string, (typeof selectedCourses)[number]>();
      for (const course of selectedCourses) coursesById.set(course.id, course);
      for (const course of replicatedCourses) coursesById.set(course.id, course);
      const nrcByCourseId = new Map<string, string>();
      for (const course of coursesById.values()) nrcByCourseId.set(course.id, course.nrc);

      const rows = [...coursesById.values()]
        .filter((course) =>
          this.shouldIncludeTeacherReportCourse({
            rawJson: course.rawJson,
            templateDeclared: course.templateDeclared,
            moodleCheck: course.moodleCheck,
            evaluations: course.evaluations,
            phase: payload.phase,
          }),
        )
        .map((course) => {
          const evaluation = course.evaluations.find((item) => item.phase === payload.phase);
          const isSelectedCourse = selectedCourseIdSet.has(course.id);
          const parentSelectedCourseId =
            isSelectedCourse
              ? course.id
              : evaluation?.replicatedFromCourseId &&
                  selectedCourseIdSet.has(evaluation.replicatedFromCourseId)
                ? evaluation.replicatedFromCourseId
                : selectedCourseIds[0] ?? course.id;
          const parentGroup = groupByCourseId.get(parentSelectedCourseId);
          const isReplicated = !isSelectedCourse;
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: course.teacher?.costCenter ?? teacher.costCenter ?? null,
            teacherLinked: !!course.teacherId,
            courseProgramCode: course.programCode,
            courseProgramName: course.programName,
          });
          return {
            nrc: course.nrc,
            reviewedNrc: nrcByCourseId.get(parentSelectedCourseId) ?? course.nrc,
            moment: course.moment ?? moment,
            resultType: isReplicated ? ('REPLICADO' as const) : ('REVISADO' as const),
            subject: course.subjectName ?? '-',
            program:
              resolvedProgram.programName ??
              resolvedProgram.programCode ??
              (!course.teacherId ? (parentGroup?.programCode ?? groups[0].programCode) : 'SIN_PROGRAMA_VALIDADO'),
            template:
              course.moodleCheck?.detectedTemplate ??
              course.templateDeclared ??
              parentGroup?.template ??
              'UNKNOWN',
            score: evaluation?.score ?? null,
            observations: evaluation?.observations?.trim() || 'Sin observaciones registradas.',
          };
        })
        .sort((left, right) => left.nrc.localeCompare(right.nrc));

      if (!rows.length) continue;

      const subject = `[Seguimiento Aulas] ${payload.phase} ${moment} - ${period.code}`;
      const htmlBody = this.buildTeacherHtml({
        teacherName: teacher.fullName,
        phase: payload.phase,
        moment,
        periodCode: period.code,
        rows,
      });

      await this.prisma.outboxMessage.deleteMany({
        where: {
          teacherId: teacher.id,
          periodId: period.id,
          phase: payload.phase,
          moment,
          audience: 'DOCENTE',
        },
      });

      const createdMessage = await this.prisma.outboxMessage.create({
        data: {
          audience: 'DOCENTE',
          teacherId: teacher.id,
          coordinatorId: null,
          programCode,
          periodId: period.id,
          phase: payload.phase,
          moment,
          subject,
          recipientName: teacher.fullName,
          recipientEmail: teacher.email,
          htmlBody,
          status: 'DRAFT',
        },
      });

      created += 1;
      createdMessages.push({
        id: createdMessage.id,
        teacherId: teacher.id,
        moment,
      });
    }

    return {
      ok: true,
      audience: 'DOCENTE',
      created,
      period: period.code,
      phase: payload.phase,
      moment: payload.moment ?? 'ALL',
      createdMessages,
    };
  }

  private async generateCoordinatorOutbox(
    period: Period,
    payload: GeneratePayload,
  ) {
    const coordinators = await this.prisma.coordinator.findMany({
      orderBy: [{ programId: 'asc' }, { fullName: 'asc' }],
    });

    if (!coordinators.length) {
      return {
        ok: true,
        audience: 'COORDINADOR',
        created: 0,
        reason: 'No hay coordinadores cargados. Importa el Excel con /import/teachers-xlsx.',
      };
    }

    const coursesByCoordination = await this.buildCourseCoordinationRows(
      period.id,
      payload.moment,
      payload.phase,
    );
    if (!coursesByCoordination.length) {
      return {
        ok: true,
        audience: 'COORDINADOR',
        created: 0,
        reason: 'No hay cursos para ese criterio.',
      };
    }

    let created = 0;
    const unmatchedCoordinators: string[] = [];

    for (const coordinator of coordinators) {
      const matches = coursesByCoordination.filter((course) => {
        const courseCoordinationKey = course.coordinationKey;
        if (!courseCoordinationKey) return false;
        return (
          courseCoordinationKey === coordinator.programKey ||
          courseCoordinationKey.includes(coordinator.programKey) ||
          coordinator.programKey.includes(courseCoordinationKey)
        );
      });

      if (!matches.length) {
        unmatchedCoordinators.push(coordinator.programId);
        continue;
      }

      const rows = matches.map((course) => ({
        teacherName: course.teacherName,
        nrc: course.nrc,
        subject: course.subject,
        moment: course.moment,
        status: course.status,
        template: course.template,
        score: course.score,
      }));

      const uniqueTeachers = new Set(rows.map((item) => item.teacherName)).size;
      const momentLabel = payload.moment ?? 'ALL';
      const subject = `[Seguimiento Aulas] ${payload.phase} ${momentLabel} - ${period.code} - ${coordinator.programId}`;
      const htmlBody = this.buildCoordinatorHtml({
        coordinatorName: coordinator.fullName,
        programId: coordinator.programId,
        phase: payload.phase,
        moment: momentLabel,
        periodCode: period.code,
        uniqueTeachers,
        rows,
      });

      await this.prisma.outboxMessage.deleteMany({
        where: {
          coordinatorId: coordinator.id,
          periodId: period.id,
          phase: payload.phase,
          moment: momentLabel,
          audience: 'COORDINADOR',
        },
      });

      await this.prisma.outboxMessage.create({
        data: {
          audience: 'COORDINADOR',
          teacherId: null,
          coordinatorId: coordinator.id,
          programCode: coordinator.programId,
          periodId: period.id,
          phase: payload.phase,
          moment: momentLabel,
          subject,
          recipientName: coordinator.fullName,
          recipientEmail: coordinator.email,
          htmlBody,
          status: 'DRAFT',
        },
      });

      created += 1;
    }

    return {
      ok: true,
      audience: 'COORDINADOR',
      created,
      period: period.code,
      phase: payload.phase,
      moment: payload.moment ?? 'ALL',
      unmatchedCoordinators,
    };
  }

  private async generateGlobalOutbox(
    period: Period,
    payload: GeneratePayload,
  ) {
    const rows = await this.buildCourseCoordinationRows(period.id, payload.moment, payload.phase);
    if (!rows.length) {
      return {
        ok: true,
        audience: 'GLOBAL',
        created: 0,
        reason: 'No hay cursos para ese criterio.',
      };
    }

    const summaryByCoordination = new Map<
      string,
      {
        coordination: string;
        total: number;
        scoreSum: number;
        scoredCount: number;
        excellent: number;
        good: number;
        acceptable: number;
        unsatisfactory: number;
      }
    >();
    for (const row of rows) {
      const key = row.coordinationKey;
      const current = summaryByCoordination.get(key) ?? {
        coordination: row.coordinationName,
        total: 0,
        scoreSum: 0,
        scoredCount: 0,
        excellent: 0,
        good: 0,
        acceptable: 0,
        unsatisfactory: 0,
      };

      current.total += 1;
      if (row.score != null) {
        current.scoreSum += row.score;
        current.scoredCount += 1;
      }

      const band = this.toScoreBand(row.score);
      if (band === 'EXCELENTE') current.excellent += 1;
      if (band === 'BUENO') current.good += 1;
      if (band === 'ACEPTABLE') current.acceptable += 1;
      if (band === 'INSATISFACTORIO') current.unsatisfactory += 1;

      summaryByCoordination.set(key, current);
    }

    const rowsSummary = [...summaryByCoordination.values()]
      .map((item) => ({
        coordination: item.coordination,
        total: item.total,
        average: item.scoredCount > 0 ? item.scoreSum / item.scoredCount : null,
        excellent: item.excellent,
        good: item.good,
        acceptable: item.acceptable,
        unsatisfactory: item.unsatisfactory,
      }))
      .sort((a, b) => a.coordination.localeCompare(b.coordination, 'es'));

    const scoreSum = rows.reduce((acc, row) => acc + (row.score ?? 0), 0);
    const scoredCount = rows.reduce((acc, row) => acc + (row.score == null ? 0 : 1), 0);
    const excellent = rows.filter((row) => this.toScoreBand(row.score) === 'EXCELENTE').length;
    const good = rows.filter((row) => this.toScoreBand(row.score) === 'BUENO').length;
    const acceptable = rows.filter((row) => this.toScoreBand(row.score) === 'ACEPTABLE').length;
    const unsatisfactory = rows.filter(
      (row) => this.toScoreBand(row.score) === 'INSATISFACTORIO',
    ).length;

    const momentLabel = payload.moment ?? 'ALL';
    const subject = `[Seguimiento Aulas] GLOBAL ${payload.phase} ${momentLabel} - ${period.code}`;
    const recipientNameRaw = process.env.OUTBOX_GLOBAL_RECIPIENT_NAME?.trim();
    const recipientEmailRaw = process.env.OUTBOX_GLOBAL_RECIPIENT_EMAIL?.trim();
    const defaultTo = process.env.OUTBOX_DEFAULT_TO?.trim();
    const defaultCc = process.env.OUTBOX_DEFAULT_CC?.trim();
    const recipientName = recipientNameRaw || 'Equipo de Coordinacion Academica';
    const recipientEmail = recipientEmailRaw || defaultTo || defaultCc || null;
    const htmlBody = this.buildGlobalHtml({
      phase: payload.phase,
      moment: momentLabel,
      periodCode: period.code,
      totalCourses: rows.length,
      averageScore: scoredCount > 0 ? scoreSum / scoredCount : null,
      excellent,
      good,
      acceptable,
      unsatisfactory,
      rows: rowsSummary,
    });

    await this.prisma.outboxMessage.deleteMany({
      where: {
        audience: 'GLOBAL',
        periodId: period.id,
        phase: payload.phase,
        moment: momentLabel,
      },
    });

    await this.prisma.outboxMessage.create({
      data: {
        audience: 'GLOBAL',
        teacherId: null,
        coordinatorId: null,
        programCode: null,
        periodId: period.id,
        phase: payload.phase,
        moment: momentLabel,
        subject,
        recipientName,
        recipientEmail,
        htmlBody,
        status: 'DRAFT',
      },
    });

    return {
      ok: true,
      audience: 'GLOBAL',
      created: 1,
      period: period.code,
      phase: payload.phase,
      moment: momentLabel,
      coordinations: rowsSummary.length,
      totalCourses: rows.length,
    };
  }

  async generate(rawPayload: unknown) {
    const parsedPayload = parseWithSchema(
      OutboxGenerateSchema,
      rawPayload,
      'outbox generate request',
    );
    const payload: GeneratePayload = {
      ...parsedPayload,
      audience: parsedPayload.audience ?? 'DOCENTE',
    };

    const period = await this.prisma.period.findUnique({ where: { code: payload.periodCode } });
    if (!period) {
      throw new NotFoundException(`No existe el periodo ${payload.periodCode}.`);
    }

    if (payload.audience === 'COORDINADOR') {
      return this.generateCoordinatorOutbox(period, payload);
    }

    if (payload.audience === 'GLOBAL') {
      return this.generateGlobalOutbox(period, payload);
    }

    return this.generateTeacherOutbox(period, payload);
  }

  async export(rawPayload: unknown) {
    const payload = parseWithSchema(OutboxExportSchema, rawPayload, 'outbox export request');
    const outboxDir = this.resolveOutboxDir();
    await fs.mkdir(outboxDir, { recursive: true });

    const messages = await this.prisma.outboxMessage.findMany({
      where: payload.ids?.length
        ? { id: { in: payload.ids } }
        : {
            status: 'DRAFT',
          },
      include: {
        teacher: true,
        coordinator: true,
        period: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });

    const exported: Array<{ id: string; emlPath: string }> = [];

    for (const message of messages) {
      const to =
        message.recipientEmail ??
        message.teacher?.email ??
        message.coordinator?.email ??
        'sin-correo@invalid.local';
      const cc = process.env.OUTBOX_DEFAULT_CC || undefined;
      const eml = toEml({
        to,
        cc,
        subject: message.subject,
        html: message.htmlBody,
      });

      const filename = sanitizeForFilename(
        `${message.period.code}_${message.phase}_${message.moment}_${message.id}.eml`,
      );
      const absolutePath = path.join(outboxDir, filename);
      await fs.writeFile(absolutePath, eml, 'utf8');

      await this.prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          emlPath: absolutePath,
          status: 'EXPORTED',
        },
      });

      exported.push({ id: message.id, emlPath: absolutePath });
    }

    return {
      ok: true,
      exportedCount: exported.length,
      exported,
      outboxDir,
    };
  }

  private createSmtpTransport() {
    const host = process.env.OUTBOX_SMTP_HOST?.trim();
    if (!host) {
      throw new BadRequestException(
        'Falta OUTBOX_SMTP_HOST. Configura SMTP antes de usar /outbox/send.',
      );
    }

    const portRaw = process.env.OUTBOX_SMTP_PORT?.trim() || '25';
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port <= 0) {
      throw new BadRequestException(`OUTBOX_SMTP_PORT invalido: "${portRaw}".`);
    }

    const secure = parseEnvBoolean(process.env.OUTBOX_SMTP_SECURE, false);
    const ignoreTLS = parseEnvBoolean(process.env.OUTBOX_SMTP_IGNORE_TLS, false);
    const rejectUnauthorized = parseEnvBoolean(process.env.OUTBOX_SMTP_REJECT_UNAUTHORIZED, false);
    const user = process.env.OUTBOX_SMTP_USER?.trim();
    const pass = process.env.OUTBOX_SMTP_PASS ?? '';
    const requireAuth = parseEnvBoolean(process.env.OUTBOX_SMTP_REQUIRE_AUTH, !!user);

    if (requireAuth && !user) {
      throw new BadRequestException(
        'OUTBOX_SMTP_REQUIRE_AUTH=true requiere OUTBOX_SMTP_USER y OUTBOX_SMTP_PASS.',
      );
    }

    const from = process.env.OUTBOX_SMTP_FROM?.trim();
    if (!from) {
      throw new BadRequestException(
        'Falta OUTBOX_SMTP_FROM. Ejemplo: "Campus Virtual <campus.virtual@uniminuto.edu>".',
      );
    }

    const replyTo = process.env.OUTBOX_SMTP_REPLY_TO?.trim() || undefined;
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ignoreTLS,
      auth: requireAuth ? { user, pass } : undefined,
      tls: {
        rejectUnauthorized,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });

    return {
      transporter,
      from,
      replyTo,
    };
  }

  private resolveDeliveryMode(): 'SMTP' | 'OUTLOOK' {
    const raw = (process.env.OUTBOX_DELIVERY_MODE ?? 'SMTP').trim().toUpperCase();
    if (raw === 'SMTP' || raw === 'OUTLOOK') return raw;
    throw new BadRequestException(
      `OUTBOX_DELIVERY_MODE invalido: "${raw}". Usa "SMTP" o "OUTLOOK".`,
    );
  }

  private parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(parsed)));
  }

  private normalizeFingerprintToken(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private buildSendFingerprint(input: {
    to: string;
    audience: string;
    periodCode: string;
    phase: string;
    moment: string;
    recipientName: string;
  }): string {
    return [
      this.normalizeFingerprintToken(input.to),
      this.normalizeFingerprintToken(input.audience),
      this.normalizeFingerprintToken(input.periodCode),
      this.normalizeFingerprintToken(input.phase),
      this.normalizeFingerprintToken(input.moment),
      this.normalizeFingerprintToken(input.recipientName),
    ].join('|');
  }

  private async buildRecentSendFingerprintSet(since: Date): Promise<Set<string>> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: 'OUTBOX_SEND_SENT',
        entityType: 'OUTBOX_MESSAGE',
        createdAt: { gte: since },
      },
      select: {
        entityId: true,
        details: true,
      },
      take: 5000,
      orderBy: [{ createdAt: 'desc' }],
    });

    const fingerprints = new Set<string>();
    const missing: Array<{ id: string; to: string }> = [];

    for (const log of logs) {
      const detail =
        log.details && typeof log.details === 'object' && !Array.isArray(log.details)
          ? (log.details as SendAuditLogDetail)
          : null;
      const rawFingerprint = detail?.fingerprint?.trim();
      if (rawFingerprint) {
        fingerprints.add(this.normalizeFingerprintToken(rawFingerprint));
        continue;
      }

      const to = detail?.to?.trim();
      if (!to) continue;
      missing.push({ id: log.entityId, to });
    }

    if (!missing.length) return fingerprints;

    const messageIds = [...new Set(missing.map((item) => item.id))];
    const messages = await this.prisma.outboxMessage.findMany({
      where: { id: { in: messageIds } },
      include: { period: true, teacher: true, coordinator: true },
    });
    const messageById = new Map(messages.map((item) => [item.id, item]));

    for (const row of missing) {
      const message = messageById.get(row.id);
      if (!message) continue;
      const recipientName =
        message.recipientName ??
        message.teacher?.fullName ??
        message.coordinator?.fullName ??
        '';
      const fingerprint = this.buildSendFingerprint({
        to: row.to,
        audience: message.audience,
        periodCode: message.period.code,
        phase: message.phase,
        moment: message.moment,
        recipientName,
      });
      fingerprints.add(this.normalizeFingerprintToken(fingerprint));
    }

    return fingerprints;
  }

  private async collectTeacherReportRows(params: {
    periodId: string;
    teacherId: string;
    moment: GeneratePayload['moment'];
    phase: GeneratePayload['phase'];
  }): Promise<
    | {
        teacher: { fullName: string; email: string | null; costCenter: string | null };
        programCode: string | null;
        rows: Array<{
          nrc: string;
          reviewedNrc: string;
          moment: string;
          resultType: 'REVISADO' | 'REPLICADO';
          subject: string;
          program: string;
          template: string;
          score: number | null;
          observations: string;
        }>;
      }
    | null
  > {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: params.teacherId },
      select: {
        id: true,
        fullName: true,
        email: true,
        costCenter: true,
      },
    });
    if (!teacher) return null;

    const sampleGroups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: params.periodId,
        moment: params.moment,
        teacherId: params.teacherId,
      },
      include: {
        selectedCourse: {
          include: {
            teacher: true,
            moodleCheck: true,
            evaluations: {
              where: { phase: params.phase },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    if (!sampleGroups.length) {
      const courses = await this.prisma.course.findMany({
        where: {
          periodId: params.periodId,
          teacherId: params.teacherId,
          moment: params.moment,
        },
        include: {
          teacher: true,
          moodleCheck: true,
          evaluations: {
            where: { phase: params.phase },
          },
        },
        orderBy: [{ nrc: 'asc' }],
      });

      const filteredCourses = courses.filter((course) =>
        this.shouldIncludeTeacherReportCourse({
          rawJson: course.rawJson,
          templateDeclared: course.templateDeclared,
          moodleCheck: course.moodleCheck,
          evaluations: course.evaluations,
          phase: params.phase,
        }),
      );
      if (!filteredCourses.length) return null;

      const referenceIds = Array.from(
        new Set(
          filteredCourses
            .map((course) => course.evaluations[0]?.replicatedFromCourseId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const referencedCourses = referenceIds.length
        ? await this.prisma.course.findMany({
            where: { id: { in: referenceIds } },
            select: { id: true, nrc: true },
          })
        : [];
      const nrcByCourseId = new Map<string, string>();
      for (const course of filteredCourses) nrcByCourseId.set(course.id, course.nrc);
      for (const course of referencedCourses) nrcByCourseId.set(course.id, course.nrc);

      const rows = filteredCourses
        .map((course) => {
          const evaluation = course.evaluations[0];
          const replicatedFromCourseId = evaluation?.replicatedFromCourseId ?? null;
          const isReplicated = Boolean(replicatedFromCourseId);
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: course.teacher?.costCenter ?? teacher.costCenter ?? null,
            teacherLinked: !!course.teacherId,
            courseProgramCode: course.programCode,
            courseProgramName: course.programName,
          });

          return {
            nrc: course.nrc,
            reviewedNrc: replicatedFromCourseId
              ? (nrcByCourseId.get(replicatedFromCourseId) ?? course.nrc)
              : course.nrc,
            moment: course.moment ?? params.moment ?? '1',
            resultType: isReplicated ? ('REPLICADO' as const) : ('REVISADO' as const),
            subject: course.subjectName ?? '-',
            program:
              resolvedProgram.programName ??
              resolvedProgram.programCode ??
              'SIN_PROGRAMA_VALIDADO',
            template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
            score: evaluation?.score ?? null,
            observations: evaluation?.observations?.trim() || 'Sin observaciones registradas.',
          };
        })
        .sort((left, right) => left.nrc.localeCompare(right.nrc));

      return {
        teacher: {
          fullName: teacher.fullName,
          email: teacher.email,
          costCenter: teacher.costCenter,
        },
        programCode: teacher.costCenter ?? null,
        rows,
      };
    }

    const selectedCourses = sampleGroups
      .map((group) => group.selectedCourse)
      .filter((course): course is NonNullable<typeof course> => Boolean(course));
    const selectedCourseIdSet = new Set(selectedCourses.map((course) => course.id));
    const selectedCourseIds = [...selectedCourseIdSet];
    const replicatedCourses = selectedCourseIds.length
      ? await this.prisma.course.findMany({
          where: {
            periodId: params.periodId,
            teacherId: params.teacherId,
            moment: params.moment,
            evaluations: {
              some: {
                phase: params.phase,
                replicatedFromCourseId: {
                  in: selectedCourseIds,
                },
              },
            },
          },
          include: {
            teacher: true,
            moodleCheck: true,
            evaluations: {
              where: { phase: params.phase },
            },
          },
          orderBy: [{ nrc: 'asc' }],
        })
      : [];
    const groupByCourseId = new Map(
      sampleGroups
        .filter((group) => Boolean(group.selectedCourseId))
        .map((group) => [group.selectedCourseId as string, group]),
    );
    const coursesById = new Map<string, (typeof selectedCourses)[number]>();
    for (const course of selectedCourses) coursesById.set(course.id, course);
    for (const course of replicatedCourses) coursesById.set(course.id, course);
    const nrcByCourseId = new Map<string, string>();
    for (const course of coursesById.values()) nrcByCourseId.set(course.id, course.nrc);

    const rows = [...coursesById.values()]
      .filter((course) =>
        this.shouldIncludeTeacherReportCourse({
          rawJson: course.rawJson,
          templateDeclared: course.templateDeclared,
          moodleCheck: course.moodleCheck,
          evaluations: course.evaluations,
          phase: params.phase,
        }),
      )
      .map((course) => {
        const evaluation = course.evaluations.find((item) => item.phase === params.phase);
        const isSelectedCourse = selectedCourseIdSet.has(course.id);
        const parentSelectedCourseId =
          isSelectedCourse
            ? course.id
            : evaluation?.replicatedFromCourseId &&
                selectedCourseIdSet.has(evaluation.replicatedFromCourseId)
              ? evaluation.replicatedFromCourseId
              : selectedCourseIds[0] ?? course.id;
        const parentGroup = groupByCourseId.get(parentSelectedCourseId);
        const isReplicated = !isSelectedCourse;
        const resolvedProgram = resolveProgramValue({
          teacherCostCenter: course.teacher?.costCenter ?? teacher.costCenter ?? null,
          teacherLinked: !!course.teacherId,
          courseProgramCode: course.programCode,
          courseProgramName: course.programName,
        });
        return {
          nrc: course.nrc,
          reviewedNrc: nrcByCourseId.get(parentSelectedCourseId) ?? course.nrc,
          moment: course.moment ?? params.moment ?? '1',
          resultType: isReplicated ? ('REPLICADO' as const) : ('REVISADO' as const),
          subject: course.subjectName ?? '-',
          program:
            resolvedProgram.programName ??
            resolvedProgram.programCode ??
            (!course.teacherId ? (parentGroup?.programCode ?? sampleGroups[0].programCode) : 'SIN_PROGRAMA_VALIDADO'),
          template:
            course.moodleCheck?.detectedTemplate ??
            course.templateDeclared ??
            parentGroup?.template ??
            'UNKNOWN',
          score: evaluation?.score ?? null,
          observations: evaluation?.observations?.trim() || 'Sin observaciones registradas.',
        };
      })
      .sort((left, right) => left.nrc.localeCompare(right.nrc));

    if (!rows.length) return null;

    return {
      teacher: {
        fullName: teacher.fullName,
        email: teacher.email,
        costCenter: teacher.costCenter,
      },
      programCode: teacher.costCenter ?? sampleGroups[0]?.programCode ?? null,
      rows,
    };
  }

  private async refreshTeacherMessageForSend(message: {
    id: string;
    audience: string;
    teacherId: string | null;
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
  }): Promise<{ subject: string; htmlBody: string; recipientName: string; recipientEmail: string | null } | null> {
    if (message.audience !== 'DOCENTE' || !message.teacherId) return null;
    if (!message.moment || !SUPPORTED_MOMENTS.includes(message.moment as (typeof SUPPORTED_MOMENTS)[number])) {
      return null;
    }
    if (!message.phase || !['ALISTAMIENTO', 'EJECUCION'].includes(message.phase)) {
      return null;
    }

    const rowsPayload = await this.collectTeacherReportRows({
      periodId: message.periodId,
      teacherId: message.teacherId,
      moment: message.moment as GeneratePayload['moment'],
      phase: message.phase as GeneratePayload['phase'],
    });
    if (!rowsPayload || !rowsPayload.rows.length) return null;

    const subject = `[Seguimiento Aulas] ${message.phase} ${message.moment} - ${message.periodCode}`;
    const htmlBody = this.buildTeacherHtml({
      teacherName: rowsPayload.teacher.fullName,
      phase: message.phase,
      moment: message.moment,
      periodCode: message.periodCode,
      rows: rowsPayload.rows,
    });

    await this.prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        subject,
        recipientName: rowsPayload.teacher.fullName,
        recipientEmail: rowsPayload.teacher.email,
        programCode: rowsPayload.programCode,
        htmlBody,
        status: 'DRAFT',
      },
    });

    return {
      subject,
      htmlBody,
      recipientName: rowsPayload.teacher.fullName,
      recipientEmail: rowsPayload.teacher.email,
    };
  }

  private async sendViaOutlook(candidates: SendCandidate[]) {
    const powershellScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { throw 'No se recibio payload para envio Outlook.' }
$payload = $raw | ConvertFrom-Json
$outlook = New-Object -ComObject Outlook.Application
$sent = @()
$failed = @()
foreach ($item in $payload) {
  try {
    $mail = $outlook.CreateItem(0)
    $mail.To = [string]$item.to
    if ($null -ne $item.cc -and [string]::IsNullOrWhiteSpace([string]$item.cc) -eq $false) { $mail.CC = [string]$item.cc }
    $mail.Subject = [string]$item.subject
    $mail.HTMLBody = [string]$item.htmlBody
    $mail.Send()
    $sent += [PSCustomObject]@{ id = [string]$item.id; to = [string]$item.to; messageId = $null }
  } catch {
    $failed += [PSCustomObject]@{ id = [string]$item.id; to = [string]$item.to; error = $_.Exception.Message }
  }
}
[PSCustomObject]@{ sent = $sent; failed = $failed } | ConvertTo-Json -Compress -Depth 8
`;

    const inputPayload = candidates.map((item) => ({
      id: item.id,
      to: item.to,
      cc: item.cc ?? '',
      subject: item.subject,
      htmlBody: item.htmlBody,
    }));

    const result = await new Promise<{ sent: Array<{ id: string; to: string; messageId: string | null }>; failed: Array<{ id: string; to: string; error: string }> }>(
      (resolve, reject) => {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', powershellScript],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        );

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        child.on('error', (error) => {
          reject(
            new BadRequestException(
              `No fue posible invocar Outlook local (powershell.exe). ${error.message}`,
            ),
          );
        });

        child.on('close', (code) => {
          if (code !== 0) {
            reject(
              new BadRequestException(
                `Envio por Outlook fallo (code ${code}). ${stderr || stdout || 'Sin detalle.'}`,
              ),
            );
            return;
          }

          try {
            const parsed = JSON.parse(stdout || '{}') as {
              sent?: Array<{ id: string; to: string; messageId: string | null }>;
              failed?: Array<{ id: string; to: string; error: string }>;
            };
            resolve({
              sent: parsed.sent ?? [],
              failed: parsed.failed ?? [],
            });
          } catch (error) {
            const parseMessage = error instanceof Error ? error.message : String(error);
            reject(
              new BadRequestException(
                `No se pudo interpretar la respuesta de Outlook. ${parseMessage}. Raw: ${stdout || '(vacio)'}`,
              ),
            );
          }
        });

        child.stdin.write(Buffer.from(JSON.stringify(inputPayload), 'utf8'));
        child.stdin.end();
      },
    );

    return result;
  }

  async send(rawPayload: unknown) {
    const parsedPayload = parseWithSchema(OutboxSendSchema, rawPayload, 'outbox send request');
    const payload: SendPayload = {
      ...parsedPayload,
      dryRun: parsedPayload.dryRun ?? false,
      limit: parsedPayload.limit ?? 300,
    };

    const where = payload.ids?.length
      ? {
          id: {
            in: payload.ids,
          },
        }
      : {
          status: payload.status ?? 'DRAFT',
          period: payload.periodCode ? { code: payload.periodCode } : undefined,
          phase: payload.phase,
          moment: payload.moment,
          audience: payload.audience,
        };

    const messages = await this.prisma.outboxMessage.findMany({
      where,
      include: {
        teacher: true,
        coordinator: true,
        period: true,
      },
      orderBy: { createdAt: 'asc' },
      take: payload.limit,
    });

    if (!messages.length) {
      return {
        ok: true,
        dryRun: payload.dryRun,
        sentCount: 0,
        failedCount: 0,
        reason: 'No hay mensajes para enviar con el filtro indicado.',
      };
    }

    const shouldRefreshTeacherHtml = parseEnvBoolean(
      process.env.OUTBOX_REFRESH_DOCENTE_HTML_ON_SEND,
      true,
    );
    if (shouldRefreshTeacherHtml) {
      for (const message of messages) {
        const refreshed = await this.refreshTeacherMessageForSend({
          id: message.id,
          audience: message.audience,
          teacherId: message.teacherId,
          periodId: message.periodId,
          periodCode: message.period.code,
          phase: message.phase,
          moment: message.moment,
        });
        if (!refreshed) continue;
        message.subject = refreshed.subject;
        message.htmlBody = refreshed.htmlBody;
        message.recipientName = refreshed.recipientName;
        message.recipientEmail = refreshed.recipientEmail;
      }
    }

    const defaultCc = process.env.OUTBOX_DEFAULT_CC?.trim() || undefined;
    const candidates: SendCandidate[] = messages.map((message) => {
      const originalTo =
        message.recipientEmail ??
        message.teacher?.email ??
        message.coordinator?.email ??
        'sin-correo@invalid.local';
      const to = payload.forceTo?.trim() || originalTo;
      const recipientName =
        message.recipientName ??
        message.teacher?.fullName ??
        message.coordinator?.fullName ??
        'Sin nombre';
      const fingerprint = this.buildSendFingerprint({
        to,
        audience: message.audience,
        periodCode: message.period.code,
        phase: message.phase,
        moment: message.moment,
        recipientName,
      });

      return {
        id: message.id,
        originalTo,
        to,
        cc: defaultCc,
        recipientName,
        fingerprint,
        subject: message.subject,
        htmlBody: message.htmlBody,
        audience: message.audience,
        periodCode: message.period.code,
        periodId: message.periodId,
        phase: message.phase,
        moment: message.moment,
        teacherId: message.teacherId ?? undefined,
        coordinatorId: message.coordinatorId ?? undefined,
      };
    });

    if (payload.dryRun) {
      return {
        ok: true,
        dryRun: true,
        candidates: candidates.length,
        preview: candidates.slice(0, 20).map((item) => ({
          id: item.id,
          to: item.to,
          originalTo: item.originalTo,
          forceToApplied: Boolean(payload.forceTo?.trim()),
          cc: item.cc ?? null,
          subject: item.subject,
          periodCode: item.periodCode,
          phase: item.phase,
          moment: item.moment,
          audience: item.audience,
        })),
      };
    }

    const sent: Array<{ id: string; to: string; messageId: string | null }> = [];
    const failed: Array<{ id: string; to: string; error: string }> = [];
    const skipped: Array<{ id: string; to: string; error: string }> = [];
    const deliveryMode = this.resolveDeliveryMode();
    const validCandidates = candidates.filter((item) => item.to && item.to !== 'sin-correo@invalid.local');
    for (const item of candidates) {
      if (!item.to || item.to === 'sin-correo@invalid.local') {
        failed.push({
          id: item.id,
          to: item.to || '(sin destinatario)',
          error: 'Mensaje sin correo destino valido.',
        });
      }
    }

    const dedupeWindowMinutes = this.parsePositiveInt(
      process.env.OUTBOX_SEND_DEDUPE_WINDOW_MINUTES,
      45,
      0,
      1440,
    );
    let deliverableCandidates = validCandidates;
    if (dedupeWindowMinutes > 0 && validCandidates.length) {
      const since = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000);
      const recentFingerprints = await this.buildRecentSendFingerprintSet(since);
      const filtered: SendCandidate[] = [];
      for (const item of validCandidates) {
        const normalizedFingerprint = this.normalizeFingerprintToken(item.fingerprint);
        if (recentFingerprints.has(normalizedFingerprint)) {
          skipped.push({
            id: item.id,
            to: item.to,
            error: `Bloqueado por duplicado reciente (${dedupeWindowMinutes} min).`,
          });
          continue;
        }
        recentFingerprints.add(normalizedFingerprint);
        filtered.push(item);
      }
      deliverableCandidates = filtered;
    }

    if (deliveryMode === 'OUTLOOK') {
      const outlookResult = await this.sendViaOutlook(deliverableCandidates);
      sent.push(...outlookResult.sent);
      failed.push(...outlookResult.failed);
    } else {
      const { transporter, from, replyTo } = this.createSmtpTransport();
      await transporter.verify();

      for (const item of deliverableCandidates) {
        try {
          const info = await transporter.sendMail({
            from,
            to: item.to,
            cc: item.cc,
            replyTo,
            subject: item.subject,
            html: item.htmlBody,
          });

          sent.push({
            id: item.id,
            to: item.to,
            messageId: info.messageId ?? null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failed.push({
            id: item.id,
            to: item.to,
            error: message,
          });
        }
      }

      transporter.close();
    }

    if (sent.length) {
      await this.prisma.outboxMessage.updateMany({
        where: {
          id: {
            in: sent.map((item) => item.id),
          },
        },
        data: {
          status: 'SENT_AUTO',
        },
      });
    }

    if (sent.length || failed.length || skipped.length) {
      const candidateById = new Map(candidates.map((item) => [item.id, item]));
      const auditRows = [
        ...sent.map((item) => ({
          actor: 'SYSTEM',
          action: 'OUTBOX_SEND_SENT',
          entityType: 'OUTBOX_MESSAGE',
          entityId: item.id,
          details: {
            to: item.to,
            messageId: item.messageId,
            deliveryMode,
            forceToApplied: Boolean(payload.forceTo?.trim()),
            recipientName: candidateById.get(item.id)?.recipientName,
            fingerprint: candidateById.get(item.id)?.fingerprint,
          } satisfies SendAuditLogDetail,
        })),
        ...failed.map((item) => ({
          actor: 'SYSTEM',
          action: 'OUTBOX_SEND_FAILED',
          entityType: 'OUTBOX_MESSAGE',
          entityId: item.id,
          details: {
            to: item.to,
            error: item.error,
            deliveryMode,
            forceToApplied: Boolean(payload.forceTo?.trim()),
            recipientName: candidateById.get(item.id)?.recipientName,
            fingerprint: candidateById.get(item.id)?.fingerprint,
          } satisfies SendAuditLogDetail,
        })),
        ...skipped.map((item) => ({
          actor: 'SYSTEM',
          action: 'OUTBOX_SEND_SKIPPED_DUPLICATE',
          entityType: 'OUTBOX_MESSAGE',
          entityId: item.id,
          details: {
            to: item.to,
            error: item.error,
            deliveryMode,
            forceToApplied: Boolean(payload.forceTo?.trim()),
            recipientName: candidateById.get(item.id)?.recipientName,
            fingerprint: candidateById.get(item.id)?.fingerprint,
          } satisfies SendAuditLogDetail,
        })),
      ];

      await this.prisma.auditLog.createMany({
        data: auditRows,
      });
    }

    return {
      ok: failed.length === 0,
      dryRun: false,
      deliveryMode,
      sentCount: sent.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      sent,
      failed,
      skipped,
    };
  }

  async resendUpdated(rawPayload: unknown) {
    const payload = parseWithSchema(
      OutboxResendUpdatedSchema,
      rawPayload,
      'outbox resend-updated request',
    );

    const original = await this.prisma.outboxMessage.findUnique({
      where: { id: payload.id },
      include: {
        period: true,
        teacher: true,
      },
    });
    if (!original) {
      throw new NotFoundException(`No existe mensaje outbox con id ${payload.id}.`);
    }
    if (original.audience !== 'DOCENTE' || !original.teacherId || !original.teacher) {
      throw new BadRequestException(
        'Reenvio actualizado solo aplica a correos de audiencia DOCENTE.',
      );
    }
    if (!original.moment || !SUPPORTED_MOMENTS.includes(original.moment as (typeof SUPPORTED_MOMENTS)[number])) {
      throw new BadRequestException(
        `Momento invalido en mensaje ${payload.id}: ${original.moment}.`,
      );
    }
    if (!original.phase || !['ALISTAMIENTO', 'EJECUCION'].includes(original.phase)) {
      throw new BadRequestException(
        `Fase invalida en mensaje ${payload.id}: ${original.phase}.`,
      );
    }

    const regenerationStartedAt = new Date();
    const regeneration = await this.generateTeacherOutbox(original.period, {
      periodCode: original.period.code,
      phase: original.phase as 'ALISTAMIENTO' | 'EJECUCION',
      moment: original.moment as 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2',
      audience: 'DOCENTE',
      teacherId: original.teacherId,
    });
    if ((regeneration.created ?? 0) <= 0) {
      throw new NotFoundException(
        `No se genero correo actualizado para docente ${original.teacher.fullName} (${original.period.code} ${original.moment}).`,
      );
    }

    const refreshed = await this.prisma.outboxMessage.findFirst({
      where: {
        audience: 'DOCENTE',
        teacherId: original.teacherId,
        periodId: original.periodId,
        phase: original.phase,
        moment: original.moment,
        updatedAt: {
          gte: regenerationStartedAt,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!refreshed) {
      throw new NotFoundException(
        `No se pudo regenerar el correo para docente ${original.teacher.fullName}.`,
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actor: 'SYSTEM',
        action: 'OUTBOX_REGENERATED',
        entityType: 'OUTBOX_MESSAGE',
        entityId: refreshed.id,
        details: {
          fromMessageId: original.id,
          teacherId: original.teacherId,
          periodCode: original.period.code,
          phase: original.phase,
          moment: original.moment,
          forceToApplied: Boolean(payload.forceTo?.trim()),
        },
      },
    });

    if (payload.dryRun) {
      return {
        ok: true,
        dryRun: true,
        regeneratedMessageId: refreshed.id,
        teacherId: original.teacherId,
        teacherName: original.teacher.fullName,
        periodCode: original.period.code,
        phase: original.phase,
        moment: original.moment,
      };
    }

    const sendResult = await this.send({
      ids: [refreshed.id],
      forceTo: payload.forceTo?.trim(),
      dryRun: false,
    });

    return {
      ok: sendResult.ok,
      regeneratedMessageId: refreshed.id,
      teacherId: original.teacherId,
      teacherName: original.teacher.fullName,
      periodCode: original.period.code,
      phase: original.phase,
      moment: original.moment,
      sendResult,
    };
  }

  async resendByCourse(rawPayload: unknown) {
    const payload = parseWithSchema(
      OutboxResendByCourseSchema,
      rawPayload,
      'outbox resend-by-course request',
    );

    const course = await this.prisma.course.findUnique({
      where: { id: payload.courseId },
      include: {
        period: true,
        teacher: true,
      },
    });
    if (!course) {
      throw new NotFoundException(`No existe curso con id ${payload.courseId}.`);
    }
    if (!course.teacherId || !course.teacher) {
      throw new BadRequestException(
        `El curso ${course.nrc} no tiene docente vinculado. No se puede reenviar reporte.`,
      );
    }

    const moment = (course.moment ?? '').trim().toUpperCase();
    if (!moment || !SUPPORTED_MOMENTS.includes(moment as (typeof SUPPORTED_MOMENTS)[number])) {
      throw new BadRequestException(`Momento invalido en curso ${course.nrc}: ${course.moment}.`);
    }
    const phase: 'ALISTAMIENTO' | 'EJECUCION' = payload.phase ?? 'ALISTAMIENTO';

    const regenerationStartedAt = new Date();
    const regeneration = await this.generateTeacherOutbox(course.period, {
      periodCode: course.period.code,
      phase,
      moment: moment as GeneratePayload['moment'],
      audience: 'DOCENTE',
      teacherId: course.teacherId,
    });
    if ((regeneration.created ?? 0) <= 0) {
      throw new NotFoundException(
        `No se genero correo actualizado para docente ${course.teacher.fullName} en ${course.period.code} ${moment}.`,
      );
    }

    const refreshed = await this.prisma.outboxMessage.findFirst({
      where: {
        audience: 'DOCENTE',
        teacherId: course.teacherId,
        periodId: course.periodId,
        phase,
        moment,
        updatedAt: {
          gte: regenerationStartedAt,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!refreshed) {
      throw new NotFoundException(
        `No se pudo regenerar el correo para docente ${course.teacher.fullName}.`,
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actor: 'SYSTEM',
        action: 'OUTBOX_REGENERATED_BY_COURSE',
        entityType: 'OUTBOX_MESSAGE',
        entityId: refreshed.id,
        details: {
          courseId: course.id,
          nrc: course.nrc,
          teacherId: course.teacherId,
          teacherName: course.teacher.fullName,
          periodCode: course.period.code,
          phase,
          moment,
          forceToApplied: Boolean(payload.forceTo?.trim()),
        },
      },
    });

    if (payload.dryRun) {
      return {
        ok: true,
        dryRun: true,
        regeneratedMessageId: refreshed.id,
        courseId: course.id,
        nrc: course.nrc,
        teacherId: course.teacherId,
        teacherName: course.teacher.fullName,
        periodCode: course.period.code,
        phase,
        moment,
      };
    }

    const sendResult = await this.send({
      ids: [refreshed.id],
      forceTo: payload.forceTo?.trim(),
      dryRun: false,
    });

    return {
      ok: sendResult.ok,
      regeneratedMessageId: refreshed.id,
      courseId: course.id,
      nrc: course.nrc,
      teacherId: course.teacherId,
      teacherName: course.teacher.fullName,
      periodCode: course.period.code,
      phase,
      moment,
      sendResult,
    };
  }

  async list(periodCode?: string, status?: string) {
    const items = await this.prisma.outboxMessage.findMany({
      where: {
        status: status || undefined,
        period: periodCode ? { code: periodCode } : undefined,
      },
      include: {
        teacher: true,
        coordinator: true,
        period: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 1000,
    });

    return {
      total: items.length,
      items,
    };
  }

  async tracking(query: OutboxTrackingQuery) {
    const page = this.parsePositiveInt(query.page, 1, 1, 9999);
    const pageSize = this.parsePositiveInt(query.pageSize, 25, 1, 100);
    const search = query.search?.trim();
    const where = {
      period: query.periodCode ? { code: query.periodCode.trim() } : undefined,
      phase: query.phase || undefined,
      moment: query.moment || undefined,
      audience: query.audience || undefined,
      status: query.status || undefined,
      OR: search
        ? [
            { subject: { contains: search, mode: 'insensitive' as const } },
            { recipientName: { contains: search, mode: 'insensitive' as const } },
            { recipientEmail: { contains: search, mode: 'insensitive' as const } },
            { teacher: { fullName: { contains: search, mode: 'insensitive' as const } } },
            { coordinator: { fullName: { contains: search, mode: 'insensitive' as const } } },
          ]
        : undefined,
    };

    const [total, groupedByStatus, items] = await this.prisma.$transaction([
      this.prisma.outboxMessage.count({ where }),
      this.prisma.outboxMessage.groupBy({
        by: ['status'],
        where,
        orderBy: { status: 'asc' },
        _count: { status: true },
      }),
      this.prisma.outboxMessage.findMany({
        where,
        include: {
          teacher: { select: { id: true, fullName: true, email: true } },
          coordinator: { select: { fullName: true, email: true } },
          period: { select: { code: true, label: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const statusCounts = groupedByStatus.reduce<Record<string, number>>((acc, item) => {
      const countValue =
        typeof item._count === 'object' && item._count && 'status' in item._count
          ? Number(item._count.status ?? 0)
          : 0;
      acc[item.status] = countValue;
      return acc;
    }, {});

    const messageIds = items.map((item) => item.id);
    const logs = messageIds.length
      ? await this.prisma.auditLog.findMany({
          where: {
            entityType: 'OUTBOX_MESSAGE',
            entityId: { in: messageIds },
            action: { in: ['OUTBOX_SEND_SENT', 'OUTBOX_SEND_FAILED'] },
          },
          orderBy: [{ createdAt: 'desc' }],
        })
      : [];

    const logsByMessage = new Map<
      string,
      {
        attempts: number;
        last: {
          action: string;
          createdAt: Date;
          details: SendAuditLogDetail | null;
        } | null;
      }
    >();

    for (const log of logs) {
      const current = logsByMessage.get(log.entityId) ?? { attempts: 0, last: null };
      current.attempts += 1;
      if (!current.last) {
        const detail =
          log.details && typeof log.details === 'object' && !Array.isArray(log.details)
            ? (log.details as SendAuditLogDetail)
            : null;
        current.last = {
          action: log.action,
          createdAt: log.createdAt,
          details: detail,
        };
      }
      logsByMessage.set(log.entityId, current);
    }

    const sentTotal =
      (statusCounts.SENT_AUTO ?? 0) +
      (statusCounts.SENT_MANUAL ?? 0);
    const draftTotal =
      (statusCounts.DRAFT ?? 0) +
      (statusCounts.EXPORTED ?? 0);

    return {
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      summary: {
        sent: sentTotal,
        pending: draftTotal,
        byStatus: statusCounts,
      },
      note:
        'El estado SENT indica que Outlook/SMTP acepto el envio. La confirmacion de entrega final al destinatario depende del servidor de correo y no siempre esta disponible.',
      items: items.map((item) => {
        const sendLogs = logsByMessage.get(item.id);
        const last = sendLogs?.last ?? null;
        const lastResult =
          last?.action === 'OUTBOX_SEND_SENT'
            ? 'SENT'
            : last?.action === 'OUTBOX_SEND_FAILED'
              ? 'FAILED'
              : null;
        return {
          id: item.id,
          periodCode: item.period.code,
          periodLabel: item.period.label,
          phase: item.phase,
          moment: item.moment,
          audience: item.audience,
          status: item.status,
          subject: item.subject,
          recipientName:
            item.recipientName ??
            item.teacher?.fullName ??
            item.coordinator?.fullName ??
            null,
          recipientEmail:
            item.recipientEmail ??
            item.teacher?.email ??
            item.coordinator?.email ??
            null,
          teacherId: item.teacher?.id ?? null,
          attempts: sendLogs?.attempts ?? 0,
          lastAttemptAt: last?.createdAt ?? null,
          lastAttemptResult: lastResult,
          lastAttemptError: last?.details?.error ?? null,
          lastDeliveryMode: last?.details?.deliveryMode ?? null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
    };
  }
}
