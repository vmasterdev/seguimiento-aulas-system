import { CAMPUS_VIRTUAL_COMMUNICADO_URL, TEACHER_BOOKING_URL } from './outbox.constants';
import { BASE_REPORT_STYLE } from './outbox.templates';
import type {
  CourseCoordinationRow,
  GeneratePayload,
  GlobalMomentSummaryRow,
  GlobalPeriodSummaryRow,
  GlobalProgramCampusRow,
  GlobalSummaryRow,
  GlobalTeacherAggregates,
  GlobalUnsatisfactoryTeacherRow,
} from './outbox.types';
import { escapeHtml, formatMomentLabel } from './outbox.utils';

type ScoreBand = 'EXCELENTE' | 'BUENO' | 'ACEPTABLE' | 'INSATISFACTORIO';

type TeacherReportOptions = {
  teacherName: string;
  phase: string;
  moment: string;
  periodCode: string;
  rows: Array<{
    nrc: string;
    reviewedNrc: string;
    moodleCourseUrl?: string | null;
    moment: string;
    resultType: 'REVISADO' | 'REPLICADO';
    subject: string;
    program: string;
    template: string;
    score: number | null;
    observations: string;
  }>;
};

type CoordinatorReportOptions = {
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
};

type GlobalReportOptions = {
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
  teacherAggregates?: GlobalTeacherAggregates;
  significantEvents?: Array<{
    teacherName: string;
    coordination: string | null;
    campus: string | null;
    periodCode: string;
    moment: string;
    totalScore: number | null;
    resolvedScore: number | null;
    isNewTeacher: boolean;
    tenureDays: number | null;
    signed: boolean;
    delivered: boolean;
    archived: boolean;
    resolved: boolean;
  }>;
};

type WorkshopInvitationOptions = {
  teacherName: string;
  phase: string;
  periodCode: string;
  sessionTitle: string;
  sessionDateLabel: string;
  sessionTimeLabel: string;
  meetingUrl: string;
  introNote?: string | null;
  rows: Array<{
    nrc: string;
    subject: string;
    moment: string;
    score: number | null;
    band: ScoreBand;
  }>;
};

function getPhaseScoreScale(_phase: string): number {
  // Regla de negocio: cada fase aporta hasta 50 puntos.
  // El consolidado total de 100 surge de ALISTAMIENTO (50) + EJECUCION (50),
  // y AUTO_PASS en ejecucion ya persiste esos 50 puntos completos.
  return 50;
}

function getPhaseMeta(phase: string): { phaseUpper: string; phaseLabel: string; scoreScale: number } {
  const phaseUpper = phase.toUpperCase();
  return {
    phaseUpper,
    phaseLabel: phase === 'ALISTAMIENTO' ? 'Alistamiento' : 'Ejecucion',
    scoreScale: getPhaseScoreScale(phaseUpper),
  };
}

function toPercent(total: number, count: number): number {
  return total ? Number(((count / total) * 100).toFixed(1)) : 0;
}

function toSafeHref(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  return escapeHtml(raw);
}

function summarizePeriodYears(periodCodes: string[]): string {
  const years = [...new Set(periodCodes.map((code) => String(code ?? '').trim().slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))];
  if (!years.length) return 'multiperiodo';
  return years.length === 1 ? years[0] : years.join(', ');
}

export function buildWorkshopInvitationHtml(options: WorkshopInvitationOptions): string {
  const safeHref = toSafeHref(options.meetingUrl);
  const introNote = escapeHtml(
    options.introNote?.trim() ||
      'De acuerdo con los resultados obtenidos en la revision del Campus Virtual, identificamos oportunidades de fortalecimiento en el manejo de tu aula virtual para este periodo.',
  );
  const teacherName = escapeHtml(options.teacherName);
  const sessionTitle = escapeHtml(options.sessionTitle);
  const sessionDateLabel = escapeHtml(options.sessionDateLabel);
  const sessionTimeLabel = escapeHtml(options.sessionTimeLabel);
  const phaseLabel = escapeHtml(options.phase === 'ALISTAMIENTO' ? 'Alistamiento' : 'Ejecucion');
  const periodCode = escapeHtml(options.periodCode);

  const rowsHtml = options.rows
    .map((row) => {
      const bandClass =
        row.band === 'ACEPTABLE'
          ? 'seg-ok'
          : row.band === 'INSATISFACTORIO'
            ? 'seg-bad'
            : row.band === 'BUENO'
              ? 'seg-good'
              : 'seg-exc';

      return `
        <tr>
          <td>${escapeHtml(row.nrc)}</td>
          <td>${escapeHtml(row.subject)}</td>
          <td>${escapeHtml(formatMomentLabel(row.moment))} (${escapeHtml(row.moment)})</td>
          <td><span class="score-seg ${bandClass}" style="display:inline-block;padding:3px 8px;border-radius:999px;line-height:1.2;">${escapeHtml(row.band)}</span></td>
          <td>${escapeHtml(formatScoreForPhase(row.score, options.phase))}</td>
        </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      ${BASE_REPORT_STYLE}
    </head>
    <body>
      <div class="shell">
        <div class="top-strip" style="background:#ffc300;background-color:#ffc300;"></div>
        <div
          class="hero"
          style="background:#002b5c;background-color:#002b5c;background-image:linear-gradient(120deg, #002b5c 0%, #0057a4 100%);color:#ffffff;padding:20px 26px;border-bottom:1px solid #00244a;"
        >
          <h1 class="hero-title" style="margin:0;font-size:24px;line-height:1.25;font-weight:800;color:#ffffff;">
            Invitacion a sesion de <span class="hero-highlight" style="color:#ffd000;">inmersion digital</span>
          </h1>
          <div class="hero-subtitle" style="margin-top:6px;color:#dde9ff;font-size:12px;line-height:1.5;">
            Acompanamiento para fortalecer el uso de Campus Virtual a partir de la revision del periodo ${periodCode}.
          </div>
          <div
            class="hero-period-pill"
            style="display:inline-block;margin-top:10px;background:#ffd000;background-color:#ffd000;color:#002b5c;font-size:12px;font-weight:900;letter-spacing:0.3px;padding:5px 12px;border-radius:999px;border:1px solid #ffbe0b;text-transform:uppercase;"
          >
            ${phaseLabel} | ${periodCode}
          </div>
        </div>

        <div class="body-wrap">
          <p>Estimado(a) docente <strong>${teacherName}</strong>,</p>
          <p class="intro-note">${introNote}</p>

          <div class="panel panel-warm">
            <div class="section-title">Sesion programada</div>
            <p style="margin:0 0 8px 0;"><strong>${sessionTitle}</strong></p>
            <p style="margin:0;"><strong>Fecha:</strong> ${sessionDateLabel}</p>
            <p style="margin:0;"><strong>Horario:</strong> ${sessionTimeLabel}</p>
            <p style="margin:8px 0 0 0;">
              <strong>Microsoft Teams:</strong>
              ${
                safeHref
                  ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeHref}</a>`
                  : escapeHtml(options.meetingUrl)
              }
            </p>
          </div>

          <div class="quick-access">
            <div class="quick-access-title">Acceso rapido a la sesion</div>
            <div class="quick-access-text">Ingresa con este enlace el ${sessionDateLabel} antes de las ${sessionTimeLabel}.</div>
            <div class="quick-access-actions">
              ${
                safeHref
                  ? `<a class="cta-btn" href="${safeHref}" target="_blank" rel="noopener noreferrer">Ingresar a Teams</a>`
                  : ''
              }
            </div>
          </div>

          <div class="panel">
            <div class="section-title">Resultados considerados para esta invitacion</div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Asignatura</th>
                    <th>Momento</th>
                    <th>Resultado</th>
                    <th>Calificacion</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <div class="section-title">Que abordaremos en la sesion</div>
            <ul style="margin:8px 0 0 18px;padding:0;">
              <li>Buenas practicas de organizacion del aula en Campus Virtual.</li>
              <li>Recomendaciones para fortalecer los criterios revisados en Momento 1 y RCY.</li>
              <li>Espacio para resolver dudas puntuales del manejo del aula virtual.</li>
            </ul>
          </div>

          <p style="margin-top:16px;">
            Tu participacion es muy importante para continuar fortaleciendo la experiencia digital de tus aulas.
          </p>
          <p style="margin:0;">
            Muchas gracias.
          </p>
        </div>
      </div>
    </body>
  </html>`;
}

export function toScoreBand(score: number | null): ScoreBand {
  if (score == null) return 'INSATISFACTORIO';
  if (score >= 90) return 'EXCELENTE';
  if (score >= 80) return 'BUENO';
  if (score >= 70) return 'ACEPTABLE';
  return 'INSATISFACTORIO';
}

export function toScoreBandForPhase(score: number | null, phase: string): ScoreBand {
  if (score == null) return 'INSATISFACTORIO';
  const scale = getPhaseScoreScale(phase);
  const normalized = Math.max(0, Math.min(100, (score / scale) * 100));
  return toScoreBand(normalized);
}

export function formatScoreForPhase(score: number | null, phase: string): string {
  if (score == null) return 'N/A';
  const scale = getPhaseScoreScale(phase);
  return `${score.toFixed(1)}/${scale}`;
}

export function matchCoordinatorCourse(coordinatorProgramKey: string, courseCoordinationKey: string): boolean {
  if (!coordinatorProgramKey || !courseCoordinationKey) return false;
  return (
    courseCoordinationKey === coordinatorProgramKey ||
    courseCoordinationKey.includes(coordinatorProgramKey) ||
    coordinatorProgramKey.includes(courseCoordinationKey)
  );
}

export function summarizeGlobalRows(
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
  const { phaseUpper } = getPhaseMeta(phase);
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
    const band = toScoreBandForPhase(row.score, phaseUpper);
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

export function summarizeTeacherAggregates(
  rows: CourseCoordinationRow[],
  phase: GeneratePayload['phase'],
): GlobalTeacherAggregates {
  const { phaseUpper } = getPhaseMeta(phase);

  type TeacherStat = {
    teacherKey: string;
    teacherName: string;
    coordination: string;
    campus: string;
    totalCourses: number;
    unsatisfactoryCourses: number;
    replicatedCount: number;
    unsatisfactoryMoments: Set<string>;
  };

  const teacherStats = new Map<string, TeacherStat>();

  for (const row of rows) {
    const key = row.teacherKey || row.teacherName || 'SIN_DOCENTE';
    const stat = teacherStats.get(key) ?? {
      teacherKey: key,
      teacherName: row.teacherName,
      coordination: row.coordinationName,
      campus: row.campus?.trim() || 'SIN_CU',
      totalCourses: 0,
      unsatisfactoryCourses: 0,
      replicatedCount: 0,
      unsatisfactoryMoments: new Set<string>(),
    };

    stat.totalCourses += 1;
    const band = toScoreBandForPhase(row.score, phaseUpper);
    if (band === 'INSATISFACTORIO') {
      stat.unsatisfactoryCourses += 1;
      stat.unsatisfactoryMoments.add(row.moment);
      if (row.replicated) stat.replicatedCount += 1;
    }
    teacherStats.set(key, stat);
  }

  const unsatisfactoryTeacherRows: GlobalUnsatisfactoryTeacherRow[] = [];
  let uniqueUnsatisfactoryTeachers = 0;
  let uniqueRecurrentTeachers = 0;

  const programCampusMap = new Map<string, GlobalProgramCampusRow>();

  for (const stat of teacherStats.values()) {
    const isUnsat = stat.unsatisfactoryCourses > 0;
    const recurrent = stat.unsatisfactoryMoments.size > 1;
    if (isUnsat) {
      uniqueUnsatisfactoryTeachers += 1;
      if (recurrent) uniqueRecurrentTeachers += 1;
      unsatisfactoryTeacherRows.push({
        teacherKey: stat.teacherKey,
        teacherName: stat.teacherName,
        coordination: stat.coordination,
        campus: stat.campus,
        unsatisfactoryCourses: stat.unsatisfactoryCourses,
        totalCourses: stat.totalCourses,
        unsatisfactoryMomentsCount: stat.unsatisfactoryMoments.size,
        recurrent,
        replicatedCount: stat.replicatedCount,
      });
    }

    const pcKey = `${stat.coordination}::${stat.campus}`;
    const pc = programCampusMap.get(pcKey) ?? {
      coordination: stat.coordination,
      campus: stat.campus,
      uniqueTeachers: 0,
      unsatisfactoryTeachers: 0,
      unsatisfactoryCourses: 0,
      recurrentTeachers: 0,
    };
    pc.uniqueTeachers += 1;
    if (isUnsat) {
      pc.unsatisfactoryTeachers += 1;
      pc.unsatisfactoryCourses += stat.unsatisfactoryCourses;
      if (recurrent) pc.recurrentTeachers += 1;
    }
    programCampusMap.set(pcKey, pc);
  }

  const programCampusRows = [...programCampusMap.values()]
    .filter((row) => row.unsatisfactoryTeachers > 0)
    .sort(
      (a, b) =>
        b.unsatisfactoryTeachers - a.unsatisfactoryTeachers ||
        a.coordination.localeCompare(b.coordination, 'es') ||
        a.campus.localeCompare(b.campus, 'es'),
    );

  unsatisfactoryTeacherRows.sort(
    (a, b) =>
      Number(b.recurrent) - Number(a.recurrent) ||
      b.unsatisfactoryCourses - a.unsatisfactoryCourses ||
      a.coordination.localeCompare(b.coordination, 'es') ||
      a.teacherName.localeCompare(b.teacherName, 'es'),
  );

  return {
    uniqueTeachers: teacherStats.size,
    uniqueUnsatisfactoryTeachers,
    uniqueRecurrentTeachers,
    programCampusRows,
    unsatisfactoryTeacherRows,
  };
}

export function buildTeacherHtml(options: TeacherReportOptions): string {
  const { phaseUpper, phaseLabel, scoreScale } = getPhaseMeta(options.phase);
  const selectedCount = options.rows.filter((row) => row.resultType === 'REVISADO').length;
  const replicatedCount = options.rows.filter((row) => row.resultType === 'REPLICADO').length;
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
  for (const row of options.rows) {
    const band = toScoreBandForPhase(row.score, phaseUpper);
    bandCounter[band] += 1;
  }
  const scoreSeg = {
    EXCELENTE: toPercent(options.rows.length, bandCounter.EXCELENTE),
    BUENO: toPercent(options.rows.length, bandCounter.BUENO),
    ACEPTABLE: toPercent(options.rows.length, bandCounter.ACEPTABLE),
    INSATISFACTORIO: toPercent(options.rows.length, bandCounter.INSATISFACTORIO),
  };
  const rowsHtml = options.rows
    .map((row) => {
      const moodleHref = toSafeHref(row.moodleCourseUrl);
      const band = toScoreBandForPhase(row.score, phaseUpper);
      const bandLabel =
        band === 'EXCELENTE'
          ? 'Excelente'
          : band === 'BUENO'
            ? 'Bueno'
            : band === 'ACEPTABLE'
              ? 'Aceptable'
              : 'Insatisfactorio';
      const scoreLabel = formatScoreForPhase(row.score, phaseUpper);
      const resultBadgeClass = row.resultType === 'REVISADO' ? 'badge-primary' : 'badge-muted';
      const titleHtml = moodleHref
        ? `<a class="course-link" href="${moodleHref}" target="_blank" rel="noopener">NRC ${escapeHtml(row.nrc)}</a>`
        : `NRC ${escapeHtml(row.nrc)}`;
      return [
        '<div class="course-card">',
        '<div class="course-card-head">',
        `<div class="course-card-title">${titleHtml}</div>`,
        `<span class="result-badge ${resultBadgeClass}">${escapeHtml(row.resultType)}</span>`,
        '</div>',
        `<div class="course-card-score">${escapeHtml(scoreLabel)} | ${escapeHtml(bandLabel)}</div>`,
        '<table class="course-kv" role="presentation" cellspacing="0" cellpadding="0" border="0">',
        `<tr><td class="kv-key">Momento</td><td class="kv-val">${escapeHtml(formatMomentLabel(row.moment))} (${escapeHtml(row.moment)})</td></tr>`,
        `<tr><td class="kv-key">NRC revisado</td><td class="kv-val">${escapeHtml(row.reviewedNrc)}</td></tr>`,
        `<tr><td class="kv-key">Aula Moodle</td><td class="kv-val">${
          moodleHref
            ? `<a class="course-link-inline" href="${moodleHref}" target="_blank" rel="noopener">Abrir aula en Moodle</a>`
            : 'URL no disponible'
        }</td></tr>`,
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
    '.course-link{color:#0a3e74;text-decoration:none;border-bottom:1px solid #9db9dd;}',
    '.course-link:hover,.course-link-inline:hover{text-decoration:underline;}',
    '.course-link-inline{color:#0a4e8a;font-weight:700;text-decoration:none;}',
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
    '<!DOCTYPE html><html lang="es"><head>',
    '<meta charset="UTF-8">',
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    BASE_REPORT_STYLE,
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

export function buildCoordinatorHtml(options: CoordinatorReportOptions): string {
  const { phaseUpper, phaseLabel, scoreScale } = getPhaseMeta(options.phase);
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
    const band = toScoreBandForPhase(row.score, phaseUpper);
    bandCounter[band] += 1;
    const normalizedStatus = (row.status || 'SIN_CHECK').trim().toUpperCase() || 'SIN_CHECK';
    const normalizedTemplate = (row.template || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    moodleStatusCounter.set(normalizedStatus, (moodleStatusCounter.get(normalizedStatus) ?? 0) + 1);
    templateCounter.set(normalizedTemplate, (templateCounter.get(normalizedTemplate) ?? 0) + 1);
  }
  const scoreSeg = {
    EXCELENTE: toPercent(options.rows.length, bandCounter.EXCELENTE),
    BUENO: toPercent(options.rows.length, bandCounter.BUENO),
    ACEPTABLE: toPercent(options.rows.length, bandCounter.ACEPTABLE),
    INSATISFACTORIO: toPercent(options.rows.length, bandCounter.INSATISFACTORIO),
  };
  const selectedMomentsLabel = options.moments
    .map((moment) => `${formatMomentLabel(moment)} (${moment})`)
    .join(' | ');
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
      const band = toScoreBandForPhase(row.score, phaseUpper);
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
        `<td class="t-center">${escapeHtml(formatScoreForPhase(row.score, phaseUpper))}</td>`,
        `<td class="t-center"><span class="status-pill ${statusClass}">${escapeHtml(bandLabel)}</span></td>`,
        '</tr>',
      ].join('');
    })
    .join('');
  const activePeriodsLabel = options.periodCodes
    .filter((periodCode) => (summaryByPeriod.get(periodCode)?.total ?? 0) > 0)
    .join(', ');
  const selectedPeriodsLabel = activePeriodsLabel || options.periodCodes.join(', ');
  const periodRowsHtml = options.periodCodes
    .filter((periodCode) => (summaryByPeriod.get(periodCode)?.total ?? 0) > 0)
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
    '<!DOCTYPE html><html lang="es"><head>',
    '<meta charset="UTF-8">',
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    BASE_REPORT_STYLE,
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

export function buildGlobalHtml(options: GlobalReportOptions): string {
  const { phaseLabel, scoreScale } = getPhaseMeta(options.phase);
  const averageLabel = options.averageScore == null ? 'N/A' : options.averageScore.toFixed(1);
  const scoreSeg = {
    EXCELENTE: toPercent(options.totalCourses, options.excellent),
    BUENO: toPercent(options.totalCourses, options.good),
    ACEPTABLE: toPercent(options.totalCourses, options.acceptable),
    INSATISFACTORIO: toPercent(options.totalCourses, options.unsatisfactory),
  };
  const selectedMomentsLabel = options.moments
    .map((moment) => `${formatMomentLabel(moment)} (${moment})`)
    .join(' | ');
  const activePeriodsForLabel = options.periodSummary
    .filter((row) => row.total > 0)
    .map((row) => row.periodCode);
  const selectedPeriodsLabel = (activePeriodsForLabel.length ? activePeriodsForLabel : options.periodCodes).join(', ');
  const selectedYearsLabel = summarizePeriodYears(activePeriodsForLabel.length ? activePeriodsForLabel : options.periodCodes);
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
    .filter((row) => row.total > 0)
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
  const insatisfactorioThreshold = (scoreScale * 0.7).toFixed(1);
  const summaryNotes = [
    `<li><strong>Periodos academicos incluidos:</strong> ${escapeHtml(selectedPeriodsLabel)}.</li>`,
    `<li><strong>Momentos evaluados:</strong> ${escapeHtml(selectedMomentsLabel)}.</li>`,
    `<li><strong>Escala de calificacion (fase ${escapeHtml(phaseLabel).toLowerCase()}):</strong> 0 a ${scoreScale} puntos. Umbral insatisfactorio: menor a ${insatisfactorioThreshold} (equivalente a 70/100 normalizado).</li>`,
    `<li><strong>Definicion "aula":</strong> cada NRC equivale a 1 aula. Un docente puede tener varias aulas.</li>`,
    `<li><strong>Definicion "docente reincidente":</strong> docente con resultado insatisfactorio en mas de un momento dentro del consolidado actual.</li>`,
    `<li><strong>Total coordinaciones reportadas:</strong> ${options.rows.length} programa(s) con aulas en el consolidado.</li>`,
    `<li><strong>Correos destinatarios del envio:</strong> ${options.recipientsCount}.</li>`,
  ].join('');

  const aggregates = options.teacherAggregates;
  const teacherKpiBlock = aggregates
    ? [
        '<div class="panel">',
        '<div class="section-title">Docentes detras de las aulas (resumen)</div>',
        '<p style="margin:0 0 10px 0;color:#334155;font-size:13px;">Las cifras anteriores cuentan <strong>aulas (NRC)</strong>. La siguiente seccion cuenta <strong>docentes unicos</strong>. Un docente puede tener varias aulas y aparecer en mas de una banda de resultado.</p>',
        '<div class="kpi-grid">',
        '<div class="kpi"><div class="kpi-label">Docentes unicos en el consolidado</div>',
        `<div class="kpi-value">${aggregates.uniqueTeachers}</div></div>`,
        '<div class="kpi kpi-danger"><div class="kpi-label">Docentes con al menos un aula Insatisfactorio</div>',
        `<div class="kpi-value">${aggregates.uniqueUnsatisfactoryTeachers}</div><div class="kpi-meta">de ${aggregates.uniqueTeachers} docentes</div></div>`,
        '<div class="kpi kpi-warning"><div class="kpi-label">Docentes reincidentes</div>',
        `<div class="kpi-value">${aggregates.uniqueRecurrentTeachers}</div><div class="kpi-meta">insatisfactorio en mas de un momento</div></div>`,
        '</div>',
        '</div>',
      ].join('')
    : '';

  const programCampusRowsHtml = aggregates
    ? aggregates.programCampusRows
        .map((row, idx) => {
          const background = idx % 2 === 0 ? '#ffffff' : '#f8fbff';
          return [
            `<tr style="background:${background};font-size:14px;">`,
            `<td style="padding:8px 12px;text-align:left;font-weight:600;color:#0057A4;">${escapeHtml(row.coordination)}</td>`,
            `<td style="padding:8px 12px;text-align:left;">${escapeHtml(row.campus)}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${row.uniqueTeachers}</td>`,
            `<td style="padding:8px 12px;text-align:center;background:#fee2e2;font-weight:700;">${row.unsatisfactoryTeachers}</td>`,
            `<td style="padding:8px 12px;text-align:center;background:#fee2e2;">${row.unsatisfactoryCourses}</td>`,
            `<td style="padding:8px 12px;text-align:center;background:#ffedd5;">${row.recurrentTeachers}</td>`,
            '</tr>',
          ].join('');
        })
        .join('')
    : '';

  const programCampusBlock = aggregates && aggregates.programCampusRows.length
    ? [
        '<div class="panel">',
        '<div class="section-title">Docentes con resultado Insatisfactorio - desagregado por programa y Centro Universitario</div>',
        '<p style="margin:0 0 10px 0;color:#334155;font-size:13px;">Cada fila combina un programa con un Centro Universitario (CU). Solo se listan combinaciones con al menos un docente insatisfactorio.</p>',
        '<div class="table-container"><table class="report-table">',
        '<thead><tr><th>Programa (Coordinacion)</th><th>Centro Universitario</th><th>Docentes en la combinacion</th><th>Docentes Insatisfactorio</th><th>Aulas Insatisfactorio</th><th>Reincidentes</th></tr></thead>',
        `<tbody>${programCampusRowsHtml}</tbody>`,
        '</table></div></div>',
      ].join('')
    : '';

  const teacherListRowsHtml = aggregates
    ? aggregates.unsatisfactoryTeacherRows
        .map((row, idx) => {
          const background = idx % 2 === 0 ? '#ffffff' : '#fff7ed';
          const reincidenteBadge = row.recurrent
            ? '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#fbbf24;color:#7c2d12;font-weight:700;font-size:11px;">REINCIDENTE</span>'
            : '<span style="color:#64748b;font-size:11px;">No</span>';
          const replicadoNote = row.replicatedCount > 0
            ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${row.replicatedCount} aula(s) por replicacion de muestra</div>`
            : '';
          return [
            `<tr style="background:${background};font-size:13px;vertical-align:top;">`,
            `<td style="padding:8px 12px;text-align:left;font-weight:600;color:#0a3e74;">${escapeHtml(row.teacherName)}${replicadoNote}</td>`,
            `<td style="padding:8px 12px;text-align:left;">${escapeHtml(row.coordination)}</td>`,
            `<td style="padding:8px 12px;text-align:left;">${escapeHtml(row.campus)}</td>`,
            `<td style="padding:8px 12px;text-align:center;background:#fee2e2;font-weight:700;">${row.unsatisfactoryCourses}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${row.totalCourses}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${row.unsatisfactoryMomentsCount}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${reincidenteBadge}</td>`,
            '</tr>',
          ].join('');
        })
        .join('')
    : '';

  const teacherListBlock = aggregates && aggregates.unsatisfactoryTeacherRows.length
    ? [
        '<div class="panel">',
        '<div class="section-title">Listado nominal de docentes con aulas Insatisfactorio</div>',
        '<p style="margin:0 0 10px 0;color:#334155;font-size:13px;">Se incluyen todos los docentes con al menos un aula con calificacion insatisfactoria, incluso si solo tiene un NRC en esa banda y otros NRC en bandas superiores. Las aulas marcadas como "por replicacion de muestra" recibieron la calificacion derivada de un NRC representativo del docente.</p>',
        '<div class="table-container"><table class="report-table">',
        '<thead><tr><th>Docente</th><th>Programa</th><th>Centro Universitario</th><th>Aulas Insatisf.</th><th>Total aulas</th><th>Momentos con Insatisf.</th><th>Reincidente</th></tr></thead>',
        `<tbody>${teacherListRowsHtml}</tbody>`,
        '</table></div></div>',
      ].join('')
    : '';

  const significantEventsRowsHtml = options.significantEvents
    ? options.significantEvents
        .map((ev, idx) => {
          const bg = ev.resolved ? '#ecfccb' : (idx % 2 === 0 ? '#ffffff' : '#f8fbff');
          const estadoBadge = ev.resolved
            ? '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#a3e635;color:#3f6212;font-weight:700;font-size:10.5px;">SUBSANADO</span>'
            : '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:10.5px;">ACTIVO</span>';
          const firmadoIcon = ev.signed
            ? '<span style="color:#16a34a;font-weight:700;">SI</span>'
            : '<span style="color:#dc2626;">NO</span>';
          const entregadoIcon = ev.delivered
            ? '<span style="color:#16a34a;font-weight:700;">SI</span>'
            : '<span style="color:#dc2626;">NO</span>';
          const cargadoIcon = ev.archived
            ? '<span style="color:#16a34a;font-weight:700;">SI</span>'
            : '<span style="color:#dc2626;">NO</span>';
          return [
            `<tr style="background:${bg};font-size:13px;vertical-align:top;">`,
            `<td style="padding:8px 12px;text-align:center;font-weight:700;color:#0a3e74;">${idx + 1}</td>`,
            `<td style="padding:8px 12px;text-align:left;font-weight:600;color:#0a3e74;">${escapeHtml(ev.teacherName)}</td>`,
            `<td style="padding:8px 12px;text-align:left;">${escapeHtml(ev.coordination ?? '-')}</td>`,
            `<td style="padding:8px 12px;text-align:left;">${escapeHtml(ev.campus ?? '-')}</td>`,
            `<td style="padding:8px 12px;text-align:center;font-family:monospace;">${escapeHtml(ev.periodCode)}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${escapeHtml(ev.moment)}</td>`,
            `<td style="padding:8px 12px;text-align:center;font-weight:700;">${ev.resolvedScore != null ? ev.resolvedScore.toFixed(1) : ev.totalScore != null ? ev.totalScore.toFixed(1) : '-'}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${estadoBadge}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${firmadoIcon}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${entregadoIcon}</td>`,
            `<td style="padding:8px 12px;text-align:center;">${cargadoIcon}</td>`,
            '</tr>',
          ].join('');
        })
        .join('')
    : '';

  const significantEventsBlock = options.significantEvents && options.significantEvents.length
    ? (() => {
        const totalEvents = options.significantEvents!.length;
        const subsanados = options.significantEvents!.filter((e) => e.resolved).length;
        const activos = totalEvents - subsanados;
        const firmados = options.significantEvents!.filter((e) => e.signed).length;
        const entregados = options.significantEvents!.filter((e) => e.delivered).length;
        const cargados = options.significantEvents!.filter((e) => e.archived).length;
        return [
          '<div class="panel">',
          '<div class="section-title">Eventos significativos generados (Momento 1)</div>',
          '<p style="margin:0 0 10px 0;color:#334155;font-size:13px;">Listado nominal de docentes con resultado Insatisfactorio en el Momento 1, que cumplen el requisito institucional de antiguedad (>= 90 dias). Se incluye estado de firma, entrega y cargue en carpeta de la Subdireccion de Docencia.</p>',
          '<div class="kpi-grid">',
          `<div class="kpi"><div class="kpi-label">Eventos generados</div><div class="kpi-value">${totalEvents}</div></div>`,
          `<div class="kpi kpi-success"><div class="kpi-label">Subsanados</div><div class="kpi-value">${subsanados}</div><div class="kpi-meta">score actual >= 70</div></div>`,
          `<div class="kpi kpi-warning"><div class="kpi-label">Activos</div><div class="kpi-value">${activos}</div><div class="kpi-meta">en seguimiento</div></div>`,
          `<div class="kpi kpi-info"><div class="kpi-label">Firmados</div><div class="kpi-value">${firmados}</div><div class="kpi-meta">de ${totalEvents}</div></div>`,
          `<div class="kpi kpi-info"><div class="kpi-label">Entregados</div><div class="kpi-value">${entregados}</div><div class="kpi-meta">de ${totalEvents}</div></div>`,
          `<div class="kpi kpi-info"><div class="kpi-label">Cargados Subdireccion</div><div class="kpi-value">${cargados}</div><div class="kpi-meta">de ${totalEvents}</div></div>`,
          '</div>',
          '<div class="table-container" style="margin-top:12px;"><table class="report-table">',
          '<thead><tr><th>#</th><th>Docente</th><th>Programa (Coordinacion)</th><th>Centro Universitario</th><th>Periodo</th><th>Momento</th><th>Score actual</th><th>Estado</th><th>Firmado</th><th>Entregado</th><th>Cargado Subdir.</th></tr></thead>',
          `<tbody>${significantEventsRowsHtml}</tbody>`,
          '</table></div>',
          '<p style="margin:10px 0 0 0;font-size:12px;color:#64748b;font-style:italic;">El estado de firma/entrega/cargue se actualiza desde el modulo "Eventos Significativos" del sistema. Los docentes con calificacion corregida que pasen a >= 70 puntos quedan automaticamente marcados como SUBSANADO.</p>',
          '</div>',
        ].join('');
      })()
    : '';

  const acompanamientoBlock = [
    '<div class="panel panel-warm">',
    '<div class="section-title" style="color:#7a5b00;">Acompanamiento articulado con coordinadores de programa</div>',
    '<p style="margin:0 0 10px 0;color:#334155;font-size:13px;">Para los docentes con resultado Insatisfactorio, el sistema activa el siguiente protocolo, articulado con cada coordinador(a) de programa:</p>',
    '<ol style="margin:0 0 0 18px;padding:0;color:#334155;font-size:13px;line-height:1.6;">',
    '<li><strong>Notificacion individual al docente</strong> con su reporte de cierre, items con menor puntaje y plan de mejora especifico.</li>',
    '<li><strong>Plazo de subsanacion de 2 dias habiles</strong> a partir del envio del correo, para ajustar el aula virtual.</li>',
    '<li><strong>Comunicacion al coordinador(a) de programa</strong> con el listado de docentes insatisfactorios de su coordinacion, para gestion conjunta.</li>',
    '<li><strong>Convocatoria a Jornada de Induccion Campus Virtual</strong> (modalidad Teams) para los docentes con resultado insatisfactorio, articulada con la Direccion Academica.</li>',
    '<li><strong>Seguimiento de reincidentes</strong>: docentes con insatisfactorio en mas de un momento se priorizan para acompanamiento individualizado por parte del equipo de Campus Virtual.</li>',
    '</ol>',
    '</div>',
  ].join('');

  return [
    '<!DOCTYPE html><html lang="es"><head>',
    '<meta charset="UTF-8">',
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Reporte ejecutivo - Campus Virtual RCS</title>',
    BASE_REPORT_STYLE,
    '</head><body>',
    '<div class="shell"><div class="top-strip" style="background:#ffc300;background-image:linear-gradient(90deg,#ffc300 0%,#ffd95c 100%);"></div>',
    '<div class="hero" style="background:#002b5c;background-image:linear-gradient(120deg,#002b5c 0%,#0057a4 100%);color:#ffffff;">',
    '<h2 class="hero-title">Reporte ejecutivo - <span class="hero-highlight">Campus Virtual RCS</span></h2>',
    `<div class="hero-subtitle">Consolidado ${escapeHtml(selectedYearsLabel)} | Fase de ${escapeHtml(phaseLabel)} | Momentos ${escapeHtml(
      options.moments.map((moment) => formatMomentLabel(moment)).join(' + '),
    )}</div>`,
    `<div class="hero-period-pill">Periodos incluidos: ${escapeHtml(selectedPeriodsLabel)}</div>`,
    '</div>',
    '<div class="body-wrap">',
    `<div class="period-banner">FASE: ${escapeHtml(options.phase)} | MOMENTOS: ${escapeHtml(
      selectedMomentsLabel,
    )} | PERIODOS: ${escapeHtml(selectedPeriodsLabel)}</div>`,
    `<div class="quick-access"><p class="quick-access-title">Lectura recomendada</p><p class="quick-access-text">Este consolidado integra los periodos ${escapeHtml(
      selectedPeriodsLabel,
    )} en un solo reporte para priorizar decisiones de seguimiento.</p><div class="quick-access-actions">`,
    `<a class="cta-btn alt" href="${CAMPUS_VIRTUAL_COMMUNICADO_URL}" target="_blank" rel="noopener">Ver comunicado Campus Virtual</a>`,
    '</div></div>',
    '<p><strong>Cordial saludo,</strong></p>',
    `<p>Compartimos el consolidado ejecutivo de seguimiento de aulas para ${escapeHtml(
      phaseLabel.toLowerCase(),
    )}, integrando los momentos ${escapeHtml(selectedMomentsLabel)} y los periodos ${escapeHtml(
      selectedPeriodsLabel,
    )} en un solo correo.</p>`,
    '<div class="panel">',
    '<div class="section-title">Resumen ejecutivo (cifras en aulas)</div>',
    '<p style="margin:0 0 10px 0;color:#334155;font-size:13px;">Las cifras de esta seccion corresponden a <strong>aulas (NRC)</strong>, no a docentes. Un mismo docente puede tener varias aulas. Mas abajo se desagrega por docente unico.</p>',
    '<div class="kpi-grid">',
    '<div class="kpi"><div class="kpi-label">Periodos academicos</div>',
    `<div class="kpi-value">${options.periodCodes.length}</div><div class="kpi-meta">incluidos en el consolidado</div></div>`,
    '<div class="kpi"><div class="kpi-label">Momentos evaluados</div>',
    `<div class="kpi-value">${options.moments.length}</div><div class="kpi-meta">cantidad de momentos</div></div>`,
    '<div class="kpi"><div class="kpi-label">Aulas evaluadas (NRC)</div>',
    `<div class="kpi-value">${options.totalCourses}</div><div class="kpi-meta">total de aulas en el consolidado</div></div>`,
    '<div class="kpi"><div class="kpi-label">Correos destinatarios</div>',
    `<div class="kpi-value">${options.recipientsCount}</div><div class="kpi-meta">de este envio</div></div>`,
    '<div class="kpi"><div class="kpi-label">Promedio global de aulas</div>',
    `<div class="kpi-value">${averageLabel}</div><div class="kpi-meta">escala 0-${scoreScale} (fase ${escapeHtml(phaseLabel).toLowerCase()})</div></div>`,
    '<div class="kpi kpi-success"><div class="kpi-label">Aulas Excelente</div>',
    `<div class="kpi-value">${options.excellent}</div><div class="kpi-meta">${scoreSeg.EXCELENTE}% del total</div></div>`,
    '<div class="kpi kpi-info"><div class="kpi-label">Aulas Bueno</div>',
    `<div class="kpi-value">${options.good}</div><div class="kpi-meta">${scoreSeg.BUENO}% del total</div></div>`,
    '<div class="kpi kpi-warning"><div class="kpi-label">Aulas Aceptable</div>',
    `<div class="kpi-value">${options.acceptable}</div><div class="kpi-meta">${scoreSeg.ACEPTABLE}% del total</div></div>`,
    '<div class="kpi kpi-danger"><div class="kpi-label">Aulas Insatisfactorio</div>',
    `<div class="kpi-value">${options.unsatisfactory}</div><div class="kpi-meta">${scoreSeg.INSATISFACTORIO}% del total</div></div>`,
    '</div>',
    '<div class="score-bar-wrap"><p class="score-bar-title">Distribucion de aulas por banda de desempeno</p><div class="score-bar">',
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
    '<div class="section-title">Resumen de aulas por momento evaluado</div>',
    '<div class="table-container"><table class="report-table">',
    '<thead><tr><th>Momento</th><th>Aulas evaluadas</th><th>Promedio (aulas)</th><th>Aulas Excelente</th><th>Aulas Bueno</th><th>Aulas Aceptable</th><th>Aulas Insatisf.</th></tr></thead>',
    `<tbody>${momentRowsHtml}</tbody>`,
    '</table></div></div>',
    '<div class="panel">',
    '<div class="section-title">Resumen de aulas por periodo academico</div>',
    '<div class="table-container"><table class="report-table">',
    '<thead><tr><th>Periodo academico</th><th>Momentos</th><th>Aulas evaluadas</th><th>Promedio (aulas)</th><th>Aulas Excelente</th><th>Aulas Bueno</th><th>Aulas Aceptable</th><th>Aulas Insatisf.</th></tr></thead>',
    `<tbody>${periodRowsHtml}</tbody>`,
    '</table></div></div>',
    '<div class="panel">',
    '<div class="section-title">Aulas por coordinacion (programa)</div>',
    '<div class="table-container"><table class="report-table">',
    '<thead><tr><th>Coordinacion (programa)</th><th>Aulas evaluadas</th><th>Promedio (aulas)</th><th>Aulas Excelente</th><th>Aulas Bueno</th><th>Aulas Aceptable</th><th>Aulas Insatisf.</th></tr></thead>',
    `<tbody>${rowsHtml}</tbody>`,
    '</table></div></div>',
    teacherKpiBlock,
    programCampusBlock,
    teacherListBlock,
    significantEventsBlock,
    acompanamientoBlock,
    '<div class="panel panel-warm">',
    '<div class="section-title" style="color:#7a5b00;">Claves de lectura del consolidado</div>',
    `<ul class="obs-list">${summaryNotes}</ul>`,
    '</div>',
    '<div class="action-panel">',
    '<p class="action-title">Acompanamiento ejecutivo personalizado</p>',
    '<p class="action-text">Si requiere una lectura dirigida del consolidado o priorizar programas criticos, puede agendar un espacio con Campus Virtual.</p>',
    '<div class="cta-wrap" style="margin-top:0;">',
    `<a class="cta-btn" href="${TEACHER_BOOKING_URL}" target="_blank" rel="noopener">Agendar llamada / videollamada</a>`,
    '</div></div>',
    '<div style="margin-top:16px;text-align:center;color:#334155;font-size:13px;">Campus Virtual - Rectoria Centro Sur</div>',
    `<div class="report-footer">Generado el ${new Date().toISOString().slice(0, 10)} - Reporte ejecutivo consolidado ${escapeHtml(
      selectedYearsLabel,
    )}.</div>`,
    '</div></div>',
    '</body></html>',
  ].join('');
}
