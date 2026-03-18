import { promises as fs, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  normalizeProgramKey,
  normalizeTeacherId,
  OutboxExportSchema,
  OutboxGenerateSchema,
} from '@seguimiento/shared';
import type { Period } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';
import { isBannerExcludedFromReview } from '../common/banner-review.util';

type GeneratePayload = {
  periodCode: string;
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  moment?: 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2';
  audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
};

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
    rows: Array<{ nrc: string; program: string; template: string; score: number | null }>;
  }) {
    const templateStyle = this.loadTemplateStyle('ejemplo Docentes - Profesores.html');
    const rowsHtml = options.rows
      .map(
        (row) =>
          `<tr><td>${row.nrc}</td><td>${row.program}</td><td>${row.template}</td><td class="t-center">${row.score ?? 'N/A'}</td></tr>`,
      )
      .join('');

    return [
      '<html><head>',
      templateStyle,
      '</head><body class="mail-bg">',
      '<div class="shell"><div class="top-strip"></div>',
      `<div class="hero"><h2 class="hero-title">Seguimiento de aulas virtuales - ${options.phase}</h2><div class="hero-subtitle">Periodo ${options.periodCode} | Momento ${options.moment}</div></div>`,
      '<div class="body-wrap">',
      `<p class="intro-note"><strong>Docente:</strong> ${options.teacherName}</p>`,
      '<div class="panel">',
      '<div class="section-title">Resumen de aulas seleccionadas por muestreo</div>',
      '<div class="table-container">',
      '<table class="report-table">',
      '<thead><tr><th>NRC</th><th>Programa</th><th>Plantilla</th><th>Puntaje fase</th></tr></thead>',
      `<tbody>${rowsHtml}</tbody>`,
      '</table></div></div>',
      '<p class="note">Este correo fue generado por el sistema de seguimiento de aulas.</p>',
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
      .filter((course) => !isBannerExcludedFromReview(course.rawJson))
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
      return {
        ok: true,
        audience: 'DOCENTE',
        created: 0,
        reason: 'No hay grupos de muestreo para ese criterio.',
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
    for (const groups of buckets.values()) {
      const teacher = groups[0].teacher;
      const moment = groups[0].moment;
      const programCode = teacher.costCenter ?? groups[0].programCode;

      const rows = groups
        .filter((group) => Boolean(group.selectedCourse))
        .filter((group) => !isBannerExcludedFromReview(group.selectedCourse?.rawJson))
        .map((group) => {
          const selected = group.selectedCourse!;
          const evaluation = selected.evaluations.find((item) => item.phase === payload.phase);
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: selected.teacher?.costCenter ?? teacher.costCenter ?? null,
            courseProgramCode: selected.programCode,
            courseProgramName: selected.programName,
          });
          return {
            nrc: selected.nrc,
            program: resolvedProgram.programName ?? resolvedProgram.programCode ?? group.programCode,
            template: selected.moodleCheck?.detectedTemplate ?? selected.templateDeclared ?? group.template,
            score: evaluation?.score ?? null,
          };
        });

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

      await this.prisma.outboxMessage.create({
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
    }

    return {
      ok: true,
      audience: 'DOCENTE',
      created,
      period: period.code,
      phase: payload.phase,
      moment: payload.moment ?? 'ALL',
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
}
