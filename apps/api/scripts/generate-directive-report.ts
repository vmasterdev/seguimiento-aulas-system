import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Moment = 'MD1' | '1';
const MOMENTS: Moment[] = ['MD1', '1'];

function pct(part: number, total: number): string {
  if (!total) return '0.0';
  return ((part / total) * 100).toFixed(1);
}

function toDateLabel(value: Date | null | undefined): string {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function main() {
  const periods = await prisma.period.findMany({
    where: { code: { startsWith: '2026' } },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });
  const targetPeriods = periods.filter((period) => !period.code.endsWith('80') && !period.code.endsWith('85'));
  const targetPeriodIds = targetPeriods.map((period) => period.id);

  const teachersTotal = await prisma.teacher.count();
  const teachersWithEmail = await prisma.teacher.count({ where: { email: { not: null } } });
  const sampleTeachers = await prisma.sampleGroup.findMany({
    where: { periodId: { in: targetPeriodIds }, moment: { in: MOMENTS } },
    distinct: ['teacherId'],
    select: { teacherId: true },
  });

  const outboxAll = await prisma.outboxMessage.count({
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: targetPeriodIds },
      moment: { in: MOMENTS },
    },
  });
  const outboxSent = await prisma.outboxMessage.count({
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: targetPeriodIds },
      moment: { in: MOMENTS },
      status: { in: ['SENT_AUTO', 'SENT_MANUAL'] },
    },
  });
  const outboxPending = await prisma.outboxMessage.count({
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: targetPeriodIds },
      moment: { in: MOMENTS },
      status: { in: ['DRAFT', 'EXPORTED'] },
    },
  });

  const byMomentSentRaw = await prisma.outboxMessage.groupBy({
    by: ['moment'],
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: targetPeriodIds },
      moment: { in: MOMENTS },
      status: { in: ['SENT_AUTO', 'SENT_MANUAL'] },
    },
    orderBy: { moment: 'asc' },
    _count: { moment: true },
  });
  const byMomentSent = Object.fromEntries(
    byMomentSentRaw.map((row) => [
      row.moment,
      typeof row._count === 'object' && row._count && 'moment' in row._count
        ? Number(row._count.moment ?? 0)
        : 0,
    ]),
  ) as Record<string, number>;

  const evaluations = await prisma.evaluation.findMany({
    where: {
      phase: 'ALISTAMIENTO',
      course: { periodId: { in: targetPeriodIds }, moment: { in: MOMENTS } },
    },
    select: { score: true },
  });
  let high = 0;
  let mid = 0;
  let followUp = 0;
  for (const evaluation of evaluations) {
    const score = evaluation.score ?? 0;
    if (score >= 35) high += 1;
    else if (score >= 25) mid += 1;
    else followUp += 1;
  }

  const pendingTeachers = await prisma.outboxMessage.findMany({
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: targetPeriodIds },
      moment: { in: MOMENTS },
      status: 'DRAFT',
      OR: [{ recipientEmail: null }, { recipientEmail: '' }],
    },
    select: {
      recipientName: true,
      teacherId: true,
      period: { select: { code: true } },
      moment: true,
    },
    orderBy: [{ period: { code: 'asc' } }, { moment: 'asc' }],
  });

  const firstOutbox = await prisma.outboxMessage.findFirst({
    where: {
      audience: 'DOCENTE',
      phase: 'ALISTAMIENTO',
      periodId: { in: targetPeriodIds },
      moment: { in: MOMENTS },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const lastSentAudit = await prisma.auditLog.findFirst({
    where: {
      entityType: 'OUTBOX_MESSAGE',
      action: 'OUTBOX_SEND_SENT',
      createdAt: { gte: new Date('2026-03-01T00:00:00Z') },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const reportDate = new Date();
  const stamp = reportDate.toISOString().slice(0, 10);
  const fileName = `informe_directivo_global_envio_2026_alistamiento_md1_ryc_${stamp}.html`;
  const reportDir = path.resolve(process.cwd(), '../../storage/outputs/reports');
  const reportPath = path.join(reportDir, fileName);
  const jsonPath = reportPath.replace(/\.html$/i, '.json');

  const sentRate = Number(pct(outboxSent, outboxAll));
  const sentWidth = Math.max(2, sentRate);
  const pendingWidth = Math.max(2, 100 - sentRate);

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Informe Directivo Global - Envio Reportes Docentes</title>
  <style>
    :root{
      --bg:#f3f7fc;
      --panel:#ffffff;
      --line:#d9e2ef;
      --ink:#0f172a;
      --muted:#475569;
      --brand:#004b8d;
      --ok:#1f9d55;
      --warn:#d97706;
      --bad:#dc2626;
    }
    *{box-sizing:border-box}
    body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:linear-gradient(130deg,#f2f7ff,#f8fbff);color:var(--ink)}
    .wrap{max-width:1000px;margin:18px auto;padding:0 12px}
    .hero{background:linear-gradient(120deg,#00366a,#0057a4);color:#fff;border-radius:14px;padding:18px}
    .hero h1{margin:0 0 6px;font-size:24px}
    .hero p{margin:0;color:#dbeafe}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:12px}
    .kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}
    .kpi .label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px}
    .kpi .value{font-size:27px;font-weight:700;color:#0a2d5f;margin-top:4px}
    .panel{margin-top:12px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}
    h2{margin:0 0 8px;font-size:18px;color:#0b2e5a}
    p,li{font-size:14px;line-height:1.45}
    .muted{color:var(--muted);font-size:13px}
    .progress{height:20px;border-radius:999px;overflow:hidden;background:#e7eef9;display:flex}
    .seg-ok{background:var(--ok)}
    .seg-pending{background:var(--warn)}
    .legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:13px;color:#1f2937}
    .legend span::before{content:\"\";display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
    .legend .ok::before{background:var(--ok)}
    .legend .pending::before{background:var(--warn)}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th,td{padding:8px 6px;border-bottom:1px solid #e7edf7;font-size:13px;text-align:left}
    th{font-size:12px;color:var(--muted);text-transform:uppercase}
    .n{font-weight:700}
    .highlight{background:#eff6ff;border:1px solid #dbeafe;border-radius:10px;padding:10px}
    .foot{margin:14px 0;text-align:center;font-size:12px;color:#64748b}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>Informe Global para Direccion</h1>
      <p>Proceso de alistamiento y envio de reportes docentes - Momentos M1 (MD1) y RYC (1)</p>
      <p>Periodo de gestion: 2026 (se excluyen periodos 80 y 85) | Fecha de informe: ${escapeHtml(toDateLabel(reportDate))}</p>
    </section>

    <section class="grid">
      <article class="kpi"><div class="label">Docentes en base</div><div class="value">${teachersTotal}</div></article>
      <article class="kpi"><div class="label">Docentes impactados</div><div class="value">${sampleTeachers.length}</div></article>
      <article class="kpi"><div class="label">Reportes generados</div><div class="value">${outboxAll}</div></article>
      <article class="kpi"><div class="label">Reportes enviados</div><div class="value">${outboxSent}</div></article>
      <article class="kpi"><div class="label">% Envio efectivo</div><div class="value">${sentRate}%</div></article>
      <article class="kpi"><div class="label">Pendientes</div><div class="value">${outboxPending}</div></article>
    </section>

    <section class="panel">
      <h2>Mensaje Ejecutivo</h2>
      <div class="highlight">
        <p>Se completo el ciclo de envio de reportes para los momentos M1 y RYC con un resultado de <span class="n">${outboxSent} de ${outboxAll}</span> reportes entregados por canal institucional.</p>
        <p>La operacion tuvo una cobertura alta y estable, con un pendiente puntual de datos de contacto en <span class="n">${pendingTeachers.length}</span> registros.</p>
      </div>
    </section>

    <section class="panel">
      <h2>Estado General del Envio</h2>
      <div class="progress">
        <div class="seg-ok" style="width:${sentWidth}%"></div>
        <div class="seg-pending" style="width:${pendingWidth}%"></div>
      </div>
      <div class="legend">
        <span class="ok">Enviado: ${outboxSent}</span>
        <span class="pending">Pendiente: ${outboxPending}</span>
      </div>
      <p class="muted" style="margin-top:8px">Distribucion por momento: M1 (MD1) ${byMomentSent.MD1 ?? 0} reportes enviados | RYC (1) ${byMomentSent['1'] ?? 0} reportes enviados.</p>
    </section>

    <section class="panel">
      <h2>Panorama Academico (Alistamiento)</h2>
      <p>Los resultados de seguimiento se consolidan en tres niveles de lectura para direccion:</p>
      <ul>
        <li><span class="n">Nivel alto de cumplimiento</span> (Excelente/Bueno): ${high} aulas.</li>
        <li><span class="n">Nivel medio</span> (Aceptable): ${mid} aulas.</li>
        <li><span class="n">En seguimiento prioritario</span> (Insatisfactorio): ${followUp} aulas.</li>
      </ul>
    </section>

    <section class="panel">
      <h2>Cobertura de Informacion</h2>
      <p>Base docente con correo disponible: <span class="n">${teachersWithEmail}</span> de <span class="n">${teachersTotal}</span> (${pct(teachersWithEmail, teachersTotal)}%).</p>
      <p class="muted">Los casos sin correo afectan directamente la capacidad de cierre al 100% del envio automatico.</p>
    </section>

    <section class="panel">
      <h2>Pendientes de Gestion</h2>
      <table>
        <thead><tr><th>Periodo</th><th>Momento</th><th>Docente</th><th>ID Docente</th></tr></thead>
        <tbody>
          ${
            pendingTeachers.length
              ? pendingTeachers
                  .map(
                    (row) => `<tr><td>${escapeHtml(row.period.code)}</td><td>${escapeHtml(
                      row.moment === 'MD1' ? 'M1 (MD1)' : 'RYC (1)',
                    )}</td><td>${escapeHtml(row.recipientName ?? 'N/A')}</td><td>${escapeHtml(
                      row.teacherId ?? 'N/A',
                    )}</td></tr>`,
                  )
                  .join('')
              : '<tr><td colspan="4">Sin pendientes de correo.</td></tr>'
          }
        </tbody>
      </table>
      <p class="muted" style="margin-top:8px">Inicio de generacion de reportes: ${escapeHtml(toDateLabel(firstOutbox?.createdAt))} | Ultimo envio exitoso registrado: ${escapeHtml(toDateLabel(lastSentAudit?.createdAt))}</p>
    </section>

    <section class="panel">
      <h2>Proximos Pasos Recomendados</h2>
      <ol>
        <li>Completar correos faltantes para cerrar los pendientes finales.</li>
        <li>Mantener este formato de informe global para cada nuevo momento y semestre.</li>
        <li>Repetir el cierre operativo desde la interfaz para los siguientes ciclos (misma metodologia).</li>
      </ol>
    </section>

    <div class="foot">Informe ejecutivo global - Seguimiento Aulas Virtuales</div>
  </div>
</body>
</html>`;

  const payload = {
    generatedAt: reportDate.toISOString(),
    scope: {
      periods: targetPeriods.map((period) => period.code),
      phase: 'ALISTAMIENTO',
      moments: MOMENTS,
    },
    summary: {
      teachersTotal,
      teachersWithEmail,
      sampleTeachers: sampleTeachers.length,
      reportsGenerated: outboxAll,
      reportsSent: outboxSent,
      reportsPending: outboxPending,
      sentRate: sentRate,
      sentByMoment: {
        MD1: byMomentSent.MD1 ?? 0,
        RYC1: byMomentSent['1'] ?? 0,
      },
      academicSnapshot: {
        high,
        mid,
        followUp,
      },
    },
    pendingTeachers,
    files: { html: reportPath, json: jsonPath },
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, html, 'utf8');
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        reportPath,
        jsonPath,
        subject: 'Informe global para direccion - Envio de reportes docentes (Alistamiento M1 y RYC)',
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

