import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

type Moment = 'MD1' | '1';

const prisma = new PrismaClient();

const MOMENTS: Moment[] = ['MD1', '1'];
const SCORE_BANDS = ['Excelente', 'Bueno', 'Aceptable', 'Insatisfactorio'] as const;

function pct(part: number, total: number): string {
  if (!total) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function toLocalDate(iso: Date | null | undefined): string {
  if (!iso) return 'N/A';
  const value = new Date(iso);
  return value.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreBand(score: number | null): (typeof SCORE_BANDS)[number] {
  if (score == null) return 'Insatisfactorio';
  if (score >= 45) return 'Excelente';
  if (score >= 35) return 'Bueno';
  if (score >= 25) return 'Aceptable';
  return 'Insatisfactorio';
}

function momentLabel(moment: string): string {
  if (moment === 'MD1') return 'M1 (MD1)';
  if (moment === '1') return 'RYC (1)';
  return moment;
}

function horizontalBars(rows: Array<{ label: string; value: number; color: string }>): string {
  const max = rows.reduce((acc, row) => Math.max(acc, row.value), 0) || 1;
  return rows
    .map((row) => {
      const width = Math.max(2, Math.round((row.value / max) * 100));
      return [
        '<div class="bar-row">',
        `<div class="bar-label">${escapeHtml(row.label)}</div>`,
        '<div class="bar-track">',
        `<div class="bar-fill" style="width:${width}%;background:${row.color};"></div>`,
        '</div>',
        `<div class="bar-value">${row.value}</div>`,
        '</div>',
      ].join('');
    })
    .join('');
}

async function main() {
  const periodsRaw = await prisma.period.findMany({
    where: { code: { startsWith: '2026' } },
    select: { id: true, code: true, label: true },
    orderBy: { code: 'asc' },
  });
  const periods = periodsRaw.filter(
    (period) => !period.code.endsWith('80') && !period.code.endsWith('85'),
  );
  const periodIds = periods.map((period) => period.id);
  const periodCodeById = new Map(periods.map((period) => [period.id, period.code]));

  const [teachersTotal, teachersWithEmail, teachersWithDocId, teachersWithSourceId] =
    await Promise.all([
      prisma.teacher.count(),
      prisma.teacher.count({ where: { email: { not: null } } }),
      prisma.teacher.count({ where: { documentId: { not: null } } }),
      prisma.teacher.count({ where: { sourceId: { not: null } } }),
    ]);
  const teachersWithoutEmail = teachersTotal - teachersWithEmail;

  const coursesTotal = await prisma.course.count({ where: { periodId: { in: periodIds } } });
  const coursesWithTeacher = await prisma.course.count({
    where: { periodId: { in: periodIds }, teacherId: { not: null } },
  });
  const coursesWithoutTeacher = coursesTotal - coursesWithTeacher;

  const sampleGroupsTotal = await prisma.sampleGroup.count({
    where: { periodId: { in: periodIds }, moment: { in: MOMENTS } },
  });
  const sampleTeachersDistinct = await prisma.sampleGroup.findMany({
    where: { periodId: { in: periodIds }, moment: { in: MOMENTS } },
    distinct: ['teacherId'],
    select: { teacherId: true },
  });

  const evaluations = await prisma.evaluation.findMany({
    where: {
      phase: 'ALISTAMIENTO',
      course: { periodId: { in: periodIds }, moment: { in: MOMENTS } },
    },
    select: {
      score: true,
      replicatedFromCourseId: true,
      course: { select: { periodId: true, moment: true } },
    },
  });

  let evalReviewed = 0;
  let evalReplicated = 0;
  const evalByBand: Record<(typeof SCORE_BANDS)[number], number> = {
    Excelente: 0,
    Bueno: 0,
    Aceptable: 0,
    Insatisfactorio: 0,
  };
  const evalByMoment = new Map<string, { reviewed: number; replicated: number; total: number }>();
  const evalByPeriodMoment = new Map<
    string,
    { periodCode: string; moment: string; reviewed: number; replicated: number; total: number }
  >();

  for (const item of evaluations) {
    const isReplicated = Boolean(item.replicatedFromCourseId);
    if (isReplicated) evalReplicated += 1;
    else evalReviewed += 1;
    evalByBand[scoreBand(item.score)] += 1;

    const moment = item.course.moment ?? 'NA';
    const currentMoment = evalByMoment.get(moment) ?? { reviewed: 0, replicated: 0, total: 0 };
    currentMoment.total += 1;
    if (isReplicated) currentMoment.replicated += 1;
    else currentMoment.reviewed += 1;
    evalByMoment.set(moment, currentMoment);

    const periodCode = periodCodeById.get(item.course.periodId) ?? 'NA';
    const key = `${periodCode}|${moment}`;
    const currentPeriodMoment = evalByPeriodMoment.get(key) ?? {
      periodCode,
      moment,
      reviewed: 0,
      replicated: 0,
      total: 0,
    };
    currentPeriodMoment.total += 1;
    if (isReplicated) currentPeriodMoment.replicated += 1;
    else currentPeriodMoment.reviewed += 1;
    evalByPeriodMoment.set(key, currentPeriodMoment);
  }

  const outboxAll = await prisma.outboxMessage.count({
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: periodIds },
      moment: { in: MOMENTS },
    },
  });
  const outboxByStatusRaw = await prisma.outboxMessage.groupBy({
    by: ['status'],
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: periodIds },
      moment: { in: MOMENTS },
    },
    orderBy: { status: 'asc' },
    _count: { status: true },
  });
  const outboxByStatus = outboxByStatusRaw.map((item) => ({
    status: item.status,
    count:
      typeof item._count === 'object' && item._count && 'status' in item._count
        ? Number(item._count.status ?? 0)
        : 0,
  }));
  const outboxSent = outboxByStatus
    .filter((item) => item.status === 'SENT_AUTO' || item.status === 'SENT_MANUAL')
    .reduce((acc, item) => acc + item.count, 0);
  const outboxDraft = outboxByStatus.find((item) => item.status === 'DRAFT')?.count ?? 0;

  const outboxByPeriodMomentRaw = await prisma.outboxMessage.groupBy({
    by: ['periodId', 'moment', 'status'],
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: periodIds },
      moment: { in: MOMENTS },
    },
    orderBy: [{ periodId: 'asc' }, { moment: 'asc' }, { status: 'asc' }],
    _count: { status: true },
  });
  const outboxByPeriodMoment = outboxByPeriodMomentRaw.map((row) => ({
    periodCode: periodCodeById.get(row.periodId) ?? 'NA',
    moment: row.moment,
    status: row.status,
    count:
      typeof row._count === 'object' && row._count && 'status' in row._count
        ? Number(row._count.status ?? 0)
        : 0,
  }));

  const missingRecipients = await prisma.outboxMessage.findMany({
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: periodIds },
      moment: { in: MOMENTS },
      status: 'DRAFT',
      OR: [{ recipientEmail: null }, { recipientEmail: '' }],
    },
    select: {
      period: { select: { code: true } },
      moment: true,
      recipientName: true,
      teacherId: true,
      subject: true,
    },
    orderBy: [{ period: { code: 'asc' } }, { moment: 'asc' }],
  });

  const moodleByStatusRaw = await prisma.moodleCheck.groupBy({
    by: ['status'],
    where: {
      course: { periodId: { in: periodIds }, moment: { in: MOMENTS } },
    },
    orderBy: { status: 'asc' },
    _count: { status: true },
  });
  const moodleByStatus = moodleByStatusRaw.map((row) => ({
    status: row.status,
    count:
      typeof row._count === 'object' && row._count && 'status' in row._count
        ? Number(row._count.status ?? 0)
        : 0,
  }));

  const [teachersLoadedAt, coursesLoadedAt, sampleBuiltAt, firstEvaluationAt, outboxGeneratedAt] =
    await Promise.all([
      prisma.teacher.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      prisma.course.findFirst({
        where: { periodId: { in: periodIds } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.sampleGroup.findFirst({
        where: { periodId: { in: periodIds }, moment: { in: MOMENTS } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.evaluation.findFirst({
        where: {
          phase: 'ALISTAMIENTO',
          course: { periodId: { in: periodIds }, moment: { in: MOMENTS } },
        },
        orderBy: { computedAt: 'asc' },
        select: { computedAt: true },
      }),
      prisma.outboxMessage.findFirst({
        where: {
          audience: 'DOCENTE',
          phase: 'ALISTAMIENTO',
          periodId: { in: periodIds },
          moment: { in: MOMENTS },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

  const auditSendCountsRaw = await prisma.auditLog.groupBy({
    by: ['action'],
    where: {
      entityType: 'OUTBOX_MESSAGE',
      action: { in: ['OUTBOX_SEND_SENT', 'OUTBOX_SEND_FAILED', 'OUTBOX_REGENERATED'] },
      createdAt: { gte: new Date('2026-03-01T00:00:00Z') },
    },
    orderBy: { action: 'asc' },
    _count: { action: true },
  });
  const auditSendCounts = auditSendCountsRaw.map((row) => ({
    action: row.action,
    count:
      typeof row._count === 'object' && row._count && 'action' in row._count
        ? Number(row._count.action ?? 0)
        : 0,
  }));

  const auditTimeline = await prisma.auditLog.findMany({
    where: {
      entityType: 'OUTBOX_MESSAGE',
      action: { in: ['OUTBOX_SEND_SENT', 'OUTBOX_SEND_FAILED', 'OUTBOX_REGENERATED'] },
      createdAt: { gte: new Date('2026-03-01T00:00:00Z') },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, action: true },
  });
  const auditWindow = {
    firstTs: auditTimeline[0]?.createdAt ?? null,
    lastTs: auditTimeline[auditTimeline.length - 1]?.createdAt ?? null,
    totalEvents: auditTimeline.length,
  };

  const sentAuditCount =
    auditSendCounts.find((item) => item.action === 'OUTBOX_SEND_SENT')?.count ?? 0;
  const failedAuditCount =
    auditSendCounts.find((item) => item.action === 'OUTBOX_SEND_FAILED')?.count ?? 0;

  const insights = [
    `Efectividad de envio final: ${outboxSent}/${outboxAll} (${pct(outboxSent, outboxAll)}) correos entregados al canal SMTP/Outlook.`,
    `Palanca de replicacion: ${evalReplicated}/${evaluations.length} evaluaciones (${pct(evalReplicated, evaluations.length)}) fueron replicadas desde NRC base, reduciendo carga operativa manual.`,
    `Cobertura de asignacion docente en cursos 2026 (sin 80/85): ${coursesWithTeacher}/${coursesTotal} (${pct(coursesWithTeacher, coursesTotal)}).`,
    `Pendiente operativo puntual: ${missingRecipients.length} correos en borrador por ausencia de email docente (mismo docente ID ${missingRecipients[0]?.teacherId ?? 'N/A'}).`,
    `Ventana de ejecucion final de envios: ${toLocalDate(auditWindow.firstTs)} a ${toLocalDate(auditWindow.lastTs)}.`,
  ];

  const reportDate = new Date();
  const reportStamp = reportDate.toISOString().slice(0, 10);
  const reportFileName = `reporte_ejecutivo_envio_final_alistamiento_2026_md1_ryc_${reportStamp}.html`;
  const reportDir = path.resolve(process.cwd(), '../../storage/outputs/reports');
  const reportPath = path.join(reportDir, reportFileName);

  const statusBars = horizontalBars(
    outboxByStatus.map((row, idx) => ({
      label: row.status,
      value: row.count,
      color: ['#0057a4', '#2f855a', '#d97706', '#b91c1c'][idx % 4],
    })),
  );
  const bandBars = horizontalBars([
    { label: 'Excelente', value: evalByBand.Excelente, color: '#1f9d55' },
    { label: 'Bueno', value: evalByBand.Bueno, color: '#1d4ed8' },
    { label: 'Aceptable', value: evalByBand.Aceptable, color: '#d97706' },
    { label: 'Insatisfactorio', value: evalByBand.Insatisfactorio, color: '#dc2626' },
  ]);
  const moodleBars = horizontalBars(
    moodleByStatus.map((row, idx) => ({
      label: row.status,
      value: row.count,
      color: ['#1f9d55', '#d97706', '#dc2626', '#0057a4'][idx % 4],
    })),
  );

  const tableOutboxPeriodMoment = outboxByPeriodMoment
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.periodCode)}</td>
        <td>${escapeHtml(momentLabel(row.moment))}</td>
        <td>${escapeHtml(row.status)}</td>
        <td class="num">${row.count}</td>
      </tr>`,
    )
    .join('');

  const tableEvalPeriodMoment = [...evalByPeriodMoment.values()]
    .sort((a, b) =>
      `${a.periodCode}|${a.moment}`.localeCompare(`${b.periodCode}|${b.moment}`, 'es'),
    )
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.periodCode)}</td>
        <td>${escapeHtml(momentLabel(row.moment))}</td>
        <td class="num">${row.reviewed}</td>
        <td class="num">${row.replicated}</td>
        <td class="num">${row.total}</td>
      </tr>`,
    )
    .join('');

  const pendingRows = missingRecipients.length
    ? missingRecipients
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.period.code)}</td>
        <td>${escapeHtml(momentLabel(row.moment))}</td>
        <td>${escapeHtml(row.recipientName ?? 'N/A')}</td>
        <td>${escapeHtml(row.teacherId ?? 'N/A')}</td>
        <td>${escapeHtml(row.subject)}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="5">Sin pendientes por correo faltante.</td></tr>`;

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Reporte Ejecutivo - Envio Final Docentes</title>
  <style>
    :root{
      --bg:#f4f7fb;
      --card:#ffffff;
      --ink:#0f172a;
      --muted:#475569;
      --line:#d7deea;
      --brand:#0057a4;
      --ok:#1f9d55;
      --warn:#d97706;
      --bad:#dc2626;
    }
    *{box-sizing:border-box}
    body{margin:0;background:linear-gradient(135deg,#eef4ff,#f8fbff);font-family:Segoe UI,Arial,sans-serif;color:var(--ink)}
    .wrap{max-width:1100px;margin:20px auto;padding:0 12px}
    .hero{background:linear-gradient(120deg,#002b5c,#0057a4);color:#fff;border-radius:14px;padding:18px 20px}
    .hero h1{margin:0 0 6px;font-size:24px}
    .hero p{margin:0;color:#dbeafe}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px}
    .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
    .kpi .label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
    .kpi .value{font-size:26px;font-weight:700;color:#0b2e5a;margin-top:4px}
    .panel{margin-top:12px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
    h2{margin:0 0 8px;font-size:18px;color:#0b2e5a}
    h3{margin:10px 0 8px;font-size:15px;color:#1e3a8a}
    .muted{color:var(--muted);font-size:13px}
    .bar-row{display:grid;grid-template-columns:220px 1fr 70px;align-items:center;gap:8px;margin:6px 0}
    .bar-label{font-size:13px;color:#1f2937}
    .bar-track{height:16px;background:#e5edf8;border-radius:999px;overflow:hidden}
    .bar-fill{height:100%;border-radius:999px}
    .bar-value{text-align:right;font-weight:700;color:#1f2937;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{padding:8px 6px;border-bottom:1px solid #e5ecf6;font-size:13px;text-align:left;vertical-align:top}
    th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.3px}
    td.num{text-align:right;font-variant-numeric:tabular-nums}
    ul{margin:6px 0 0;padding-left:18px}
    li{margin:6px 0;font-size:14px}
    .foot{margin:14px 0 20px;color:#64748b;font-size:12px;text-align:center}
    @media (max-width:700px){
      .bar-row{grid-template-columns:1fr}
      .bar-value{text-align:left}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Reporte Ejecutivo - Operacion Envio Final Docentes</h1>
      <p>Alcance: RPACA a envio final | Fase ALISTAMIENTO | Momentos MD1 (M1) y RYC (1) | Periodos 2026 excepto 80 y 85</p>
      <p>Generado: ${escapeHtml(toLocalDate(reportDate))}</p>
    </section>

    <section class="grid">
      <article class="kpi"><div class="label">Docentes Totales</div><div class="value">${teachersTotal}</div></article>
      <article class="kpi"><div class="label">Docentes con Correo</div><div class="value">${teachersWithEmail}</div></article>
      <article class="kpi"><div class="label">Cursos 2026 Analizados</div><div class="value">${coursesTotal}</div></article>
      <article class="kpi"><div class="label">Muestreos (MD1+1)</div><div class="value">${sampleGroupsTotal}</div></article>
      <article class="kpi"><div class="label">Evaluaciones Alistamiento</div><div class="value">${evaluations.length}</div></article>
      <article class="kpi"><div class="label">Correos Enviados</div><div class="value">${outboxSent}</div></article>
    </section>

    <section class="panel">
      <h2>Resumen Ejecutivo</h2>
      <ul>
        ${insights.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
      </ul>
    </section>

    <section class="panel">
      <h2>Flujo Operativo End-to-End</h2>
      <h3>1) Consolidacion RPACA / Docentes</h3>
      <div class="muted">
        Docentes cargados: <b>${teachersTotal}</b> | con sourceId: <b>${teachersWithSourceId}</b> | con documento: <b>${teachersWithDocId}</b> | sin correo: <b>${teachersWithoutEmail}</b>
      </div>
      <h3>2) Cursos y Cobertura Docente</h3>
      <div class="muted">
        Cursos con docente: <b>${coursesWithTeacher}</b> (${pct(coursesWithTeacher, coursesTotal)}) | cursos sin docente: <b>${coursesWithoutTeacher}</b> (${pct(coursesWithoutTeacher, coursesTotal)})
      </div>
      <h3>3) Muestreo y Evaluacion</h3>
      <div class="muted">
        Docentes impactados por muestreo: <b>${sampleTeachersDistinct.length}</b> | Evaluaciones revisadas base: <b>${evalReviewed}</b> | replicadas: <b>${evalReplicated}</b>
      </div>
      <h3>4) Outbox y Envio</h3>
      <div class="muted">
        Mensajes outbox docentes: <b>${outboxAll}</b> | enviados: <b>${outboxSent}</b> (${pct(outboxSent, outboxAll)}) | en borrador: <b>${outboxDraft}</b>
      </div>
    </section>

    <section class="panel">
      <h2>Graficas Operativas</h2>
      <h3>Estado Outbox (Docentes, Alistamiento, MD1 + 1)</h3>
      ${statusBars}

      <h3>Distribucion de Puntajes (Escala 0-50)</h3>
      ${bandBars}

      <h3>Estado Moodle (MD1 + 1)</h3>
      ${moodleBars}
    </section>

    <section class="panel">
      <h2>Detalle por Periodo y Momento</h2>
      <h3>Outbox por estado</h3>
      <table>
        <thead><tr><th>Periodo</th><th>Momento</th><th>Estado</th><th class="num">Cantidad</th></tr></thead>
        <tbody>${tableOutboxPeriodMoment}</tbody>
      </table>

      <h3>Evaluaciones (revisado vs replicado)</h3>
      <table>
        <thead><tr><th>Periodo</th><th>Momento</th><th class="num">Revisado</th><th class="num">Replicado</th><th class="num">Total</th></tr></thead>
        <tbody>${tableEvalPeriodMoment}</tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Pendientes y Riesgos</h2>
      <h3>Correos pendientes por ausencia de email</h3>
      <table>
        <thead><tr><th>Periodo</th><th>Momento</th><th>Docente</th><th>ID Docente</th><th>Asunto</th></tr></thead>
        <tbody>${pendingRows}</tbody>
      </table>
      <h3>Linea de tiempo de ejecucion</h3>
      <table>
        <tbody>
          <tr><th>Inicio carga base docentes</th><td>${escapeHtml(toLocalDate(teachersLoadedAt?.createdAt))}</td></tr>
          <tr><th>Inicio carga cursos 2026</th><td>${escapeHtml(toLocalDate(coursesLoadedAt?.createdAt))}</td></tr>
          <tr><th>Primer muestreo MD1/1</th><td>${escapeHtml(toLocalDate(sampleBuiltAt?.createdAt))}</td></tr>
          <tr><th>Primera evaluacion alistamiento</th><td>${escapeHtml(toLocalDate(firstEvaluationAt?.computedAt))}</td></tr>
          <tr><th>Primer outbox docente generado</th><td>${escapeHtml(toLocalDate(outboxGeneratedAt?.createdAt))}</td></tr>
          <tr><th>Ventana final de envios auditada</th><td>${escapeHtml(toLocalDate(auditWindow.firstTs))} a ${escapeHtml(toLocalDate(auditWindow.lastTs))} (${auditWindow.totalEvents} eventos)</td></tr>
          <tr><th>Eventos de envio exitoso (audit)</th><td>${sentAuditCount}</td></tr>
          <tr><th>Eventos de envio fallido (audit)</th><td>${failedAuditCount}</td></tr>
        </tbody>
      </table>
    </section>

    <div class="foot">
      Reporte generado automaticamente por seguimiento-aulas-system | Fase ALISTAMIENTO | MD1 + RYC
    </div>
  </div>
</body>
</html>`;

  const jsonSummary = {
    generatedAt: reportDate.toISOString(),
    scope: {
      periods: periods.map((period) => period.code),
      phase: 'ALISTAMIENTO',
      moments: MOMENTS,
      audience: 'DOCENTE',
    },
    kpis: {
      teachersTotal,
      teachersWithEmail,
      teachersWithoutEmail,
      coursesTotal,
      coursesWithTeacher,
      coursesWithoutTeacher,
      sampleGroupsTotal,
      sampleTeachersDistinct: sampleTeachersDistinct.length,
      evaluationsTotal: evaluations.length,
      evaluationsReviewed: evalReviewed,
      evaluationsReplicated: evalReplicated,
      outboxAll,
      outboxSent,
      outboxDraft,
    },
    outboxByStatus,
    outboxByPeriodMoment,
    evalByBand,
    evalByMoment: Object.fromEntries(evalByMoment.entries()),
    evalByPeriodMoment: [...evalByPeriodMoment.values()],
    moodleByStatus,
    missingRecipients,
    auditSendCounts,
    auditWindow,
    insights,
    htmlPath: reportPath,
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, html, 'utf8');
  await writeFile(reportPath.replace(/\.html$/i, '.json'), JSON.stringify(jsonSummary, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        reportPath,
        jsonPath: reportPath.replace(/\.html$/i, '.json'),
        subject:
          'Reporte ejecutivo - Operacion envio final ALISTAMIENTO (MD1 y RYC) - Periodos 2026',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
