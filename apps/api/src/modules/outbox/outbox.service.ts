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
  periodCodes?: string[];
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2';
  moments?: Array<'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2'>;
  audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
  teacherId?: string;
  recipientName?: string;
  recipientEmails?: string[];
};

type SendPayload = {
  ids?: string[];
  periodCode?: string;
  periodCodes?: string[];
  phase?: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2';
  moments?: Array<'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2'>;
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
  messageCreatedAt: Date;
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

const OutboxPreviewByCourseSchema = z.object({
  courseId: z.string().trim().min(1),
  phase: z.enum(['ALISTAMIENTO', 'EJECUCION']).default('ALISTAMIENTO'),
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

function normalizeMomentList(
  moment?: GeneratePayload['moment'] | SendPayload['moment'],
  moments?: GeneratePayload['moments'] | SendPayload['moments'],
): Array<(typeof SUPPORTED_MOMENTS)[number]> {
  const seen = new Set<(typeof SUPPORTED_MOMENTS)[number]>();
  const selected: Array<(typeof SUPPORTED_MOMENTS)[number]> = [];
  for (const value of [moment, ...(moments ?? [])]) {
    if (!value || !SUPPORTED_MOMENTS.includes(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    selected.push(value);
  }
  return selected;
}

function normalizeRecipientEmails(input: string[] | undefined): string[] {
  if (!input?.length) return [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of input) {
    const normalized = raw.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(normalized);
  }
  return emails;
}

function normalizePeriodCodeList(
  periodCode?: string,
  periodCodes?: string[],
): string[] {
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const value of [periodCode, ...(periodCodes ?? [])]) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    selected.push(normalized);
  }
  return selected;
}

function parseStoredRecipientEmails(value?: string | null): string[] {
  if (!value) return [];
  return normalizeRecipientEmails(value.split(/[\n,;]+/));
}

type CourseCoordinationRow = {
  periodCode: string;
  periodLabel: string | null;
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

type GlobalSummaryRow = {
  coordination: string;
  total: number;
  average: number | null;
  excellent: number;
  good: number;
  acceptable: number;
  unsatisfactory: number;
};

type GlobalPeriodSummaryRow = {
  periodCode: string;
  moments: string[];
  total: number;
  average: number | null;
  excellent: number;
  good: number;
  acceptable: number;
  unsatisfactory: number;
};

type GlobalMomentSummaryRow = {
  moment: string;
  total: number;
  average: number | null;
  excellent: number;
  good: number;
  acceptable: number;
  unsatisfactory: number;
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

  private normalizeGlobalSelectedPeriods(rawPeriodCodes: string[] | undefined, fallbackPeriodCode: string): string[] {
    const selected = normalizePeriodCodeList(fallbackPeriodCode, rawPeriodCodes)
      .filter((code) => code.startsWith('2026'))
      .filter((code) => !/(80|85)$/.test(code));
    return selected.length ? selected : [fallbackPeriodCode];
  }

  private extractGlobalSelectedPeriods(message: {
    periodCode: string;
    programCode?: string | null;
    htmlBody?: string | null;
  }): string[] {
    const fromProgramCode = normalizePeriodCodeList(undefined, (message.programCode ?? '').split(/[|,;]+/));
    if (fromProgramCode.length) {
      return this.normalizeGlobalSelectedPeriods(fromProgramCode, message.periodCode);
    }

    const htmlBody = message.htmlBody ?? '';
    const matches = htmlBody.match(/\b2026\d{2}\b/g) ?? [];
    const fromHtml = [...new Set(matches)];
    return this.normalizeGlobalSelectedPeriods(fromHtml, message.periodCode);
  }

  private encodeCoordinatorProgramMetadata(programId: string, periodCodes: string[]): string {
    return `${programId}||${periodCodes.join('|')}`;
  }

  private extractCoordinatorMetadata(message: {
    periodCode: string;
    programCode?: string | null;
  }): {
    programId: string | null;
    periodCodes: string[];
  } {
    const raw = message.programCode?.trim() ?? '';
    if (!raw) {
      return {
        programId: null,
        periodCodes: [message.periodCode],
      };
    }

    const [programIdRaw, periodsRaw] = raw.split('||');
    const programId = (programIdRaw || raw).trim() || null;
    const periodCodes = periodsRaw
      ? this.normalizeGlobalSelectedPeriods(periodsRaw.split(/[|,;]+/), message.periodCode)
      : [message.periodCode];
    return {
      programId,
      periodCodes,
    };
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
      .map((row) => {
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
        const resultBadgeClass = row.resultType === 'REVISADO' ? 'badge-primary' : 'badge-muted';
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
      })
      .join('');
    const extraStyle = [
      '<style>',
      '.course-cards{display:flex;flex-direction:column;gap:12px;}',
      '.course-card{background:#ffffff;border:1px solid #d4d7dd;border-radius:14px;padding:12px 14px;box-shadow:0 2px 8px rgba(15,23,42,0.04);}',
      '.course-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px;}',
      '.course-card-title{font-size:13px;font-weight:800;color:#0a3e74;}',
      '.result-badge{display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.25px;text-transform:uppercase;border:1px solid transparent;}',
      '.badge-primary{background:#e8f0fb;color:#0a4e8a;border-color:#c5d8f2;}',
      '.badge-muted{background:#f3f4f6;color:#475569;border-color:#d8dee7;}',
      '.course-card-score{margin:0 0 10px 0;font-size:13px;font-weight:700;color:#334155;}',
      '.course-kv{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;}',
      '.course-kv td{padding:8px 0;border-top:1px solid #e4e9f1;vertical-align:top;color:#334155;line-height:1.45;}',
      '.course-kv tr:first-child td{border-top:0;}',
      '.kv-key{width:32%;padding-right:12px;font-size:11px;font-weight:800;letter-spacing:0.28px;text-transform:uppercase;color:#94a3b8;}',
      '.kv-val{font-weight:600;color:#334155;}',
      '@media only screen and (max-width:640px){.shell{margin:12px auto!important;border-radius:10px!important;}.body-wrap{padding:14px!important;}.hero{padding:14px!important;}.report-table{font-size:11px!important;}.report-table th,.report-table td{padding:8px 6px!important;}.course-card{padding:12px!important;}.course-card-head{flex-direction:column!important;align-items:flex-start!important;}.course-kv,.course-kv tbody,.course-kv tr,.course-kv td{display:block;width:100%;}.course-kv td{padding:6px 0!important;}.kv-key{padding-right:0!important;}}',
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
    moments: string[];
    periodCodes: string[];
    uniqueTeachers: number;
    rows: Array<{
      periodCode: string;
      teacherName: string;
      nrc: string;
      subject: string;
      moment: string;
      status: string;
      template: string;
      score: number | null;
    }>;
  }) {
    const templateStyle =
      this.loadTemplateStyle('reporte_docente_albeiro_m1_ryc_alistamiento_preview.html') ||
      this.loadTemplateStyle('ejemplo Programas - Coordinaciones.html');
    const phaseUpper = options.phase.toUpperCase();
    const phaseLabel = options.phase === 'ALISTAMIENTO' ? 'Alistamiento' : 'Ejecucion';
    const scoreScale = phaseUpper === 'ALISTAMIENTO' ? 50 : 100;
    const scoredRows = options.rows.filter((row) => row.score != null);
    const average = scoredRows.length
      ? scoredRows.reduce((acc, row) => acc + (row.score ?? 0), 0) / scoredRows.length
      : null;
    const bandCounter = {
      EXCELENTE: 0,
      BUENO: 0,
      ACEPTABLE: 0,
      INSATISFACTORIO: 0,
    };
    const moodleStatusCounter = new Map<string, number>();
    const templateCounter = new Map<string, number>();
    for (const row of options.rows) {
      const band = this.toScoreBandForPhase(row.score, phaseUpper);
      bandCounter[band] += 1;
      const normalizedStatus = (row.status || 'SIN_CHECK').trim().toUpperCase() || 'SIN_CHECK';
      const normalizedTemplate = (row.template || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
      moodleStatusCounter.set(normalizedStatus, (moodleStatusCounter.get(normalizedStatus) ?? 0) + 1);
      templateCounter.set(normalizedTemplate, (templateCounter.get(normalizedTemplate) ?? 0) + 1);
    }
    const asPercent = (count: number) =>
      options.rows.length ? Number(((count / options.rows.length) * 100).toFixed(1)) : 0;
    const scoreSeg = {
      EXCELENTE: asPercent(bandCounter.EXCELENTE),
      BUENO: asPercent(bandCounter.BUENO),
      ACEPTABLE: asPercent(bandCounter.ACEPTABLE),
      INSATISFACTORIO: asPercent(bandCounter.INSATISFACTORIO),
    };
    const selectedMomentsLabel = options.moments
      .map((moment) => `${formatMomentLabel(moment)} (${moment})`)
      .join(' | ');
    const selectedPeriodsLabel = options.periodCodes.join(', ');
    const summaryByPeriod = new Map<
      string,
      { total: number; scoreSum: number; scoredCount: number; excellent: number; good: number; acceptable: number; unsatisfactory: number }
    >();
    const summaryByMoment = new Map<
      string,
      { total: number; scoreSum: number; scoredCount: number; excellent: number; good: number; acceptable: number; unsatisfactory: number }
    >();
    const topStatuses = Array.from(moodleStatusCounter.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3);
    const topTemplates = Array.from(templateCounter.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3);
    const rowsHtml = options.rows
      .map((row) => {
        const band = this.toScoreBandForPhase(row.score, phaseUpper);
        const periodSummary = summaryByPeriod.get(row.periodCode) ?? {
          total: 0,
          scoreSum: 0,
          scoredCount: 0,
          excellent: 0,
          good: 0,
          acceptable: 0,
          unsatisfactory: 0,
        };
        const momentSummary = summaryByMoment.get(row.moment) ?? {
          total: 0,
          scoreSum: 0,
          scoredCount: 0,
          excellent: 0,
          good: 0,
          acceptable: 0,
          unsatisfactory: 0,
        };
        periodSummary.total += 1;
        momentSummary.total += 1;
        if (row.score != null) {
          periodSummary.scoreSum += row.score;
          periodSummary.scoredCount += 1;
          momentSummary.scoreSum += row.score;
          momentSummary.scoredCount += 1;
        }
        if (band === 'EXCELENTE') {
          periodSummary.excellent += 1;
          momentSummary.excellent += 1;
        }
        if (band === 'BUENO') {
          periodSummary.good += 1;
          momentSummary.good += 1;
        }
        if (band === 'ACEPTABLE') {
          periodSummary.acceptable += 1;
          momentSummary.acceptable += 1;
        }
        if (band === 'INSATISFACTORIO') {
          periodSummary.unsatisfactory += 1;
          momentSummary.unsatisfactory += 1;
        }
        summaryByPeriod.set(row.periodCode, periodSummary);
        summaryByMoment.set(row.moment, momentSummary);
        const bandLabel =
          band === 'EXCELENTE'
            ? 'Excelente'
            : band === 'BUENO'
              ? 'Bueno'
              : band === 'ACEPTABLE'
                ? 'Aceptable'
                : 'Insatisfactorio';
        const statusClass =
          band === 'EXCELENTE'
            ? 'status-success'
            : band === 'BUENO'
              ? 'status-info'
              : band === 'ACEPTABLE'
                ? 'status-warning'
                : 'status-danger';
        return [
          '<tr>',
          `<td>${escapeHtml(row.periodCode)}</td>`,
          `<td>${escapeHtml(row.teacherName)}</td>`,
          `<td>${escapeHtml(row.nrc)}</td>`,
          `<td>${escapeHtml(row.subject)}</td>`,
          `<td>${escapeHtml(formatMomentLabel(row.moment))} (${escapeHtml(row.moment)})</td>`,
          `<td>${escapeHtml(row.status || 'SIN_CHECK')}</td>`,
          `<td>${escapeHtml(row.template || 'UNKNOWN')}</td>`,
          `<td class="t-center">${escapeHtml(this.formatScoreForPhase(row.score, phaseUpper))}</td>`,
          `<td class="t-center"><span class="status-pill ${statusClass}">${escapeHtml(bandLabel)}</span></td>`,
          '</tr>',
        ].join('');
      })
      .join('');
    const periodRowsHtml = options.periodCodes
      .map((periodCode, idx) => {
        const row = summaryByPeriod.get(periodCode) ?? {
          total: 0,
          scoreSum: 0,
          scoredCount: 0,
          excellent: 0,
          good: 0,
          acceptable: 0,
          unsatisfactory: 0,
        };
        const background = idx % 2 === 0 ? '#ffffff' : '#f8fbff';
        return [
          `<tr style="background:${background};font-size:14px;">`,
          `<td style="padding:8px 12px;text-align:left;font-weight:700;color:#0a3e74;">${escapeHtml(periodCode)}</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.total}</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.scoredCount > 0 ? (row.scoreSum / row.scoredCount).toFixed(1) : 'N/A'}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dcfce7;">${row.excellent}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dbeafe;">${row.good}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#ffedd5;">${row.acceptable}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#fee2e2;">${row.unsatisfactory}</td>`,
          '</tr>',
        ].join('');
      })
      .join('');
    const momentRowsHtml = options.moments
      .map((moment, idx) => {
        const row = summaryByMoment.get(moment) ?? {
          total: 0,
          scoreSum: 0,
          scoredCount: 0,
          excellent: 0,
          good: 0,
          acceptable: 0,
          unsatisfactory: 0,
        };
        const background = idx % 2 === 0 ? '#ffffff' : '#f8fbff';
        return [
          `<tr style="background:${background};font-size:14px;">`,
          `<td style="padding:8px 12px;text-align:left;font-weight:700;color:#0a3e74;">${escapeHtml(formatMomentLabel(moment))} (${escapeHtml(moment)})</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.total}</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.scoredCount > 0 ? (row.scoreSum / row.scoredCount).toFixed(1) : 'N/A'}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dcfce7;">${row.excellent}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dbeafe;">${row.good}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#ffedd5;">${row.acceptable}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#fee2e2;">${row.unsatisfactory}</td>`,
          '</tr>',
        ].join('');
      })
      .join('');
    const extraStyle = [
      '<style>',
      '.status-pill{display:inline-flex;align-items:center;justify-content:center;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.25px;text-transform:uppercase;border:1px solid transparent;white-space:nowrap;}',
      '.status-success{background:#dcfce7;color:#166534;border-color:#bbf7d0;}',
      '.status-info{background:#dbeafe;color:#1d4ed8;border-color:#bfdbfe;}',
      '.status-warning{background:#ffedd5;color:#9a3412;border-color:#fed7aa;}',
      '.status-danger{background:#fee2e2;color:#b91c1c;border-color:#fecaca;}',
      '.summary-list{margin:0;padding-left:18px;color:#334155;font-size:13px;line-height:1.6;}',
      '.summary-list strong{color:#0f172a;}',
      '.report-table td{vertical-align:middle;}',
      '@media only screen and (max-width:640px){.shell{margin:12px auto!important;border-radius:10px!important;}.body-wrap{padding:14px!important;}.hero{padding:14px!important;}.report-table{font-size:11px!important;}.report-table th,.report-table td{padding:8px 6px!important;}.status-pill{width:100%;}}',
      '</style>',
    ].join('');
    const summaryNotes = [
      `<li><strong>Momentos consolidados:</strong> ${escapeHtml(selectedMomentsLabel)}.</li>`,
      `<li><strong>Periodos incluidos:</strong> ${escapeHtml(selectedPeriodsLabel)}.</li>`,
      `<li><strong>NRC consolidados:</strong> ${options.rows.length} aulas consolidadas para el programa ${escapeHtml(options.programId)}.</li>`,
      `<li><strong>Docentes impactados:</strong> ${options.uniqueTeachers} docente(s) con aulas reportadas en este corte.</li>`,
      `<li><strong>Plantillas mas frecuentes:</strong> ${
        topTemplates.length
          ? topTemplates.map(([template, count]) => `${escapeHtml(template)} (${count})`).join(', ')
          : 'Sin informacion disponible'
      }.</li>`,
      `<li><strong>Estados Moodle mas frecuentes:</strong> ${
        topStatuses.length
          ? topStatuses.map(([status, count]) => `${escapeHtml(status)} (${count})`).join(', ')
          : 'Sin informacion disponible'
      }.</li>`,
    ].join('');

    return [
      '<html><head>',
      templateStyle,
      extraStyle,
      '</head><body>',
      '<div class="shell"><div class="top-strip" style="background:#ffc300;background-image:linear-gradient(90deg,#ffc300 0%,#ffd95c 100%);"></div>',
      '<div class="hero" style="background:#002b5c;background-image:linear-gradient(120deg,#002b5c 0%,#0057a4 100%);color:#ffffff;">',
      '<h2 class="hero-title">Reporte de seguimiento - <span class="hero-highlight">Campus Virtual RCS</span></h2>',
      `<div class="hero-subtitle">Programa ${escapeHtml(options.programId)} | Fase de ${escapeHtml(phaseLabel)} | Momentos ${escapeHtml(
        options.moments.map((moment) => formatMomentLabel(moment)).join(' + '),
      )}</div>`,
      `<div class="hero-period-pill">Periodos incluidos: ${escapeHtml(selectedPeriodsLabel)}</div>`,
      '</div>',
      '<div class="body-wrap">',
      `<div class="period-banner">PERIODOS: ${escapeHtml(selectedPeriodsLabel)} | FASE: ${escapeHtml(options.phase)} | MOMENTOS: ${escapeHtml(selectedMomentsLabel)}</div>`,
      '<div class="quick-access"><p class="quick-access-title">Acceso rapido</p><p class="quick-access-text">Antes de revisar el consolidado del programa, puede consultar el comunicado y los criterios oficiales del seguimiento.</p><div class="quick-access-actions">',
      `<a class="cta-btn alt" href="${CAMPUS_VIRTUAL_COMMUNICADO_URL}" target="_blank" rel="noopener">Ver comunicado Campus Virtual</a>`,
      '</div></div>',
      `<p><strong>Cordial saludo, ${escapeHtml(options.coordinatorName)},</strong></p>`,
      `<p>Desde Campus Virtual compartimos el consolidado del programa <strong>${escapeHtml(options.programId)}</strong> integrando los periodos ${escapeHtml(selectedPeriodsLabel)} y los momentos ${escapeHtml(selectedMomentsLabel)} en un solo correo. A continuacion encontrara el resumen del corte y el detalle por NRC para apoyar el seguimiento con sus docentes.</p>`,
      '<div class="panel">',
      '<div class="section-title">Resumen de desempeno del programa</div>',
      '<div class="kpi-grid">',
      '<div class="kpi"><div class="kpi-label">Periodos</div>',
      `<div class="kpi-value">${options.periodCodes.length}</div></div>`,
      '<div class="kpi"><div class="kpi-label">Momentos</div>',
      `<div class="kpi-value">${options.moments.length}</div></div>`,
      '<div class="kpi"><div class="kpi-label">Docentes</div>',
      `<div class="kpi-value">${options.uniqueTeachers}</div></div>`,
      '<div class="kpi"><div class="kpi-label">Aulas reportadas</div>',
      `<div class="kpi-value">${options.rows.length}</div></div>`,
      '<div class="kpi"><div class="kpi-label">Promedio final</div>',
      `<div class="kpi-value">${average == null ? 'N/A' : average.toFixed(1)}</div>`,
      `<div class="kpi-meta">(0-${scoreScale})</div></div>`,
      '<div class="kpi kpi-success"><div class="kpi-label">Excelente</div>',
      `<div class="kpi-value">${bandCounter.EXCELENTE}</div><div class="kpi-meta">${scoreSeg.EXCELENTE}%</div></div>`,
      '<div class="kpi kpi-info"><div class="kpi-label">Bueno</div>',
      `<div class="kpi-value">${bandCounter.BUENO}</div><div class="kpi-meta">${scoreSeg.BUENO}%</div></div>`,
      '<div class="kpi kpi-warning"><div class="kpi-label">Aceptable</div>',
      `<div class="kpi-value">${bandCounter.ACEPTABLE}</div><div class="kpi-meta">${scoreSeg.ACEPTABLE}%</div></div>`,
      '<div class="kpi kpi-danger"><div class="kpi-label">Insatisfactorio</div>',
      `<div class="kpi-value">${bandCounter.INSATISFACTORIO}</div><div class="kpi-meta">${scoreSeg.INSATISFACTORIO}%</div></div>`,
      '</div>',
      '<div class="score-bar-wrap"><p class="score-bar-title">Barra de desempeno (Excelente / Bueno / Aceptable / Insatisfactorio)</p>',
      '<div class="score-bar">',
      `<div class="score-seg seg-exc" style="width:${scoreSeg.EXCELENTE}%;">${scoreSeg.EXCELENTE > 0 ? `Excelente ${scoreSeg.EXCELENTE}%` : ''}</div>`,
      `<div class="score-seg seg-good" style="width:${scoreSeg.BUENO}%;">${scoreSeg.BUENO > 0 ? `Bueno ${scoreSeg.BUENO}%` : ''}</div>`,
      `<div class="score-seg seg-ok" style="width:${scoreSeg.ACEPTABLE}%;">${scoreSeg.ACEPTABLE > 0 ? `Aceptable ${scoreSeg.ACEPTABLE}%` : ''}</div>`,
      `<div class="score-seg seg-bad" style="width:${scoreSeg.INSATISFACTORIO}%;">${scoreSeg.INSATISFACTORIO > 0 ? `Insatisf. ${scoreSeg.INSATISFACTORIO}%` : ''}</div>`,
      '</div><div class="score-legend">',
      `<span class="legend-item"><span class="legend-dot dot-exc"></span>Excelente: ${bandCounter.EXCELENTE} (${scoreSeg.EXCELENTE}%)</span>`,
      `<span class="legend-item"><span class="legend-dot dot-good"></span>Bueno: ${bandCounter.BUENO} (${scoreSeg.BUENO}%)</span>`,
      `<span class="legend-item"><span class="legend-dot dot-ok"></span>Aceptable: ${bandCounter.ACEPTABLE} (${scoreSeg.ACEPTABLE}%)</span>`,
      `<span class="legend-item"><span class="legend-dot dot-bad"></span>Insatisfactorio: ${bandCounter.INSATISFACTORIO} (${scoreSeg.INSATISFACTORIO}%)</span>`,
      '</div></div></div>',
      '<div class="panel">',
      '<div class="section-title">Corte por momento</div>',
      '<div class="table-container">',
      '<table class="report-table">',
      '<thead><tr><th>Momento</th><th>Aulas</th><th>Promedio</th><th>Excelente</th><th>Bueno</th><th>Aceptable</th><th>Insatisf.</th></tr></thead>',
      `<tbody>${momentRowsHtml}</tbody>`,
      '</table></div></div>',
      '<div class="panel">',
      '<div class="section-title">Corte por periodo</div>',
      '<div class="table-container">',
      '<table class="report-table">',
      '<thead><tr><th>Periodo</th><th>Aulas</th><th>Promedio</th><th>Excelente</th><th>Bueno</th><th>Aceptable</th><th>Insatisf.</th></tr></thead>',
      `<tbody>${periodRowsHtml}</tbody>`,
      '</table></div></div>',
      '<div class="panel">',
      `<div class="section-title">Detalle por NRC - ${escapeHtml(options.programId)}</div>`,
      '<div class="table-container">',
      '<table class="report-table">',
      '<thead><tr><th>Periodo</th><th>Docente</th><th>NRC</th><th>Asignatura</th><th>Momento</th><th>Estado Moodle</th><th>Plantilla</th><th>Puntaje fase</th><th>Resultado</th></tr></thead>',
      `<tbody>${rowsHtml}</tbody>`,
      '</table></div></div>',
      '<div class="panel panel-warm">',
      '<div class="section-title" style="color:#7a5b00;">Observaciones priorizadas para siguiente ciclo</div>',
      `<ul class="summary-list">${summaryNotes}</ul>`,
      '</div>',
      '<div class="action-panel">',
      '<p class="action-title">Acompanamiento por programa</p>',
      '<p class="action-text">Si requiere revisar hallazgos del programa o priorizar seguimiento con su coordinacion, puede agendar un espacio con Campus Virtual.</p>',
      '<div class="cta-wrap" style="margin-top:0;">',
      `<a class="cta-btn" href="${TEACHER_BOOKING_URL}" target="_blank" rel="noopener">Agendar llamada / videollamada</a>`,
      '</div></div>',
      '<div style="margin-top:16px;text-align:center;color:#334155;font-size:13px;">Campus Virtual - Rectoria Centro Sur</div>',
      `<div class="report-footer">Generado el ${new Date().toISOString().slice(0, 10)} - Reporte automatico de seguimiento de aulas.</div>`,
      '</div></div>',
      '</body></html>',
    ].join('');
  }

  private matchCoordinatorCourse(
    coordinatorProgramKey: string,
    courseCoordinationKey: string,
  ): boolean {
    if (!coordinatorProgramKey || !courseCoordinationKey) return false;
    return (
      courseCoordinationKey === coordinatorProgramKey ||
      courseCoordinationKey.includes(coordinatorProgramKey) ||
      coordinatorProgramKey.includes(courseCoordinationKey)
    );
  }

  private buildGlobalHtml(options: {
    phase: string;
    moments: string[];
    periodCodes: string[];
    totalCourses: number;
    averageScore: number | null;
    excellent: number;
    good: number;
    acceptable: number;
    unsatisfactory: number;
    rows: GlobalSummaryRow[];
    periodSummary: GlobalPeriodSummaryRow[];
    momentSummary: GlobalMomentSummaryRow[];
    recipientsCount: number;
  }) {
    const templateStyle =
      this.loadTemplateStyle('reporte_docente_albeiro_m1_ryc_alistamiento_preview.html') ||
      this.loadTemplateStyle('ejemplo global .html');
    const phaseUpper = options.phase.toUpperCase();
    const phaseLabel = options.phase === 'ALISTAMIENTO' ? 'Alistamiento' : 'Ejecucion';
    const scoreScale = phaseUpper === 'ALISTAMIENTO' ? 50 : 100;
    const averageLabel = options.averageScore == null ? 'N/A' : options.averageScore.toFixed(1);
    const asPercent = (count: number) =>
      options.totalCourses ? Number(((count / options.totalCourses) * 100).toFixed(1)) : 0;
    const scoreSeg = {
      EXCELENTE: asPercent(options.excellent),
      BUENO: asPercent(options.good),
      ACEPTABLE: asPercent(options.acceptable),
      INSATISFACTORIO: asPercent(options.unsatisfactory),
    };
    const selectedMomentsLabel = options.moments
      .map((moment) => `${formatMomentLabel(moment)} (${moment})`)
      .join(' | ');
    const selectedPeriodsLabel = options.periodCodes.join(', ');
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
    const periodRowsHtml = options.periodSummary
      .map((row, idx) => {
        const background = idx % 2 === 0 ? '#ffffff' : '#f8fbff';
        return [
          `<tr style="background:${background};font-size:14px;">`,
          `<td style="padding:8px 12px;text-align:left;font-weight:700;color:#0a3e74;">${escapeHtml(row.periodCode)}</td>`,
          `<td style="padding:8px 12px;text-align:left;">${escapeHtml(
            row.moments.map((moment) => formatMomentLabel(moment)).join(', '),
          )}</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.total}</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.average == null ? 'N/A' : row.average.toFixed(1)}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dcfce7;">${row.excellent}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dbeafe;">${row.good}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#ffedd5;">${row.acceptable}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#fee2e2;">${row.unsatisfactory}</td>`,
          '</tr>',
        ].join('');
      })
      .join('');
    const momentRowsHtml = options.momentSummary
      .map((row, idx) => {
        const background = idx % 2 === 0 ? '#ffffff' : '#f8fbff';
        return [
          `<tr style="background:${background};font-size:14px;">`,
          `<td style="padding:8px 12px;text-align:left;font-weight:700;color:#0a3e74;">${escapeHtml(
            formatMomentLabel(row.moment),
          )} (${escapeHtml(row.moment)})</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.total}</td>`,
          `<td style="padding:8px 12px;text-align:center;">${row.average == null ? 'N/A' : row.average.toFixed(1)}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dcfce7;">${row.excellent}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#dbeafe;">${row.good}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#ffedd5;">${row.acceptable}</td>`,
          `<td style="padding:8px 12px;text-align:center;background:#fee2e2;">${row.unsatisfactory}</td>`,
          '</tr>',
        ].join('');
      })
      .join('');
    const summaryNotes = [
      `<li><strong>Periodos incluidos:</strong> ${escapeHtml(selectedPeriodsLabel)}.</li>`,
      `<li><strong>Momentos consolidados:</strong> ${escapeHtml(selectedMomentsLabel)}.</li>`,
      `<li><strong>Escala de fase:</strong> ${scoreScale} puntos maximos para ${escapeHtml(
        phaseLabel,
      ).toLowerCase()}.</li>`,
      `<li><strong>Total coordinaciones reportadas:</strong> ${options.rows.length} coordinacion(es) con cursos en el consolidado.</li>`,
      `<li><strong>Destinatarios del correo:</strong> ${options.recipientsCount} correo(s) configurados en este envio.</li>`,
    ].join('');

    return [
      '<html><head>',
      templateStyle,
      '</head><body>',
      '<div class="shell"><div class="top-strip" style="background:#ffc300;background-image:linear-gradient(90deg,#ffc300 0%,#ffd95c 100%);"></div>',
      '<div class="hero" style="background:#002b5c;background-image:linear-gradient(120deg,#002b5c 0%,#0057a4 100%);color:#ffffff;">',
      '<h2 class="hero-title">Reporte ejecutivo - <span class="hero-highlight">Campus Virtual RCS</span></h2>',
      `<div class="hero-subtitle">Consolidado 2026 | Fase de ${escapeHtml(phaseLabel)} | Momentos ${escapeHtml(
        options.moments.map((moment) => formatMomentLabel(moment)).join(' + '),
      )}</div>`,
      `<div class="hero-period-pill">Periodos incluidos: ${escapeHtml(selectedPeriodsLabel)}</div>`,
      '</div>',
      '<div class="body-wrap">',
      `<div class="period-banner">FASE: ${escapeHtml(options.phase)} | MOMENTOS: ${escapeHtml(
        selectedMomentsLabel,
      )} | PERIODOS: ${escapeHtml(selectedPeriodsLabel)}</div>`,
      '<div class="quick-access"><p class="quick-access-title">Lectura recomendada</p><p class="quick-access-text">Este consolidado integra varios periodos 2026 en un solo reporte para priorizar decisiones de seguimiento.</p><div class="quick-access-actions">',
      `<a class="cta-btn alt" href="${CAMPUS_VIRTUAL_COMMUNICADO_URL}" target="_blank" rel="noopener">Ver comunicado Campus Virtual</a>`,
      '</div></div>',
      '<p><strong>Cordial saludo,</strong></p>',
      `<p>Compartimos el consolidado ejecutivo de seguimiento de aulas para ${escapeHtml(
        phaseLabel.toLowerCase(),
      )}, integrando los momentos ${escapeHtml(selectedMomentsLabel)} y los periodos ${escapeHtml(
        selectedPeriodsLabel,
      )} en un solo correo.</p>`,
      '<div class="panel">',
      '<div class="section-title">Resumen ejecutivo</div>',
      '<div class="kpi-grid">',
      '<div class="kpi"><div class="kpi-label">Periodos</div>',
      `<div class="kpi-value">${options.periodCodes.length}</div></div>`,
      '<div class="kpi"><div class="kpi-label">Momentos</div>',
      `<div class="kpi-value">${options.moments.length}</div></div>`,
      '<div class="kpi"><div class="kpi-label">Aulas consolidadas</div>',
      `<div class="kpi-value">${options.totalCourses}</div></div>`,
      '<div class="kpi"><div class="kpi-label">Destinatarios</div>',
      `<div class="kpi-value">${options.recipientsCount}</div></div>`,
      '<div class="kpi"><div class="kpi-label">Promedio global</div>',
      `<div class="kpi-value">${averageLabel}</div><div class="kpi-meta">(0-${scoreScale})</div></div>`,
      '<div class="kpi kpi-success"><div class="kpi-label">Excelente</div>',
      `<div class="kpi-value">${options.excellent}</div><div class="kpi-meta">${scoreSeg.EXCELENTE}%</div></div>`,
      '<div class="kpi kpi-info"><div class="kpi-label">Bueno</div>',
      `<div class="kpi-value">${options.good}</div><div class="kpi-meta">${scoreSeg.BUENO}%</div></div>`,
      '<div class="kpi kpi-warning"><div class="kpi-label">Aceptable</div>',
      `<div class="kpi-value">${options.acceptable}</div><div class="kpi-meta">${scoreSeg.ACEPTABLE}%</div></div>`,
      '<div class="kpi kpi-danger"><div class="kpi-label">Insatisfactorio</div>',
      `<div class="kpi-value">${options.unsatisfactory}</div><div class="kpi-meta">${scoreSeg.INSATISFACTORIO}%</div></div>`,
      '</div>',
      '<div class="score-bar-wrap"><p class="score-bar-title">Distribucion global del desempeno</p><div class="score-bar">',
      `<div class="score-seg seg-exc" style="width:${scoreSeg.EXCELENTE}%;">${scoreSeg.EXCELENTE > 0 ? `Excelente ${scoreSeg.EXCELENTE}%` : ''}</div>`,
      `<div class="score-seg seg-good" style="width:${scoreSeg.BUENO}%;">${scoreSeg.BUENO > 0 ? `Bueno ${scoreSeg.BUENO}%` : ''}</div>`,
      `<div class="score-seg seg-ok" style="width:${scoreSeg.ACEPTABLE}%;">${scoreSeg.ACEPTABLE > 0 ? `Aceptable ${scoreSeg.ACEPTABLE}%` : ''}</div>`,
      `<div class="score-seg seg-bad" style="width:${scoreSeg.INSATISFACTORIO}%;">${scoreSeg.INSATISFACTORIO > 0 ? `Insatisf. ${scoreSeg.INSATISFACTORIO}%` : ''}</div>`,
      '</div><div class="score-legend">',
      `<span class="legend-item"><span class="legend-dot dot-exc"></span>Excelente: ${options.excellent}</span>`,
      `<span class="legend-item"><span class="legend-dot dot-good"></span>Bueno: ${options.good}</span>`,
      `<span class="legend-item"><span class="legend-dot dot-ok"></span>Aceptable: ${options.acceptable}</span>`,
      `<span class="legend-item"><span class="legend-dot dot-bad"></span>Insatisfactorio: ${options.unsatisfactory}</span>`,
      '</div></div></div>',
      '<div class="panel">',
      '<div class="section-title">Corte por momento</div>',
      '<div class="table-container"><table class="report-table">',
      '<thead><tr><th>Momento</th><th>Aulas</th><th>Promedio</th><th>Excelente</th><th>Bueno</th><th>Aceptable</th><th>Insatisf.</th></tr></thead>',
      `<tbody>${momentRowsHtml}</tbody>`,
      '</table></div></div>',
      '<div class="panel">',
      '<div class="section-title">Corte por periodo</div>',
      '<div class="table-container"><table class="report-table">',
      '<thead><tr><th>Periodo</th><th>Momentos</th><th>Aulas</th><th>Promedio</th><th>Excelente</th><th>Bueno</th><th>Aceptable</th><th>Insatisf.</th></tr></thead>',
      `<tbody>${periodRowsHtml}</tbody>`,
      '</table></div></div>',
      '<div class="panel">',
      '<div class="section-title">Resumen consolidado por coordinacion</div>',
      '<div class="table-container"><table class="report-table">',
      '<thead><tr><th>Coordinacion</th><th>Aulas</th><th>Promedio</th><th>Excelente</th><th>Bueno</th><th>Aceptable</th><th>Insatisf.</th></tr></thead>',
      `<tbody>${rowsHtml}</tbody>`,
      '</table></div></div>',
      '<div class="panel panel-warm">',
      '<div class="section-title" style="color:#7a5b00;">Claves de lectura del consolidado</div>',
      `<ul class="obs-list">${summaryNotes}</ul>`,
      '</div>',
      '<div class="action-panel">',
      '<p class="action-title">Acompanamiento ejecutivo</p>',
      '<p class="action-text">Si requiere una lectura dirigida del consolidado o priorizar programas criticos, puede agendar un espacio con Campus Virtual.</p>',
      '<div class="cta-wrap" style="margin-top:0;">',
      `<a class="cta-btn" href="${TEACHER_BOOKING_URL}" target="_blank" rel="noopener">Agendar llamada / videollamada</a>`,
      '</div></div>',
      '<div style="margin-top:16px;text-align:center;color:#334155;font-size:13px;">Campus Virtual - Rectoria Centro Sur</div>',
      `<div class="report-footer">Generado el ${new Date().toISOString().slice(0, 10)} - Reporte ejecutivo consolidado 2026.</div>`,
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

  private async buildCoordinatorMessageContent(message: {
    coordinatorId: string | null;
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
    programCode?: string | null;
  }): Promise<{
    subject: string;
    htmlBody: string;
    recipientName: string;
    recipientEmail: string | null;
    programCode: string | null;
  } | null> {
    if (!message.coordinatorId) return null;
    if (!message.phase || !['ALISTAMIENTO', 'EJECUCION'].includes(message.phase)) {
      return null;
    }

    const coordinator = await this.prisma.coordinator.findUnique({
      where: { id: message.coordinatorId },
    });
    if (!coordinator) return null;

    const selectedMoments = normalizeMomentList(undefined, message.moment.split('+') as GeneratePayload['moments']);
    const effectiveMoments = selectedMoments.length
      ? selectedMoments
      : ([message.moment || 'MD1'] as Array<(typeof SUPPORTED_MOMENTS)[number]>);
    const coordinatorMeta = this.extractCoordinatorMetadata({
      periodCode: message.periodCode,
      programCode: message.programCode,
    });
    const selectedPeriodCodes = coordinatorMeta.periodCodes;
    const coursesByCoordination = await this.collectGlobalRows({
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      phase: message.phase as GeneratePayload['phase'],
    });
    const matches = coursesByCoordination
      .filter((course) =>
        this.matchCoordinatorCourse(coordinator.programKey, course.coordinationKey),
      )
      .sort((left, right) => {
        const periodCompare = left.periodCode.localeCompare(right.periodCode);
        if (periodCompare !== 0) return periodCompare;
        const teacherCompare = left.teacherName.localeCompare(right.teacherName);
        if (teacherCompare !== 0) return teacherCompare;
        const momentCompare = left.moment.localeCompare(right.moment);
        if (momentCompare !== 0) return momentCompare;
        return left.nrc.localeCompare(right.nrc);
      });
    if (!matches.length) return null;

    const rows = matches.map((course) => ({
      periodCode: course.periodCode,
      teacherName: course.teacherName,
      nrc: course.nrc,
      subject: course.subject,
      moment: course.moment,
      status: course.status,
      template: course.template,
      score: course.score,
    }));
    const subject = `[Seguimiento Aulas] ${message.phase} ${effectiveMoments
      .map((moment) => formatMomentLabel(moment))
      .join(' + ')} - CONSOLIDADO ${selectedPeriodCodes[0].slice(0, 4)} - ${coordinator.programId}`;
    const htmlBody = this.buildCoordinatorHtml({
      coordinatorName: coordinator.fullName,
      programId: coordinator.programId,
      phase: message.phase,
      moments: effectiveMoments,
      periodCodes: selectedPeriodCodes,
      uniqueTeachers: new Set(rows.map((row) => row.teacherName)).size,
      rows,
    });

    return {
      subject,
      htmlBody,
      recipientName: coordinator.fullName,
      recipientEmail: coordinator.email,
      programCode: this.encodeCoordinatorProgramMetadata(coordinator.programId, selectedPeriodCodes),
    };
  }

  private async buildGlobalMessageContent(message: {
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
    recipientName?: string | null;
    recipientEmail?: string | null;
    programCode?: string | null;
    htmlBody?: string | null;
  }): Promise<{
    subject: string;
    htmlBody: string;
    recipientName: string;
    recipientEmail: string | null;
    programCode: string | null;
  } | null> {
    if (!message.phase || !['ALISTAMIENTO', 'EJECUCION'].includes(message.phase)) {
      return null;
    }

    const selectedMoments = normalizeMomentList(undefined, message.moment.split('+') as GeneratePayload['moments']);
    const selectedPeriodCodes = this.extractGlobalSelectedPeriods({
      periodCode: message.periodCode,
      programCode: message.programCode,
      htmlBody: message.htmlBody,
    });
    const effectiveMoments = selectedMoments.length
      ? selectedMoments
      : ([message.moment || 'MD1'] as Array<(typeof SUPPORTED_MOMENTS)[number]>);
    const rows = await this.collectGlobalRows({
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      phase: message.phase as GeneratePayload['phase'],
    });
    if (!rows.length) return null;

    const summary = this.summarizeGlobalRows(
      rows,
      message.phase as GeneratePayload['phase'],
      selectedPeriodCodes,
      effectiveMoments,
    );
    const recipientEmail = message.recipientEmail?.trim() || null;
    const recipientName =
      message.recipientName?.trim() ||
      process.env.OUTBOX_GLOBAL_RECIPIENT_NAME?.trim() ||
      'Equipo de Coordinacion Academica';
    const recipientsCount = parseStoredRecipientEmails(recipientEmail).length || (recipientEmail ? 1 : 0);
    const subject = `[Seguimiento Aulas] GLOBAL ${message.phase} ${effectiveMoments
      .map((moment) => formatMomentLabel(moment))
      .join(' + ')} - CONSOLIDADO ${selectedPeriodCodes[0].slice(0, 4)}`;
    const htmlBody = this.buildGlobalHtml({
      phase: message.phase,
      moments: effectiveMoments,
      periodCodes: selectedPeriodCodes,
      totalCourses: summary.totalCourses,
      averageScore: summary.averageScore,
      excellent: summary.excellent,
      good: summary.good,
      acceptable: summary.acceptable,
      unsatisfactory: summary.unsatisfactory,
      rows: summary.rowsSummary,
      periodSummary: summary.periodSummary,
      momentSummary: summary.momentSummary,
      recipientsCount,
    });

    return {
      subject,
      htmlBody,
      recipientName,
      recipientEmail,
      programCode: selectedPeriodCodes.join('|'),
    };
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
        period: true,
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
          periodCode: course.period.code,
          periodLabel: course.period.label ?? null,
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

  private summarizeGlobalRows(
    rows: CourseCoordinationRow[],
    phase: GeneratePayload['phase'],
    selectedPeriodCodes: string[],
    selectedMoments: string[],
  ): {
    rowsSummary: GlobalSummaryRow[];
    periodSummary: GlobalPeriodSummaryRow[];
    momentSummary: GlobalMomentSummaryRow[];
    totalCourses: number;
    averageScore: number | null;
    excellent: number;
    good: number;
    acceptable: number;
    unsatisfactory: number;
  } {
    const phaseUpper = phase.toUpperCase();
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
    const summaryByPeriodMoment = new Map<
      string,
      {
        periodCode: string;
        moments: Set<string>;
        total: number;
        scoreSum: number;
        scoredCount: number;
        excellent: number;
        good: number;
        acceptable: number;
        unsatisfactory: number;
      }
    >();
    const summaryByMoment = new Map<
      string,
      {
        moment: string;
        total: number;
        scoreSum: number;
        scoredCount: number;
        excellent: number;
        good: number;
        acceptable: number;
        unsatisfactory: number;
      }
    >();

    let scoreSum = 0;
    let scoredCount = 0;
    let excellent = 0;
    let good = 0;
    let acceptable = 0;
    let unsatisfactory = 0;

    for (const row of rows) {
      const band = this.toScoreBandForPhase(row.score, phaseUpper);
      const coordination = summaryByCoordination.get(row.coordinationKey) ?? {
        coordination: row.coordinationName,
        total: 0,
        scoreSum: 0,
        scoredCount: 0,
        excellent: 0,
        good: 0,
        acceptable: 0,
        unsatisfactory: 0,
      };
      const periodKey = row.periodCode;
      const period = summaryByPeriodMoment.get(periodKey) ?? {
        periodCode: row.periodCode,
        moments: new Set<string>(),
        total: 0,
        scoreSum: 0,
        scoredCount: 0,
        excellent: 0,
        good: 0,
        acceptable: 0,
        unsatisfactory: 0,
      };
      const moment = summaryByMoment.get(row.moment) ?? {
        moment: row.moment,
        total: 0,
        scoreSum: 0,
        scoredCount: 0,
        excellent: 0,
        good: 0,
        acceptable: 0,
        unsatisfactory: 0,
      };

      coordination.total += 1;
      period.total += 1;
      period.moments.add(row.moment);
      moment.total += 1;

      if (row.score != null) {
        coordination.scoreSum += row.score;
        coordination.scoredCount += 1;
        period.scoreSum += row.score;
        period.scoredCount += 1;
        moment.scoreSum += row.score;
        moment.scoredCount += 1;
        scoreSum += row.score;
        scoredCount += 1;
      }

      if (band === 'EXCELENTE') {
        coordination.excellent += 1;
        period.excellent += 1;
        moment.excellent += 1;
        excellent += 1;
      }
      if (band === 'BUENO') {
        coordination.good += 1;
        period.good += 1;
        moment.good += 1;
        good += 1;
      }
      if (band === 'ACEPTABLE') {
        coordination.acceptable += 1;
        period.acceptable += 1;
        moment.acceptable += 1;
        acceptable += 1;
      }
      if (band === 'INSATISFACTORIO') {
        coordination.unsatisfactory += 1;
        period.unsatisfactory += 1;
        moment.unsatisfactory += 1;
        unsatisfactory += 1;
      }

      summaryByCoordination.set(row.coordinationKey, coordination);
      summaryByPeriodMoment.set(periodKey, period);
      summaryByMoment.set(row.moment, moment);
    }

    for (const periodCode of selectedPeriodCodes) {
      if (summaryByPeriodMoment.has(periodCode)) continue;
      summaryByPeriodMoment.set(periodCode, {
        periodCode,
        moments: new Set(selectedMoments),
        total: 0,
        scoreSum: 0,
        scoredCount: 0,
        excellent: 0,
        good: 0,
        acceptable: 0,
        unsatisfactory: 0,
      });
    }

    for (const moment of selectedMoments) {
      if (summaryByMoment.has(moment)) continue;
      summaryByMoment.set(moment, {
        moment,
        total: 0,
        scoreSum: 0,
        scoredCount: 0,
        excellent: 0,
        good: 0,
        acceptable: 0,
        unsatisfactory: 0,
      });
    }

    return {
      rowsSummary: [...summaryByCoordination.values()]
        .map((item) => ({
          coordination: item.coordination,
          total: item.total,
          average: item.scoredCount > 0 ? item.scoreSum / item.scoredCount : null,
          excellent: item.excellent,
          good: item.good,
          acceptable: item.acceptable,
          unsatisfactory: item.unsatisfactory,
        }))
        .sort((a, b) => a.coordination.localeCompare(b.coordination, 'es')),
      periodSummary: [...summaryByPeriodMoment.values()]
        .map((item) => ({
          periodCode: item.periodCode,
          moments: [...item.moments].sort((a, b) => a.localeCompare(b, 'es')),
          total: item.total,
          average: item.scoredCount > 0 ? item.scoreSum / item.scoredCount : null,
          excellent: item.excellent,
          good: item.good,
          acceptable: item.acceptable,
          unsatisfactory: item.unsatisfactory,
        }))
        .sort((a, b) => a.periodCode.localeCompare(b.periodCode, 'es')),
      momentSummary: [...summaryByMoment.values()]
        .map((item) => ({
          moment: item.moment,
          total: item.total,
          average: item.scoredCount > 0 ? item.scoreSum / item.scoredCount : null,
          excellent: item.excellent,
          good: item.good,
          acceptable: item.acceptable,
          unsatisfactory: item.unsatisfactory,
        }))
        .sort(
          (a, b) =>
            selectedMoments.indexOf(a.moment) - selectedMoments.indexOf(b.moment) ||
            a.moment.localeCompare(b.moment, 'es'),
        ),
      totalCourses: rows.length,
      averageScore: scoredCount > 0 ? scoreSum / scoredCount : null,
      excellent,
      good,
      acceptable,
      unsatisfactory,
    };
  }

  private async collectGlobalRows(criteria: {
    periodCodes: string[];
    moments: Array<(typeof SUPPORTED_MOMENTS)[number]>;
    phase: GeneratePayload['phase'];
  }): Promise<CourseCoordinationRow[]> {
    const periods = await this.prisma.period.findMany({
      where: {
        code: {
          in: criteria.periodCodes,
        },
      },
      select: {
        id: true,
        code: true,
      },
      orderBy: {
        code: 'asc',
      },
    });
    if (!periods.length) return [];

    const rowsByCriteria = await Promise.all(
      periods.flatMap((period) =>
        criteria.moments.map((moment) =>
          this.buildCourseCoordinationRows(period.id, moment, criteria.phase),
        ),
      ),
    );

    return rowsByCriteria.flat();
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

    const selectedPeriodCodes = this.normalizeGlobalSelectedPeriods(payload.periodCodes, period.code);
    const selectedMoments = normalizeMomentList(payload.moment, payload.moments);
    const effectiveMoments = selectedMoments.length
      ? selectedMoments
      : ([payload.moment ?? 'MD1'] as Array<(typeof SUPPORTED_MOMENTS)[number]>);
    const coursesByCoordination = await this.collectGlobalRows({
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      phase: payload.phase,
    });
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
    const momentLabel = effectiveMoments.join('+');

    for (const coordinator of coordinators) {
      const matches = coursesByCoordination.filter((course) => {
        const courseCoordinationKey = course.coordinationKey;
        if (!courseCoordinationKey) return false;
        return this.matchCoordinatorCourse(coordinator.programKey, courseCoordinationKey);
      }).sort((left, right) => {
        const periodCompare = left.periodCode.localeCompare(right.periodCode);
        if (periodCompare !== 0) return periodCompare;
        const teacherCompare = left.teacherName.localeCompare(right.teacherName);
        if (teacherCompare !== 0) return teacherCompare;
        const momentCompare = left.moment.localeCompare(right.moment);
        if (momentCompare !== 0) return momentCompare;
        return left.nrc.localeCompare(right.nrc);
      });

      if (!matches.length) {
        unmatchedCoordinators.push(coordinator.programId);
        continue;
      }

      const rows = matches.map((course) => ({
        periodCode: course.periodCode,
        teacherName: course.teacherName,
        nrc: course.nrc,
        subject: course.subject,
        moment: course.moment,
        status: course.status,
        template: course.template,
        score: course.score,
      }));

      const uniqueTeachers = new Set(rows.map((item) => item.teacherName)).size;
      const subject = `[Seguimiento Aulas] ${payload.phase} ${effectiveMoments
        .map((moment) => formatMomentLabel(moment))
        .join(' + ')} - CONSOLIDADO ${selectedPeriodCodes[0].slice(0, 4)} - ${coordinator.programId}`;
      const htmlBody = this.buildCoordinatorHtml({
        coordinatorName: coordinator.fullName,
        programId: coordinator.programId,
        phase: payload.phase,
        moments: effectiveMoments,
        periodCodes: selectedPeriodCodes,
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
          programCode: this.encodeCoordinatorProgramMetadata(coordinator.programId, selectedPeriodCodes),
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
      period: selectedPeriodCodes.join(', '),
      phase: payload.phase,
      moment: momentLabel,
      moments: effectiveMoments,
      periodCodes: selectedPeriodCodes,
      unmatchedCoordinators,
    };
  }

  private async generateGlobalOutbox(
    period: Period,
    payload: GeneratePayload,
  ) {
    const selectedPeriodCodes = this.normalizeGlobalSelectedPeriods(payload.periodCodes, period.code);
    const selectedMoments = normalizeMomentList(payload.moment, payload.moments);
    const effectiveMoments = selectedMoments.length ? selectedMoments : ([payload.moment ?? 'MD1'] as Array<(typeof SUPPORTED_MOMENTS)[number]>);
    const rows = await this.collectGlobalRows({
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      phase: payload.phase,
    });
    if (!rows.length) {
      return {
        ok: true,
        audience: 'GLOBAL',
        created: 0,
        reason: 'No hay cursos para ese criterio.',
      };
    }
    const summary = this.summarizeGlobalRows(rows, payload.phase, selectedPeriodCodes, effectiveMoments);
    const momentLabel = effectiveMoments.join('+');
    const subject = `[Seguimiento Aulas] GLOBAL ${payload.phase} ${effectiveMoments
      .map((moment) => formatMomentLabel(moment))
      .join(' + ')} - CONSOLIDADO ${selectedPeriodCodes[0].slice(0, 4)}`;
    const payloadRecipientEmails = normalizeRecipientEmails(payload.recipientEmails);
    const payloadRecipientEmail = payloadRecipientEmails.length ? payloadRecipientEmails.join('; ') : null;
    const recipientNameRaw = payload.recipientName?.trim() || process.env.OUTBOX_GLOBAL_RECIPIENT_NAME?.trim();
    const recipientEmailRaw = payloadRecipientEmail || process.env.OUTBOX_GLOBAL_RECIPIENT_EMAIL?.trim();
    const defaultTo = process.env.OUTBOX_DEFAULT_TO?.trim();
    const defaultCc = process.env.OUTBOX_DEFAULT_CC?.trim();
    const recipientName = recipientNameRaw || 'Equipo de Coordinacion Academica';
    const recipientEmail = recipientEmailRaw || defaultTo || defaultCc || null;
    const recipientsCount = parseStoredRecipientEmails(recipientEmail).length || (recipientEmail ? 1 : 0);
    const htmlBody = this.buildGlobalHtml({
      phase: payload.phase,
      moments: effectiveMoments,
      periodCodes: selectedPeriodCodes,
      totalCourses: summary.totalCourses,
      averageScore: summary.averageScore,
      excellent: summary.excellent,
      good: summary.good,
      acceptable: summary.acceptable,
      unsatisfactory: summary.unsatisfactory,
      rows: summary.rowsSummary,
      periodSummary: summary.periodSummary,
      momentSummary: summary.momentSummary,
      recipientsCount,
    });

    await this.prisma.outboxMessage.deleteMany({
      where: {
        audience: 'GLOBAL',
        periodId: period.id,
        phase: payload.phase,
        moment: momentLabel,
      },
    });

    const createdMessage = await this.prisma.outboxMessage.create({
      data: {
        audience: 'GLOBAL',
        teacherId: null,
        coordinatorId: null,
        programCode: selectedPeriodCodes.join('|'),
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
      period: selectedPeriodCodes.join(', '),
      phase: payload.phase,
      moment: momentLabel,
      periodCodes: selectedPeriodCodes,
      moments: effectiveMoments,
      coordinations: summary.rowsSummary.length,
      totalCourses: summary.totalCourses,
      createdMessageIds: [createdMessage.id],
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

    const selectedMoments = normalizeMomentList(payload.moment, payload.moments);
    if (payload.audience === 'DOCENTE' && selectedMoments.length > 1) {
      const batches = [];
      let created = 0;
      let totalCourses = 0;
      let coordinations = 0;

      for (const selectedMoment of selectedMoments) {
        const batchPayload: GeneratePayload = {
          ...payload,
          moment: selectedMoment,
          moments: undefined,
        };
        const result =
          payload.audience === 'COORDINADOR'
            ? await this.generateCoordinatorOutbox(period, batchPayload)
            : payload.audience === 'GLOBAL'
              ? await this.generateGlobalOutbox(period, batchPayload)
              : await this.generateTeacherOutbox(period, batchPayload);
        batches.push(result);
        created += Number(result?.created ?? 0);
        totalCourses += Number(result?.totalCourses ?? 0);
        coordinations += Number(result?.coordinations ?? 0);
      }

      return {
        ok: true,
        audience: payload.audience,
        period: period.code,
        phase: payload.phase,
        moments: selectedMoments,
        created,
        totalCourses: totalCourses || undefined,
        coordinations: coordinations || undefined,
        batches,
      };
    }

    if (selectedMoments.length === 1) {
      payload.moment = selectedMoments[0];
    }
    if (selectedMoments.length > 1) {
      payload.moments = selectedMoments;
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
    scopeKey?: string | null;
  }): string {
    return [
      this.normalizeFingerprintToken(input.to),
      this.normalizeFingerprintToken(input.audience),
      this.normalizeFingerprintToken(input.periodCode),
      this.normalizeFingerprintToken(input.phase),
      this.normalizeFingerprintToken(input.moment),
      this.normalizeFingerprintToken(input.recipientName),
      this.normalizeFingerprintToken(input.scopeKey),
    ].join('|');
  }

  private async buildRecentSendFingerprintMap(since: Date): Promise<Map<string, Date>> {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: 'OUTBOX_SEND_SENT',
        entityType: 'OUTBOX_MESSAGE',
        createdAt: { gte: since },
      },
      select: {
        entityId: true,
        details: true,
        createdAt: true,
      },
      take: 5000,
      orderBy: [{ createdAt: 'desc' }],
    });

    const fingerprints = new Map<string, Date>();
    const missing: Array<{ id: string; to: string; createdAt: Date }> = [];

    for (const log of logs) {
      const detail =
        log.details && typeof log.details === 'object' && !Array.isArray(log.details)
          ? (log.details as SendAuditLogDetail)
          : null;
      const rawFingerprint = detail?.fingerprint?.trim();
      if (rawFingerprint) {
        const normalized = this.normalizeFingerprintToken(rawFingerprint);
        const current = fingerprints.get(normalized);
        if (!current || log.createdAt > current) {
          fingerprints.set(normalized, log.createdAt);
        }
        continue;
      }

      const to = detail?.to?.trim();
      if (!to) continue;
      missing.push({ id: log.entityId, to, createdAt: log.createdAt });
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
        scopeKey:
          message.audience === 'COORDINADOR'
            ? (message.programCode ?? message.coordinatorId ?? '')
            : message.audience === 'GLOBAL'
              ? (message.programCode ?? '')
              : (message.teacherId ?? ''),
      });
      const normalized = this.normalizeFingerprintToken(fingerprint);
      const current = fingerprints.get(normalized);
      if (!current || row.createdAt > current) {
        fingerprints.set(normalized, row.createdAt);
      }
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

  private async buildTeacherMessageContent(message: {
    teacherId: string | null;
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
  }): Promise<{
    subject: string;
    htmlBody: string;
    recipientName: string;
    recipientEmail: string | null;
    programCode: string | null;
  } | null> {
    if (!message.teacherId) return null;
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

    return {
      subject,
      htmlBody,
      recipientName: rowsPayload.teacher.fullName,
      recipientEmail: rowsPayload.teacher.email,
      programCode: rowsPayload.programCode,
    };
  }

  private async refreshGeneratedMessageForSend(message: {
    id: string;
    audience: string;
    teacherId: string | null;
    coordinatorId: string | null;
    programCode: string | null;
    periodId: string;
    periodCode: string;
    phase: string;
    moment: string;
    recipientName?: string | null;
    recipientEmail?: string | null;
    htmlBody?: string | null;
  }): Promise<{
    subject: string;
    htmlBody: string;
    recipientName: string;
    recipientEmail: string | null;
    programCode?: string | null;
  } | null> {
    const refreshed =
      message.audience === 'DOCENTE'
        ? await this.buildTeacherMessageContent({
            teacherId: message.teacherId,
            periodId: message.periodId,
            periodCode: message.periodCode,
            phase: message.phase,
            moment: message.moment,
          })
        : message.audience === 'COORDINADOR'
          ? await this.buildCoordinatorMessageContent({
              coordinatorId: message.coordinatorId,
              periodId: message.periodId,
              periodCode: message.periodCode,
              phase: message.phase,
              moment: message.moment,
              programCode: message.programCode,
            })
          : message.audience === 'GLOBAL'
            ? await this.buildGlobalMessageContent({
                periodId: message.periodId,
                periodCode: message.periodCode,
                phase: message.phase,
                moment: message.moment,
                recipientName: message.recipientName,
                recipientEmail: message.recipientEmail,
                programCode: message.programCode,
                htmlBody: message.htmlBody,
              })
            : null;
    if (!refreshed) return null;

    await this.prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        subject: refreshed.subject,
        recipientName: refreshed.recipientName,
        recipientEmail: refreshed.recipientEmail,
        programCode: refreshed.programCode ?? message.programCode,
        htmlBody: refreshed.htmlBody,
        status: 'DRAFT',
      },
    });

    return {
      subject: refreshed.subject,
      htmlBody: refreshed.htmlBody,
      recipientName: refreshed.recipientName,
      recipientEmail: refreshed.recipientEmail,
      programCode: refreshed.programCode ?? message.programCode,
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
    const selectedMoments = normalizeMomentList(payload.moment, payload.moments);
    const selectedPeriodCodes = normalizePeriodCodeList(payload.periodCode, payload.periodCodes);

    const where = payload.ids?.length
      ? {
          id: {
            in: payload.ids,
          },
        }
      : {
          status: payload.status ?? 'DRAFT',
          period: selectedPeriodCodes.length
            ? {
                code: selectedPeriodCodes.length > 1 ? { in: selectedPeriodCodes } : selectedPeriodCodes[0],
              }
            : undefined,
          phase: payload.phase,
          moment:
            selectedMoments.length > 1
              ? {
                  in: selectedMoments,
                }
              : (selectedMoments[0] ?? payload.moment),
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
        const refreshed = await this.refreshGeneratedMessageForSend({
          id: message.id,
          audience: message.audience,
          teacherId: message.teacherId,
          coordinatorId: message.coordinatorId,
          programCode: message.programCode,
          periodId: message.periodId,
          periodCode: message.period.code,
          phase: message.phase,
          moment: message.moment,
          recipientName: message.recipientName,
          recipientEmail: message.recipientEmail,
          htmlBody: message.htmlBody,
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
        scopeKey:
          message.audience === 'COORDINADOR'
            ? (message.programCode ?? message.coordinatorId ?? '')
            : message.audience === 'GLOBAL'
              ? (message.programCode ?? '')
              : (message.teacherId ?? ''),
      });

      return {
        id: message.id,
        originalTo,
        to,
        cc: defaultCc,
        recipientName,
        fingerprint,
        messageCreatedAt: message.createdAt,
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
      const recentFingerprints = await this.buildRecentSendFingerprintMap(since);
      const orderedCandidates = [...validCandidates].sort((left, right) => {
        const createdDiff = right.messageCreatedAt.getTime() - left.messageCreatedAt.getTime();
        if (createdDiff !== 0) return createdDiff;
        return left.id.localeCompare(right.id, 'es');
      });
      const filtered: SendCandidate[] = [];
      for (const item of orderedCandidates) {
        const normalizedFingerprint = this.normalizeFingerprintToken(item.fingerprint);
        const lastSentAt = recentFingerprints.get(normalizedFingerprint);
        if (lastSentAt && item.messageCreatedAt.getTime() <= lastSentAt.getTime()) {
          skipped.push({
            id: item.id,
            to: item.to,
            error: `Bloqueado por duplicado reciente (${dedupeWindowMinutes} min).`,
          });
          continue;
        }
        recentFingerprints.set(normalizedFingerprint, item.messageCreatedAt);
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
            to: item.to.replace(/;\s*/g, ', '),
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

  async previewByCourse(rawPayload: unknown) {
    const payload = parseWithSchema(
      OutboxPreviewByCourseSchema,
      rawPayload,
      'outbox preview-by-course request',
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
        `El curso ${course.nrc} no tiene docente vinculado. No se puede generar preview.`,
      );
    }

    const moment = (course.moment ?? '').trim().toUpperCase();
    if (!moment || !SUPPORTED_MOMENTS.includes(moment as (typeof SUPPORTED_MOMENTS)[number])) {
      throw new BadRequestException(`Momento invalido en curso ${course.nrc}: ${course.moment}.`);
    }
    const phase: 'ALISTAMIENTO' | 'EJECUCION' = payload.phase ?? 'ALISTAMIENTO';

    const preview = await this.buildTeacherMessageContent({
      teacherId: course.teacherId,
      periodId: course.periodId,
      periodCode: course.period.code,
      phase,
      moment,
    });
    if (!preview) {
      throw new NotFoundException(
        `No se pudo generar preview para docente ${course.teacher.fullName} en ${course.period.code} ${moment}.`,
      );
    }

    return {
      id: `preview-course-${course.id}-${phase}-${moment}`,
      subject: preview.subject,
      htmlBody: preview.htmlBody,
      recipientName: preview.recipientName,
      recipientEmail: preview.recipientEmail,
      status: 'PREVIEW',
      phase,
      moment,
      audience: 'DOCENTE',
      periodCode: course.period.code,
      periodLabel: course.period.label,
      updatedAt: new Date().toISOString(),
      courseId: course.id,
      nrc: course.nrc,
      teacherId: course.teacherId,
      teacherName: course.teacher.fullName,
    };
  }

  async preview(id: string) {
    const message = await this.prisma.outboxMessage.findUnique({
      where: { id },
      include: {
        teacher: true,
        coordinator: true,
        period: true,
      },
    });

    if (!message) {
      throw new NotFoundException(`No existe el mensaje outbox ${id}.`);
    }

    let subject = message.subject;
    let htmlBody = message.htmlBody;
    let recipientName =
      message.recipientName ??
      message.teacher?.fullName ??
      message.coordinator?.fullName ??
      null;
    let recipientEmail =
      message.recipientEmail ??
      message.teacher?.email ??
      message.coordinator?.email ??
      null;

    const refreshed =
      message.audience === 'DOCENTE'
        ? await this.buildTeacherMessageContent({
            teacherId: message.teacherId,
            periodId: message.periodId,
            periodCode: message.period.code,
            phase: message.phase,
            moment: message.moment,
          })
        : message.audience === 'COORDINADOR'
          ? await this.buildCoordinatorMessageContent({
              coordinatorId: message.coordinatorId,
              periodId: message.periodId,
              periodCode: message.period.code,
              phase: message.phase,
              moment: message.moment,
              programCode: message.programCode,
            })
          : message.audience === 'GLOBAL'
            ? await this.buildGlobalMessageContent({
                periodId: message.periodId,
                periodCode: message.period.code,
                phase: message.phase,
                moment: message.moment,
                recipientName: message.recipientName,
                recipientEmail: message.recipientEmail,
                programCode: message.programCode,
                htmlBody: message.htmlBody,
              })
            : null;

    if (refreshed) {
      subject = refreshed.subject;
      htmlBody = refreshed.htmlBody;
      recipientName = refreshed.recipientName;
      recipientEmail = refreshed.recipientEmail;
    }

    return {
      id: message.id,
      subject,
      htmlBody,
      recipientName,
      recipientEmail,
      status: message.status,
      phase: message.phase,
      moment: message.moment,
      audience: message.audience,
      periodCode: message.period.code,
      periodLabel: message.period.label,
      updatedAt: message.updatedAt,
    };
  }

  async options(yearPrefix = '2026') {
    const periods = await this.prisma.period.findMany({
      where: yearPrefix.trim()
        ? {
            code: {
              startsWith: yearPrefix.trim(),
            },
          }
        : undefined,
      orderBy: { code: 'asc' },
      select: {
        code: true,
        label: true,
        modality: true,
      },
    });

    return {
      periods,
      supportedMoments: SUPPORTED_MOMENTS.map((value) => ({
        value,
        label: formatMomentLabel(value),
      })),
      supportedPhases: ['ALISTAMIENTO', 'EJECUCION'],
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
            action: { in: ['OUTBOX_SEND_SENT', 'OUTBOX_SEND_FAILED', 'OUTBOX_SEND_SKIPPED_DUPLICATE'] },
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
              : last?.action === 'OUTBOX_SEND_SKIPPED_DUPLICATE'
                ? 'SKIPPED_DUPLICATE'
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
