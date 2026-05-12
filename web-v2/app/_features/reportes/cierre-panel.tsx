'use client';

import { useState, useMemo, useEffect } from 'react';
import { fetchJson } from '../../_lib/http';

// Festivos Colombia 2026-2027 (formato YYYY-MM-DD)
const CO_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
  '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
  '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
  '2026-11-16', '2026-12-08', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26',
  '2027-05-01', '2027-05-10', '2027-05-31', '2027-06-07', '2027-07-05',
  '2027-07-20', '2027-08-07', '2027-08-16', '2027-10-18', '2027-11-01',
  '2027-11-15', '2027-12-08', '2027-12-25',
]);

function isBusinessDay(d: Date): boolean {
  const dow = d.getDay(); // 0=Dom, 6=Sab
  if (dow === 0 || dow === 6) return false;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return !CO_HOLIDAYS.has(iso);
}

function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) added += 1;
  }
  return d;
}

function uniqueEmails(...emails: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const v = (e ?? '').trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function fmtDeadline(d: Date): string {
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

type CierrePanelProps = { apiBase: string };

type CourseItem = {
  id: string;
  nrc: string;
  period: { code: string; label?: string | null };
  moment: string;
  programCode?: string | null;
  programName?: string | null;
  subjectName?: string | null;
  teacherId?: string | null;
  teacher?: {
    id: string;
    fullName: string;
    email?: string | null;
    email2?: string | null;
    coordination?: string | null;
    campus?: string | null;
  } | null;
  evaluationSummary?: {
    alistamientoScore: number | null;
    ejecucionScore: number | null;
  } | null;
  reviewExcluded?: boolean;
  reviewExcludedReason?: string | null;
};

type ReportEntry = {
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  teacherEmail2: string;
  coordination: string;
  campus: string;
  courses: CourseItem[];
  totalScore: number | null;
  alistamiento: number | null;
  ejecucion: number | null;
};

type Band = { label: string; color: string; bg: string; border: string; emoji: string };

function getBand(score: number): Band {
  if (score >= 91) return { label: 'Excelente', color: '#166534', bg: '#dcfce7', border: '#86efac', emoji: '★' };
  if (score >= 80) return { label: 'Bueno', color: '#1e40af', bg: '#dbeafe', border: '#93c5fd', emoji: '▲' };
  if (score >= 70) return { label: 'Aceptable', color: '#92400e', bg: '#fef3c7', border: '#fcd34d', emoji: '●' };
  return { label: 'Insatisfactorio', color: '#991b1b', bg: '#fee2e2', border: '#fca5a5', emoji: '▼' };
}

function fmt(v: number | null): string {
  if (v === null) return 'N/A';
  return v.toFixed(1);
}

function scoreBar(score: number): string {
  const band = getBand(score);
  const pct = Math.min(100, Math.max(0, score));
  return `
    <div style="margin:4px 0 0 0;">
      <div style="height:7px;background:#e5e7eb;border-radius:99px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${band.color};border-radius:99px;transition:width 0.3s;"></div>
      </div>
    </div>`;
}

function bandPill(score: number | null): string {
  if (score === null) return '<span style="color:#9ca3af;font-size:11px;">Sin dato</span>';
  const b = getBand(score);
  return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${b.bg};color:${b.color};border:1px solid ${b.border};font-size:11px;font-weight:700;">${b.emoji} ${b.label}</span>`;
}

const BASE_CSS = `
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#edf3fb;font-family:'Segoe UI',Arial,sans-serif;color:#1f2937;padding:0;}
.shell{max-width:800px;margin:28px auto;background:#fff;border-radius:0;border:1px solid #d4d7dd;overflow:hidden;}
.top-strip{height:10px;background:#ffc300;}
.hero{background:#0057a4;color:#fff;padding:22px 28px;}
.hero h1{font-size:22px;font-weight:800;line-height:1.25;margin:0 0 4px 0;}
.hero .sub{color:#dde9ff;font-size:12px;line-height:1.5;}
.pill{display:inline-block;margin-top:10px;background:#ffd000;color:#002b5c;font-size:11px;font-weight:900;letter-spacing:0.3px;padding:4px 12px;border-radius:999px;text-transform:uppercase;}
.body{padding:22px 28px;font-size:13px;line-height:1.65;}
.section-title{font-size:12px;font-weight:800;color:#0057a4;letter-spacing:0.3px;text-transform:uppercase;margin:18px 0 8px 0;padding-bottom:4px;border-bottom:2px solid #e5e7eb;}
.kpi-row{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 16px 0;}
.kpi{flex:1 1 140px;background:#f8fafc;border:1px solid #d4d7dd;border-radius:12px;padding:10px 14px;}
.kpi.green{background:#dcfce7;border-color:#86efac;}
.kpi.blue{background:#dbeafe;border-color:#93c5fd;}
.kpi.yellow{background:#fef3c7;border-color:#fcd34d;}
.kpi.red{background:#fee2e2;border-color:#fca5a5;}
.kpi-label{font-size:10px;text-transform:uppercase;letter-spacing:0.35px;color:#5c6c82;}
.kpi-value{font-size:24px;font-weight:800;color:#002b5c;line-height:1.2;}
.kpi-meta{font-size:11px;color:#5c6c82;}
table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0;}
thead tr{background:#002b5c;color:#fff;}
thead th{padding:8px 10px;text-align:left;font-weight:700;font-size:11px;letter-spacing:0.2px;}
tbody tr:nth-child(even){background:#f8fafc;}
tbody tr:hover{background:#eef5ff;}
td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:middle;}
.info-box{background:#f0f7ff;border:1px solid #cfe0f5;border-left:4px solid #0057a4;border-radius:10px;padding:10px 14px;font-size:12px;color:#1e3a5f;margin:10px 0;}
.footer{background:#f8fafc;border-top:1px solid #e5e7eb;padding:14px 28px;font-size:11px;color:#6b7280;text-align:center;}
@media print{body{background:#fff;}.shell{box-shadow:none;border:none;margin:0;border-radius:0;}}
</style>`;

// ──────────────────────────────────────────────────────────────────────────────
// REPORTE DOCENTE
// ──────────────────────────────────────────────────────────────────────────────
function buildTeacherReport(entry: ReportEntry, period: string, moment: string, generatedAt: string): string {
  const total = entry.totalScore;
  const band = total !== null ? getBand(total) : null;
  const coursesWithData = entry.courses.filter(c => c.evaluationSummary?.alistamientoScore !== null || c.evaluationSummary?.ejecucionScore !== null);

  const rows = entry.courses.map(c => {
    const al = c.evaluationSummary?.alistamientoScore ?? null;
    const ej = c.evaluationSummary?.ejecucionScore ?? null;
    const tot = al !== null && ej !== null ? al + ej : al ?? ej;
    return `
      <tr>
        <td><strong>${c.nrc}</strong></td>
        <td>${c.subjectName ?? '-'}</td>
        <td>${c.programName ?? c.programCode ?? '-'}</td>
        <td style="text-align:center;">${fmt(al)} / 50</td>
        <td style="text-align:center;">${fmt(ej)} / 50</td>
        <td style="text-align:center;"><strong>${fmt(tot)} / 100</strong><br>${bandPill(tot)}</td>
      </tr>`;
  }).join('');

  const avgNote = coursesWithData.length > 1
    ? `<p style="margin-top:12px;font-size:12px;color:#374151;">Promedio calculado sobre <strong>${coursesWithData.length}</strong> aula(s) con evaluacion completa.</p>`
    : '';

  const deadlineLabel = fmtDeadline(addBusinessDays(new Date(), 2));

  const comunicadoButton = `<div style="text-align:center;margin:18px 0;">
    <a href="https://comunicado2026.netlify.app/" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(30,64,175,0.3);">
      📋 Ver comunicado oficial — Items, guias y criterios de revision
    </a>
    <div style="margin-top:6px;font-size:11px;color:#6b7280;">comunicado2026.netlify.app · Porque de las aulas, items revisados y guias paso a paso</div>
  </div>`;

  const congratsOrAction = band?.label === 'Excelente' || band?.label === 'Bueno'
    ? `<div class="info-box" style="background:#f0fdf4;border-color:#86efac;border-left-color:#16a34a;">
        <strong>Felicitaciones.</strong> Su desempeno en este momento refleja un compromiso destacado con la calidad del aula virtual. Le invitamos a continuar con estas buenas practicas.
      </div>
      <div class="info-box" style="background:#fef2f2;border-color:#fca5a5;border-left-color:#dc2626;margin-top:10px;">
        <strong>Plazo para subsanaciones:</strong> A partir del envio de este correo cuenta con <strong>dos (2) dias habiles</strong> (sin contar sabados, domingos ni festivos) para realizar las subsanaciones que considere pertinentes. Fecha limite: <strong>${deadlineLabel}</strong>. Pasado este plazo no se aceptaran modificaciones a la evaluacion.
      </div>`
    : `<div class="info-box" style="background:#fff7ed;border-color:#fdba74;border-left-color:#ea580c;">
        <strong>Oportunidad de mejora.</strong> Le invitamos a revisar los items pendientes en cada aula y gestionar su actualizacion.
      </div>
      <div class="info-box" style="background:#fef2f2;border-color:#fca5a5;border-left-color:#dc2626;margin-top:10px;">
        <strong>Plazo para subsanaciones:</strong> A partir del envio de este correo cuenta con <strong>dos (2) dias habiles</strong> (sin contar sabados, domingos ni festivos) para realizar las subsanaciones correspondientes en sus aulas virtuales. Fecha limite: <strong>${deadlineLabel}</strong>. Pasado este plazo no se aceptaran modificaciones a la evaluacion.
      </div>`;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe Cierre Momento ${moment} - ${entry.teacherName}</title>${BASE_CSS}</head><body>
  <div class="shell">
    <div class="top-strip"></div>
    <div class="hero">
      <h1>Informe de Cierre &mdash; Momento ${moment}</h1>
      <div class="sub">Corporacion Universitaria Minuto de Dios &mdash; UNIMINUTO<br>Sistema de Seguimiento de Aulas Virtuales</div>
      <span class="pill">Periodo ${period} &middot; Momento ${moment}</span>
    </div>
    <div class="body">
      <div class="section-title">Informacion del Docente</div>
      <table style="margin-bottom:12px;">
        <tbody>
          <tr><td style="width:150px;color:#5c6c82;font-weight:600;">Nombre</td><td><strong>${entry.teacherName}</strong></td></tr>
          <tr><td style="color:#5c6c82;font-weight:600;">Correo</td><td>${entry.teacherEmail || '-'}</td></tr>
          <tr><td style="color:#5c6c82;font-weight:600;">Coordinacion</td><td>${entry.coordination || '-'}</td></tr>
          <tr><td style="color:#5c6c82;font-weight:600;">Campus</td><td>${entry.campus || '-'}</td></tr>
        </tbody>
      </table>

      <div class="section-title">Resultado Global</div>
      <div class="kpi-row">
        <div class="kpi ${band?.label === 'Excelente' ? 'green' : band?.label === 'Bueno' ? 'blue' : band?.label === 'Aceptable' ? 'yellow' : 'red'}">
          <div class="kpi-label">Puntaje Total</div>
          <div class="kpi-value">${fmt(total)}</div>
          <div class="kpi-meta">de 100 puntos</div>
          ${total !== null ? scoreBar(total) : ''}
        </div>
        <div class="kpi blue">
          <div class="kpi-label">Alistamiento</div>
          <div class="kpi-value">${fmt(entry.alistamiento)}</div>
          <div class="kpi-meta">de 50 puntos</div>
        </div>
        <div class="kpi blue">
          <div class="kpi-label">Ejecucion</div>
          <div class="kpi-value">${fmt(entry.ejecucion)}</div>
          <div class="kpi-meta">de 50 puntos</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">NRC evaluados</div>
          <div class="kpi-value">${entry.courses.length}</div>
          <div class="kpi-meta">aulas revisadas</div>
        </div>
      </div>
      ${band ? `<div style="text-align:center;margin:8px 0 16px 0;">${bandPill(total)}</div>` : ''}
      ${congratsOrAction}
      ${comunicadoButton}

      <div class="section-title">Detalle por Aula</div>
      <table>
        <thead><tr><th>NRC</th><th>Asignatura</th><th>Programa</th><th style="text-align:center;">Alistamiento</th><th style="text-align:center;">Ejecucion</th><th style="text-align:center;">Total</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;">Sin aulas registradas para este periodo y momento.</td></tr>'}</tbody>
      </table>
      ${avgNote}

      <div class="info-box" style="margin-top:16px;">
        Este informe fue generado automaticamente por el sistema de seguimiento de aulas virtuales de UNIMINUTO. Los puntajes corresponden a la evaluacion de los criterios de calidad del campus virtual para el <strong>Momento ${moment}, Periodo ${period}</strong>.
      </div>
    </div>
    <div class="footer">UNIMINUTO &mdash; Sistema de Seguimiento de Aulas Virtuales &middot; Generado: ${generatedAt}</div>
  </div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// REPORTE COORDINACION
// ──────────────────────────────────────────────────────────────────────────────
function buildCoordinatorReport(
  coordination: string,
  entries: ReportEntry[],
  period: string,
  moment: string,
  generatedAt: string,
): string {
  const withScore = entries.filter(e => e.totalScore !== null);
  const avg = withScore.length ? withScore.reduce((s, e) => s + (e.totalScore ?? 0), 0) / withScore.length : null;
  const excelente = withScore.filter(e => (e.totalScore ?? 0) >= 91).length;
  const bueno = withScore.filter(e => { const s = e.totalScore ?? 0; return s >= 80 && s < 91; }).length;
  const aceptable = withScore.filter(e => { const s = e.totalScore ?? 0; return s >= 70 && s < 80; }).length;
  const insatisfactorio = withScore.filter(e => (e.totalScore ?? 0) < 70).length;
  const totalNrc = entries.reduce((s, e) => s + e.courses.length, 0);

  const rows = entries.sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1)).map(e => `
    <tr>
      <td><strong>${e.teacherName}</strong><br><span style="font-size:11px;color:#6b7280;">${e.teacherEmail || '-'}</span></td>
      <td style="text-align:center;">${e.courses.length}</td>
      <td style="text-align:center;">${fmt(e.alistamiento)}</td>
      <td style="text-align:center;">${fmt(e.ejecucion)}</td>
      <td style="text-align:center;"><strong>${fmt(e.totalScore)}</strong></td>
      <td style="text-align:center;">${bandPill(e.totalScore)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe Coordinacion ${coordination} - Momento ${moment}</title>${BASE_CSS}</head><body>
  <div class="shell">
    <div class="top-strip"></div>
    <div class="hero">
      <h1>Informe de Coordinacion &mdash; Momento ${moment}</h1>
      <div class="sub">Corporacion Universitaria Minuto de Dios &mdash; UNIMINUTO<br>Sistema de Seguimiento de Aulas Virtuales</div>
      <span class="pill">Periodo ${period} &middot; ${coordination}</span>
    </div>
    <div class="body">
      <div class="section-title">Resumen Ejecutivo</div>
      <div class="kpi-row">
        <div class="kpi blue">
          <div class="kpi-label">Docentes evaluados</div>
          <div class="kpi-value">${entries.length}</div>
          <div class="kpi-meta">${totalNrc} NRC en total</div>
        </div>
        <div class="kpi ${avg !== null && avg >= 80 ? 'green' : avg !== null && avg >= 70 ? 'yellow' : 'red'}">
          <div class="kpi-label">Promedio coordinacion</div>
          <div class="kpi-value">${fmt(avg)}</div>
          <div class="kpi-meta">de 100 puntos</div>
          ${avg !== null ? scoreBar(avg) : ''}
        </div>
        <div class="kpi green"><div class="kpi-label">Excelente (91-100)</div><div class="kpi-value">${excelente}</div><div class="kpi-meta">${withScore.length ? Math.round(excelente / withScore.length * 100) : 0}%</div></div>
        <div class="kpi blue"><div class="kpi-label">Bueno (80-90)</div><div class="kpi-value">${bueno}</div><div class="kpi-meta">${withScore.length ? Math.round(bueno / withScore.length * 100) : 0}%</div></div>
        <div class="kpi yellow"><div class="kpi-label">Aceptable (70-79)</div><div class="kpi-value">${aceptable}</div><div class="kpi-meta">${withScore.length ? Math.round(aceptable / withScore.length * 100) : 0}%</div></div>
        <div class="kpi red"><div class="kpi-label">Insatisfactorio (0-69)</div><div class="kpi-value">${insatisfactorio}</div><div class="kpi-meta">${withScore.length ? Math.round(insatisfactorio / withScore.length * 100) : 0}%</div></div>
      </div>

      <div class="section-title">Tabla de Docentes</div>
      <table>
        <thead><tr><th>Docente</th><th style="text-align:center;">NRC</th><th style="text-align:center;">Alistamiento</th><th style="text-align:center;">Ejecucion</th><th style="text-align:center;">Total</th><th style="text-align:center;">Banda</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;">Sin docentes registrados.</td></tr>'}</tbody>
      </table>

      ${insatisfactorio > 0 ? `
      <div class="info-box" style="background:#fff7ed;border-color:#fdba74;border-left-color:#ea580c;margin-top:16px;">
        <strong>Atencion:</strong> ${insatisfactorio} docente(s) obtuvieron calificacion Insatisfactoria (&lt;70 puntos). Se recomienda contacto directo y acompanamiento antes del siguiente momento.
      </div>` : ''}

      <div class="info-box" style="margin-top:12px;">
        Informe generado automaticamente para la coordinacion <strong>${coordination}</strong>. Periodo <strong>${period}</strong>, Momento <strong>${moment}</strong>.
      </div>
    </div>
    <div class="footer">UNIMINUTO &mdash; Sistema de Seguimiento de Aulas Virtuales &middot; Generado: ${generatedAt}</div>
  </div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// REPORTE POR CENTRO UNIVERSITARIO
// ──────────────────────────────────────────────────────────────────────────────
function buildCenterReport(
  campus: string,
  campusName: string,
  directorName: string,
  entries: ReportEntry[],
  period: string,
  moment: string,
  generatedAt: string,
): string {
  const withScore = entries.filter(e => e.totalScore !== null);
  const avg = withScore.length ? withScore.reduce((s, e) => s + (e.totalScore ?? 0), 0) / withScore.length : null;
  const excelente = withScore.filter(e => (e.totalScore ?? 0) >= 91).length;
  const bueno = withScore.filter(e => { const s = e.totalScore ?? 0; return s >= 80 && s < 91; }).length;
  const aceptable = withScore.filter(e => { const s = e.totalScore ?? 0; return s >= 70 && s < 80; }).length;
  const insatisfactorio = withScore.filter(e => (e.totalScore ?? 0) < 70).length;
  const totalNrc = entries.reduce((s, e) => s + e.courses.length, 0);

  const byCoord: Record<string, ReportEntry[]> = {};
  entries.forEach(e => {
    const k = e.coordination || 'Sin coordinacion';
    if (!byCoord[k]) byCoord[k] = [];
    byCoord[k].push(e);
  });

  const rows = entries.sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1)).map(e => `
    <tr>
      <td><strong>${e.teacherName}</strong><br><span style="font-size:11px;color:#6b7280;">${e.teacherEmail || '-'}</span></td>
      <td style="font-size:11px;">${e.coordination || '-'}</td>
      <td style="text-align:center;">${e.courses.length}</td>
      <td style="text-align:center;">${fmt(e.alistamiento)}</td>
      <td style="text-align:center;">${fmt(e.ejecucion)}</td>
      <td style="text-align:center;"><strong>${fmt(e.totalScore)}</strong></td>
      <td style="text-align:center;">${bandPill(e.totalScore)}</td>
    </tr>`).join('');

  const centerLabel = campusName ? `${campusName} (${campus})` : campus;
  const greeting = directorName
    ? `Estimado(a) Director(a) <strong>${directorName}</strong>,<br><br>`
    : '';

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe Centro ${centerLabel} - Momento ${moment}</title>${BASE_CSS}</head><body>
  <div class="shell">
    <div class="top-strip"></div>
    <div class="hero">
      <h1>Informe de Centro Universitario &mdash; Momento ${moment}</h1>
      <div class="sub">Corporacion Universitaria Minuto de Dios &mdash; UNIMINUTO<br>Sistema de Seguimiento de Aulas Virtuales</div>
      <span class="pill">Periodo ${period} &middot; ${centerLabel}</span>
    </div>
    <div class="body">
      <div class="info-box">
        ${greeting}A continuacion se presenta el resumen consolidado de la evaluacion del campus virtual de los docentes adscritos al centro <strong>${centerLabel}</strong> para el <strong>Momento ${moment}, Periodo ${period}</strong>.
      </div>

      <div class="section-title">Resumen del Centro</div>
      <div class="kpi-row">
        <div class="kpi blue">
          <div class="kpi-label">Docentes evaluados</div>
          <div class="kpi-value">${entries.length}</div>
          <div class="kpi-meta">${totalNrc} NRC en total</div>
        </div>
        <div class="kpi ${avg !== null && avg >= 80 ? 'green' : avg !== null && avg >= 70 ? 'yellow' : 'red'}">
          <div class="kpi-label">Promedio del centro</div>
          <div class="kpi-value">${fmt(avg)}</div>
          <div class="kpi-meta">de 100 puntos</div>
          ${avg !== null ? scoreBar(avg) : ''}
        </div>
        <div class="kpi"><div class="kpi-label">Coordinaciones</div><div class="kpi-value">${Object.keys(byCoord).length}</div><div class="kpi-meta">activas</div></div>
        <div class="kpi green"><div class="kpi-label">Excelente</div><div class="kpi-value">${excelente}</div><div class="kpi-meta">${withScore.length ? Math.round(excelente / withScore.length * 100) : 0}%</div></div>
        <div class="kpi blue"><div class="kpi-label">Bueno</div><div class="kpi-value">${bueno}</div><div class="kpi-meta">${withScore.length ? Math.round(bueno / withScore.length * 100) : 0}%</div></div>
        <div class="kpi yellow"><div class="kpi-label">Aceptable</div><div class="kpi-value">${aceptable}</div><div class="kpi-meta">${withScore.length ? Math.round(aceptable / withScore.length * 100) : 0}%</div></div>
        <div class="kpi red"><div class="kpi-label">Insatisfactorio</div><div class="kpi-value">${insatisfactorio}</div><div class="kpi-meta">${withScore.length ? Math.round(insatisfactorio / withScore.length * 100) : 0}%</div></div>
      </div>

      <div class="section-title">Docentes del Centro</div>
      <table>
        <thead><tr><th>Docente</th><th>Coordinacion</th><th style="text-align:center;">NRC</th><th style="text-align:center;">Alistamiento</th><th style="text-align:center;">Ejecucion</th><th style="text-align:center;">Total</th><th style="text-align:center;">Banda</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;">Sin docentes registrados.</td></tr>'}</tbody>
      </table>

      ${insatisfactorio > 0 ? `
      <div class="info-box" style="background:#fff7ed;border-color:#fdba74;border-left-color:#ea580c;margin-top:16px;">
        <strong>Atencion:</strong> ${insatisfactorio} docente(s) del centro obtuvieron calificacion Insatisfactoria (&lt;70 puntos). Se recomienda contacto directo y acompanamiento antes del siguiente momento.
      </div>` : ''}

      <div class="info-box" style="margin-top:12px;">
        Informe generado automaticamente para el centro <strong>${centerLabel}</strong>. Periodo <strong>${period}</strong>, Momento <strong>${moment}</strong>.
      </div>
    </div>
    <div class="footer">UNIMINUTO &mdash; Sistema de Seguimiento de Aulas Virtuales &middot; Generado: ${generatedAt}</div>
  </div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// REPORTE DIRECTIVOS
// ──────────────────────────────────────────────────────────────────────────────
function buildDirectivosReport(
  entries: ReportEntry[],
  period: string,
  moment: string,
  generatedAt: string,
  audience: string,
): string {
  const withScore = entries.filter(e => e.totalScore !== null);
  const avg = withScore.length ? withScore.reduce((s, e) => s + (e.totalScore ?? 0), 0) / withScore.length : null;
  const totalNrc = entries.reduce((s, e) => s + e.courses.length, 0);
  const excelente = withScore.filter(e => (e.totalScore ?? 0) >= 91).length;
  const bueno = withScore.filter(e => { const s = e.totalScore ?? 0; return s >= 80 && s < 91; }).length;
  const aceptable = withScore.filter(e => { const s = e.totalScore ?? 0; return s >= 70 && s < 80; }).length;
  const insatisfactorio = withScore.filter(e => (e.totalScore ?? 0) < 70).length;

  // Agrupar por coordinacion
  const byCoord: Record<string, ReportEntry[]> = {};
  entries.forEach(e => {
    const key = e.coordination || 'Sin coordinacion';
    if (!byCoord[key]) byCoord[key] = [];
    byCoord[key].push(e);
  });

  const coordRows = Object.entries(byCoord)
    .map(([coord, list]) => {
      const ws = list.filter(e => e.totalScore !== null);
      const avgC = ws.length ? ws.reduce((s, e) => s + (e.totalScore ?? 0), 0) / ws.length : null;
      const nrcC = list.reduce((s, e) => s + e.courses.length, 0);
      const excC = ws.filter(e => (e.totalScore ?? 0) >= 91).length;
      const insC = ws.filter(e => (e.totalScore ?? 0) < 70).length;
      return `<tr>
        <td><strong>${coord}</strong></td>
        <td style="text-align:center;">${list.length}</td>
        <td style="text-align:center;">${nrcC}</td>
        <td style="text-align:center;"><strong>${fmt(avgC)}</strong>${avgC !== null ? scoreBar(avgC) : ''}</td>
        <td style="text-align:center;">${bandPill(avgC)}</td>
        <td style="text-align:center;color:#166534;font-weight:700;">${excC}</td>
        <td style="text-align:center;color:#991b1b;font-weight:700;">${insC}</td>
      </tr>`;
    }).join('');

  // Agrupar por centro universitario (campus)
  const byCenter: Record<string, ReportEntry[]> = {};
  entries.forEach(e => {
    const key = e.campus || 'Sin centro';
    if (!byCenter[key]) byCenter[key] = [];
    byCenter[key].push(e);
  });

  const centerRows = Object.entries(byCenter)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([campus, list]) => {
      const ws = list.filter(e => e.totalScore !== null);
      const avgC = ws.length ? ws.reduce((s, e) => s + (e.totalScore ?? 0), 0) / ws.length : null;
      const nrcC = list.reduce((s, e) => s + e.courses.length, 0);
      const excC = ws.filter(e => (e.totalScore ?? 0) >= 91).length;
      const insC = ws.filter(e => (e.totalScore ?? 0) < 70).length;
      return `<tr>
        <td><strong>${campus}</strong></td>
        <td style="text-align:center;">${list.length}</td>
        <td style="text-align:center;">${nrcC}</td>
        <td style="text-align:center;"><strong>${fmt(avgC)}</strong>${avgC !== null ? scoreBar(avgC) : ''}</td>
        <td style="text-align:center;">${bandPill(avgC)}</td>
        <td style="text-align:center;color:#166534;font-weight:700;">${excC}</td>
        <td style="text-align:center;color:#991b1b;font-weight:700;">${insC}</td>
      </tr>`;
    }).join('');

  const pctExcelente = withScore.length ? Math.round(excelente / withScore.length * 100) : 0;
  const pctInsatisfactorio = withScore.length ? Math.round(insatisfactorio / withScore.length * 100) : 0;

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Informe Ejecutivo Cierre Momento ${moment} - ${audience}</title>${BASE_CSS}</head><body>
  <div class="shell">
    <div class="top-strip"></div>
    <div class="hero">
      <h1>Informe Ejecutivo de Cierre &mdash; Momento ${moment}</h1>
      <div class="sub">Corporacion Universitaria Minuto de Dios &mdash; UNIMINUTO<br>Direccion de Campus Virtual &mdash; ${audience}</div>
      <span class="pill">Periodo ${period} &middot; Momento ${moment}</span>
    </div>
    <div class="body">
      <div class="info-box">
        Este informe presenta los resultados consolidados de la evaluacion del campus virtual para el <strong>Momento ${moment}</strong> del periodo <strong>${period}</strong>. Los datos provienen del sistema automatico de seguimiento de aulas virtuales de UNIMINUTO.
      </div>

      <div class="section-title">Indicadores Globales</div>
      <div class="kpi-row">
        <div class="kpi blue"><div class="kpi-label">Total docentes</div><div class="kpi-value">${entries.length}</div><div class="kpi-meta">evaluados</div></div>
        <div class="kpi blue"><div class="kpi-label">Total NRC</div><div class="kpi-value">${totalNrc}</div><div class="kpi-meta">aulas revisadas</div></div>
        <div class="kpi ${avg !== null && avg >= 80 ? 'green' : avg !== null && avg >= 70 ? 'yellow' : 'red'}">
          <div class="kpi-label">Promedio institucional</div>
          <div class="kpi-value">${fmt(avg)}</div>
          <div class="kpi-meta">de 100 puntos</div>
          ${avg !== null ? scoreBar(avg) : ''}
        </div>
        <div class="kpi">
          <div class="kpi-label">Coordinaciones</div>
          <div class="kpi-value">${Object.keys(byCoord).length}</div>
          <div class="kpi-meta">activas</div>
        </div>
      </div>

      <div class="section-title">Distribucion por Banda de Calificacion</div>
      <div class="kpi-row">
        <div class="kpi green"><div class="kpi-label">★ Excelente (91-100)</div><div class="kpi-value">${excelente}</div><div class="kpi-meta">${pctExcelente}% del total</div>${scoreBar(pctExcelente)}</div>
        <div class="kpi blue"><div class="kpi-label">▲ Bueno (80-90)</div><div class="kpi-value">${bueno}</div><div class="kpi-meta">${withScore.length ? Math.round(bueno / withScore.length * 100) : 0}% del total</div></div>
        <div class="kpi yellow"><div class="kpi-label">● Aceptable (70-79)</div><div class="kpi-value">${aceptable}</div><div class="kpi-meta">${withScore.length ? Math.round(aceptable / withScore.length * 100) : 0}% del total</div></div>
        <div class="kpi red"><div class="kpi-label">▼ Insatisfactorio (0-69)</div><div class="kpi-value">${insatisfactorio}</div><div class="kpi-meta">${pctInsatisfactorio}% del total</div></div>
      </div>

      <div class="section-title">Resultados por Coordinacion</div>
      <table>
        <thead><tr><th>Coordinacion</th><th style="text-align:center;">Docentes</th><th style="text-align:center;">NRC</th><th style="text-align:center;">Promedio</th><th style="text-align:center;">Banda</th><th style="text-align:center;">Excelente</th><th style="text-align:center;">Insatisfactorio</th></tr></thead>
        <tbody>${coordRows || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;">Sin datos.</td></tr>'}</tbody>
      </table>

      <div class="section-title">Resultados por Centro Universitario</div>
      <table>
        <thead><tr><th>Centro</th><th style="text-align:center;">Docentes</th><th style="text-align:center;">NRC</th><th style="text-align:center;">Promedio</th><th style="text-align:center;">Banda</th><th style="text-align:center;">Excelente</th><th style="text-align:center;">Insatisfactorio</th></tr></thead>
        <tbody>${centerRows || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;">Sin datos.</td></tr>'}</tbody>
      </table>

      ${insatisfactorio > 0 ? `
      <div class="info-box" style="background:#fff7ed;border-color:#fdba74;border-left-color:#ea580c;margin-top:16px;">
        <strong>Atencion institucional:</strong> ${insatisfactorio} docente(s) (${pctInsatisfactorio}%) obtuvieron calificacion Insatisfactoria. Se recomienda activar protocolos de acompanamiento y seguimiento personalizado.
      </div>` : `
      <div class="info-box" style="background:#f0fdf4;border-color:#86efac;border-left-color:#16a34a;margin-top:16px;">
        <strong>Resultado positivo:</strong> El ${pctExcelente}% de los docentes alcanzo la categoria Excelente. No se registraron calificaciones Insatisfactorias en este momento.
      </div>`}

      <div class="info-box" style="margin-top:12px;">
        Informe generado automaticamente por el sistema de seguimiento de aulas virtuales. Dirigido a: <strong>${audience}</strong>. Periodo <strong>${period}</strong>, Momento <strong>${moment}</strong>.
      </div>
    </div>
    <div class="footer">UNIMINUTO &mdash; Sistema de Seguimiento de Aulas Virtuales &middot; Generado: ${generatedAt}</div>
  </div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// REPORTE CONVOCATORIA JORNADA — PARA COORDINADORES
// ──────────────────────────────────────────────────────────────────────────────
function buildConvocatoriaCoordReport(
  coord: string,
  teachers: ReportEntry[],
  period: string,
  moment: string,
  generatedAt: string,
): string {
  const sorted = [...teachers].sort((a, b) => (a.totalScore ?? 0) - (b.totalScore ?? 0));
  const rows = sorted.map(e => `
    <tr>
      <td><strong>${e.teacherName}</strong><br><span style="font-size:11px;color:#6b7280;">${e.teacherEmail || '—'}</span></td>
      <td style="text-align:center;color:#991b1b;font-weight:700;">${e.courses.length}</td>
      <td style="text-align:center;font-weight:700;color:#991b1b;">${fmt(e.alistamiento)} / 50</td>
      <td style="text-align:center;font-weight:700;color:#991b1b;">${fmt(e.ejecucion)} / 50</td>
      <td style="text-align:center;"><strong style="color:#991b1b;font-size:14px;">${fmt(e.totalScore)} / 100</strong></td>
      <td style="text-align:center;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;font-size:11px;font-weight:700;">&minus;${(70 - (e.totalScore ?? 0)).toFixed(1)} pts</span></td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Convocatoria Jornada Induccion — ${coord}</title>${BASE_CSS}
<style>
.hero-conv{background:#b45309;}
.top-strip-conv{height:10px;background:#dc2626;}
.pill-conv{display:inline-block;margin-top:10px;background:#fef08a;color:#7c2d12;font-size:11px;font-weight:900;letter-spacing:0.3px;padding:4px 12px;border-radius:999px;text-transform:uppercase;}
.conv-box{background:#fff7ed;border:1px solid #fdba74;border-left:4px solid #d97706;border-radius:10px;padding:16px 20px;margin:12px 0;}
.conv-detail{display:flex;gap:12px;align-items:flex-start;margin:8px 0;font-size:12.5px;}
.conv-icon{flex-shrink:0;width:26px;height:26px;border-radius:50%;background:#d97706;color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;}
.link-btn{display:inline-block;margin-top:8px;background:#d97706;color:#fff !important;padding:8px 18px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:0.2px;}
</style>
</head><body>
<div class="shell">
  <div class="top-strip-conv"></div>
  <div class="hero hero-conv">
    <h1>Convocatoria &mdash; Jornada de Induccion Campus Virtual</h1>
    <div class="sub">Corporacion Universitaria Minuto de Dios &mdash; UNIMINUTO<br>Direccion Academica &mdash; Seguimiento de Aulas Virtuales</div>
    <span class="pill-conv">Momento ${moment} &mdash; Periodo ${period}</span>
  </div>
  <div class="body">

    <div class="info-box" style="background:#fff1f2;border-color:#fca5a5;border-left-color:#dc2626;">
      Estimado(a) coordinador(a) de <strong>${coord}</strong>,<br><br>
      El presente comunicado es para informarle que los docentes de su coordinacion que se relacionan a continuacion obtuvieron una calificacion <strong style="color:#991b1b;">Insatisfactoria (inferior a 70 puntos)</strong> en la evaluacion del campus virtual correspondiente al <strong>Momento ${moment}, Periodo ${period}</strong>.<br><br>
      Por orden de la <strong>Direccion Academica</strong>, estos docentes estan <strong>convocados a participar obligatoriamente</strong> en la Jornada de Induccion de Campus Virtual que se describe a continuacion.
    </div>

    <div class="section-title">Detalles de la Jornada</div>
    <div class="conv-box">
      <div class="conv-detail">
        <div class="conv-icon">&#128197;</div>
        <div><strong>Dia:</strong> Viernes (proximo viernes habil)</div>
      </div>
      <div class="conv-detail">
        <div class="conv-icon">&#9200;</div>
        <div><strong>Horario:</strong> 7:30 a.m. &mdash; 10:45 a.m.</div>
      </div>
      <div class="conv-detail">
        <div class="conv-icon">&#128187;</div>
        <div><strong>Modalidad:</strong> Virtual &mdash; Microsoft Teams</div>
      </div>
      <div class="conv-detail">
        <div class="conv-icon">&#128279;</div>
        <div>
          <strong>Enlace del evento:</strong><br>
          <a class="link-btn" href="https://www.canva.com/design/DAHGds1f5IE/z5v3t-1KBSEtGiDzkRMLVg/view?utm_content=DAHGds1f5IE&amp;utm_campaign=designshare&amp;utm_medium=link2&amp;utm_source=uniquelinks&amp;utlId=hf73ab0fa08#2" target="_blank" rel="noopener noreferrer">
            Ver informacion del evento
          </a>
        </div>
      </div>
    </div>

    <div class="section-title">Docentes Convocados de su Coordinacion (${sorted.length})</div>
    <table>
      <thead>
        <tr>
          <th>Docente</th>
          <th style="text-align:center;">NRCs</th>
          <th style="text-align:center;">Alistamiento</th>
          <th style="text-align:center;">Ejecucion</th>
          <th style="text-align:center;">Total</th>
          <th style="text-align:center;">Deficit</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;">Sin docentes.</td></tr>'}</tbody>
    </table>

    <div class="section-title">Solicitud al Coordinador</div>
    <div class="info-box" style="background:#fffbeb;border-color:#fcd34d;border-left-color:#d97706;">
      Le solicitamos amablemente que:<br><br>
      <strong>1.</strong> Informe a los docentes convocados sobre esta jornada y verifique su asistencia.<br>
      <strong>2.</strong> Si alguno de los docentes presenta alguna novedad (incapacidad, inconveniente de horario, etc.) que le impida asistir, por favor comunicarlo oportunamente al equipo de Campus Virtual respondiendo a este correo o por el canal oficial de su coordinacion.<br><br>
      Su gestion como coordinador(a) es fundamental para garantizar la participacion y el mejoramiento continuo de la calidad del campus virtual en su programa.
    </div>

    <div class="info-box" style="margin-top:12px;">
      Comunicado generado automaticamente. Coordinacion: <strong>${coord}</strong> &mdash; Momento <strong>${moment}</strong> &mdash; Periodo <strong>${period}</strong> &mdash; ${sorted.length} docente(s) convocado(s).
    </div>
  </div>
  <div class="footer">UNIMINUTO &mdash; Direccion Academica &middot; Sistema de Seguimiento de Aulas Virtuales &middot; Generado: ${generatedAt}</div>
</div>
</body></html>`;
}

// REPORTE RESUMEN CONSOLIDADO — PARA SUBDIRECCIÓN / DIRECCIÓN
// ──────────────────────────────────────────────────────────────────────────────
function buildConvocatoriaResumenReport(
  coordGroups: Array<{ coord: string; teachers: ReportEntry[] }>,
  period: string,
  moment: string,
  generatedAt: string,
  recipientLabel = 'Subdirección / Dirección de Docencia',
): string {
  const totalTeachers = coordGroups.reduce((s, g) => s + g.teachers.length, 0);
  const coordSections = coordGroups.map(({ coord, teachers }) => {
    const sorted = [...teachers].sort((a, b) => (a.totalScore ?? 0) - (b.totalScore ?? 0));
    const rows = sorted.map(e => `
      <tr>
        <td><strong>${e.teacherName}</strong><br><span style="font-size:11px;color:#6b7280;">${e.teacherEmail || '—'}</span></td>
        <td style="text-align:center;">${e.courses.length}</td>
        <td style="text-align:center;color:#991b1b;font-weight:700;">${fmt(e.alistamiento)} / 50</td>
        <td style="text-align:center;color:#991b1b;font-weight:700;">${fmt(e.ejecucion)} / 50</td>
        <td style="text-align:center;"><strong style="color:#991b1b;">${fmt(e.totalScore)} / 100</strong></td>
        <td style="text-align:center;"><span style="display:inline-block;padding:1px 7px;border-radius:999px;background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;font-size:11px;font-weight:700;">&minus;${(70 - (e.totalScore ?? 0)).toFixed(1)} pts</span></td>
      </tr>`).join('');
    return `
      <div style="margin:18px 0 10px;padding:10px 14px;background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #d97706;border-radius:8px;">
        <strong style="color:#92400e;">${coord}</strong>
        <span style="margin-left:8px;background:#fee2e2;color:#991b1b;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;">${teachers.length} docente${teachers.length !== 1 ? 's' : ''} convocado${teachers.length !== 1 ? 's' : ''}</span>
      </div>
      <table>
        <thead><tr><th>Docente</th><th style="text-align:center;">NRCs</th><th style="text-align:center;">Alistamiento</th><th style="text-align:center;">Ejecucion</th><th style="text-align:center;">Total</th><th style="text-align:center;">Deficit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Resumen Convocatoria — ${period} M${moment}</title>${BASE_CSS}
<style>
.hero-conv{background:#b45309;}
.top-strip-conv{height:10px;background:#dc2626;}
.pill-conv{display:inline-block;margin-top:10px;background:#fef08a;color:#7c2d12;font-size:11px;font-weight:900;letter-spacing:0.3px;padding:4px 12px;border-radius:999px;text-transform:uppercase;}
.link-btn{display:inline-block;margin-top:8px;background:#d97706;color:#fff !important;padding:8px 18px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;}
</style>
</head><body>
<div class="shell">
  <div class="top-strip-conv"></div>
  <div class="hero hero-conv">
    <h1>Resumen Convocatoria &mdash; Jornada de Induccion Campus Virtual</h1>
    <div class="sub">Corporacion Universitaria Minuto de Dios &mdash; UNIMINUTO<br>Dirigido a: ${recipientLabel}</div>
    <span class="pill-conv">Momento ${moment} &mdash; Periodo ${period}</span>
  </div>
  <div class="body">

    <div class="info-box" style="background:#fff1f2;border-color:#fca5a5;border-left-color:#dc2626;">
      Estimado(a) <strong>${recipientLabel}</strong>,<br><br>
      El presente comunicado es un <strong>resumen consolidado</strong> de los docentes con calificacion <strong style="color:#991b1b;">Insatisfactoria (inferior a 70 puntos)</strong> en la evaluacion del campus virtual del <strong>Momento ${moment}, Periodo ${period}</strong>.<br><br>
      Por orden de la <strong>Direccion Academica</strong>, estos <strong>${totalTeachers} docente${totalTeachers !== 1 ? 's' : ''}</strong> han sido convocados a la Jornada de Induccion de Campus Virtual. Cada coordinador(a) de programa recibio una comunicacion individual con los detalles de sus docentes.
    </div>

    <div class="section-title">Detalles de la Jornada</div>
    <div class="kpi-row">
      <div class="kpi yellow"><div class="kpi-label">Dia</div><div class="kpi-value" style="font-size:18px;">Viernes</div><div class="kpi-meta">Proximo viernes habil</div></div>
      <div class="kpi yellow"><div class="kpi-label">Horario</div><div class="kpi-value" style="font-size:18px;">7:30</div><div class="kpi-meta">7:30 a.m. — 10:45 a.m.</div></div>
      <div class="kpi yellow"><div class="kpi-label">Modalidad</div><div class="kpi-value" style="font-size:18px;">Teams</div><div class="kpi-meta">Microsoft Teams</div></div>
      <div class="kpi red"><div class="kpi-label">Total convocados</div><div class="kpi-value">${totalTeachers}</div><div class="kpi-meta">${coordGroups.length} coordinacion${coordGroups.length !== 1 ? 'es' : ''}</div></div>
    </div>
    <div style="text-align:center;margin:10px 0 16px;">
      <a class="link-btn" href="https://www.canva.com/design/DAHGds1f5IE/z5v3t-1KBSEtGiDzkRMLVg/view?utm_content=DAHGds1f5IE&amp;utm_campaign=designshare&amp;utm_medium=link2&amp;utm_source=uniquelinks&amp;utlId=hf73ab0fa08#2" target="_blank" rel="noopener noreferrer">Ver informacion del evento</a>
    </div>

    <div class="section-title">Detalle por Coordinacion</div>
    ${coordSections}

    <div class="info-box" style="margin-top:16px;">
      Resumen generado automaticamente. ${coordGroups.length} coordinacion${coordGroups.length !== 1 ? 'es' : ''} &mdash; ${totalTeachers} docente${totalTeachers !== 1 ? 's' : ''} convocado${totalTeachers !== 1 ? 's' : ''} &mdash; Periodo <strong>${period}</strong>, Momento <strong>${moment}</strong>.
    </div>
  </div>
  <div class="footer">UNIMINUTO &mdash; Direccion Academica &middot; Sistema de Seguimiento de Aulas Virtuales &middot; Generado: ${generatedAt}</div>
</div>
</body></html>`;
}

// REPORTE PLAN DE MEJORA (INSATISFACTORIO)
// ──────────────────────────────────────────────────────────────────────────────
function buildInsatisfactorioReport(entry: ReportEntry, period: string, moment: string, generatedAt: string): string {
  const total = entry.totalScore ?? 0;
  const al = entry.alistamiento ?? 0;
  const ej = entry.ejecucion ?? 0;
  const alPct = Math.round((al / 50) * 100);
  const ejPct = Math.round((ej / 50) * 100);

  const defAl = al < 25;
  const defEj = ej < 25;

  const rows = entry.courses.map(c => {
    const cAl = c.evaluationSummary?.alistamientoScore ?? null;
    const cEj = c.evaluationSummary?.ejecucionScore ?? null;
    const cTot = cAl !== null && cEj !== null ? cAl + cEj : cAl ?? cEj;
    return `
      <tr>
        <td><strong>${c.nrc}</strong></td>
        <td>${c.subjectName ?? '-'}</td>
        <td style="text-align:center;">${fmt(cAl)} / 50</td>
        <td style="text-align:center;">${fmt(cEj)} / 50</td>
        <td style="text-align:center;"><strong style="color:#991b1b;">${fmt(cTot)} / 100</strong></td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Plan de Mejora Momento ${moment} - ${entry.teacherName}</title>${BASE_CSS}
<style>
.hero-alert{background:#b91c1c;}
.top-strip-alert{height:10px;background:#dc2626;}
.pill-alert{display:inline-block;margin-top:10px;background:#fef08a;color:#7c2d12;font-size:11px;font-weight:900;letter-spacing:0.3px;padding:4px 12px;border-radius:999px;text-transform:uppercase;}
.step{display:flex;gap:10px;align-items:flex-start;margin:6px 0;font-size:12px;}
.step-num{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#b91c1c;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;}
.meter-track{height:10px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin:3px 0;}
.meter-fill-ok{height:100%;background:#16a34a;border-radius:99px;}
.meter-fill-warn{height:100%;background:#d97706;border-radius:99px;}
.meter-fill-bad{height:100%;background:#dc2626;border-radius:99px;}
</style>
</head><body>
<div class="shell">
  <div class="top-strip-alert"></div>
  <div class="hero hero-alert">
    <h1>Notificacion: Plan de Mejora &mdash; Momento ${moment}</h1>
    <div class="sub">Corporacion Universitaria Minuto de Dios &mdash; UNIMINUTO<br>Sistema de Seguimiento de Aulas Virtuales &mdash; Resultado por debajo del nivel minimo</div>
    <span class="pill-alert">Resultado Insatisfactorio &mdash; Periodo ${period}</span>
  </div>
  <div class="body">

    <div class="info-box" style="background:#fff1f2;border-color:#fca5a5;border-left-color:#dc2626;">
      Estimado(a) <strong>${entry.teacherName}</strong>, el presente informe corresponde al resultado de la evaluacion del campus virtual para el <strong>Momento ${moment}, Periodo ${period}</strong>. Su puntaje obtenido fue de <strong style="color:#991b1b;">${fmt(total)} / 100 puntos</strong>, lo cual se encuentra por debajo del nivel minimo aceptable (70 puntos). Le invitamos a revisar este informe y tomar las acciones de mejora indicadas antes del proximo momento de evaluacion.
    </div>

    <div class="section-title">Resultado Obtenido</div>
    <div class="kpi-row">
      <div class="kpi red">
        <div class="kpi-label">Puntaje Total</div>
        <div class="kpi-value" style="color:#991b1b;">${fmt(total)}</div>
        <div class="kpi-meta">de 100 &mdash; minimo requerido: 70</div>
        <div class="meter-track"><div class="meter-fill-bad" style="width:${Math.min(100, total)}%;"></div></div>
      </div>
      <div class="kpi ${defAl ? 'red' : 'yellow'}">
        <div class="kpi-label">Alistamiento</div>
        <div class="kpi-value" style="color:${defAl ? '#991b1b' : '#92400e'};">${fmt(al)}</div>
        <div class="kpi-meta">de 50 &mdash; (${alPct}%)</div>
        <div class="meter-track"><div class="${defAl ? 'meter-fill-bad' : 'meter-fill-warn'}" style="width:${alPct}%;"></div></div>
      </div>
      <div class="kpi ${defEj ? 'red' : 'yellow'}">
        <div class="kpi-label">Ejecucion</div>
        <div class="kpi-value" style="color:${defEj ? '#991b1b' : '#92400e'};">${fmt(ej)}</div>
        <div class="kpi-meta">de 50 &mdash; (${ejPct}%)</div>
        <div class="meter-track"><div class="${defEj ? 'meter-fill-bad' : 'meter-fill-warn'}" style="width:${ejPct}%;"></div></div>
      </div>
      <div class="kpi">
        <div class="kpi-label">NRC evaluados</div>
        <div class="kpi-value">${entry.courses.length}</div>
        <div class="kpi-meta">aulas</div>
      </div>
    </div>

    <div class="section-title">Detalle por Aula</div>
    <table>
      <thead><tr><th>NRC</th><th>Asignatura</th><th style="text-align:center;">Alistamiento</th><th style="text-align:center;">Ejecucion</th><th style="text-align:center;">Total</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;">Sin aulas.</td></tr>'}</tbody>
    </table>

    <div class="info-box" style="background:#fef2f2;border-color:#fca5a5;border-left-color:#dc2626;margin-top:12px;">
      <strong>Plazo para subsanaciones:</strong> A partir del envio de este correo cuenta con <strong>dos (2) dias habiles</strong> (sin contar sabados, domingos ni festivos) para realizar las subsanaciones correspondientes en sus aulas virtuales. Fecha limite: <strong>${fmtDeadline(addBusinessDays(new Date(), 2))}</strong>. Pasado este plazo no se aceptaran modificaciones a la evaluacion.
    </div>

    <div style="text-align:center;margin:18px 0;">
      <a href="https://comunicado2026.netlify.app/" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(30,64,175,0.3);">
        📋 Ver comunicado oficial — Items, guias y criterios de revision
      </a>
      <div style="margin-top:6px;font-size:11px;color:#6b7280;">comunicado2026.netlify.app · Porque de las aulas, items revisados y guias paso a paso</div>
    </div>

    <div class="section-title">Plan de Mejora &mdash; Acciones Inmediatas</div>
    <div class="info-box" style="background:#fff7ed;border-color:#fdba74;border-left-color:#ea580c;">
      Para alcanzar el nivel minimo en el proximo momento de evaluacion, se recomienda ejecutar las siguientes acciones de manera prioritaria:
    </div>
    ${defAl ? `
    <p style="font-size:12px;font-weight:700;color:#7f1d1d;margin:12px 0 6px 0;">Alistamiento (resultado critico)</p>
    <div class="step"><div class="step-num">1</div><div>Verificar que el aula cuente con la estructura completa: presentacion del curso, cronograma, recursos de aprendizaje y evaluaciones configuradas.</div></div>
    <div class="step"><div class="step-num">2</div><div>Completar el perfil del docente en Moodle y asegurarse de que todos los bloques requeridos esten visibles para los estudiantes.</div></div>
    <div class="step"><div class="step-num">3</div><div>Solicitar acompanamiento al equipo de Campus Virtual para revision tecnica del aula antes del proximo momento.</div></div>
    ` : ''}
    ${defEj ? `
    <p style="font-size:12px;font-weight:700;color:#7f1d1d;margin:12px 0 6px 0;">Ejecucion (resultado critico)</p>
    <div class="step"><div class="step-num">${defAl ? '4' : '1'}</div><div>Publicar retroalimentacion de actividades y evaluaciones dentro de los tiempos establecidos en el cronograma.</div></div>
    <div class="step"><div class="step-num">${defAl ? '5' : '2'}</div><div>Mantener comunicacion activa con los estudiantes a traves de los foros y mensajes del aula.</div></div>
    <div class="step"><div class="step-num">${defAl ? '6' : '3'}</div><div>Registrar las calificaciones de todas las actividades evaluativas en el libro de calificaciones de Moodle.</div></div>
    ` : ''}
    ${!defAl && !defEj ? `
    <div class="step"><div class="step-num">1</div><div>Revisar los items de menor puntaje en ambas fases e implementar mejoras antes del proximo momento.</div></div>
    <div class="step"><div class="step-num">2</div><div>Contactar al equipo de Campus Virtual para orientacion especifica segun los criterios pendientes.</div></div>
    ` : ''}

    <div class="section-title">Soporte y Acompanamiento</div>
    <div class="info-box">
      Si tiene dudas sobre los criterios de evaluacion o requiere acompanamiento tecnico para mejorar su aula virtual, comuniquese con la <strong>Coordinacion de Campus Virtual</strong> o con su coordinador(a) de programa: <strong>${entry.coordination}</strong>.<br><br>
      El equipo de seguimiento de aulas virtuales esta disponible para brindarle orientacion y apoyo antes del proximo momento de evaluacion.
    </div>

    <div class="info-box" style="margin-top:12px;">
      Informe generado automaticamente. Docente: <strong>${entry.teacherName}</strong> &mdash; Coordinacion: <strong>${entry.coordination}</strong> &mdash; Periodo <strong>${period}</strong>, Momento <strong>${moment}</strong>.
    </div>
  </div>
  <div class="footer">UNIMINUTO &mdash; Sistema de Seguimiento de Aulas Virtuales &middot; Generado: ${generatedAt}</div>
</div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ──────────────────────────────────────────────────────────────────────────────
type Coordinator = { id: string; programId: string; programKey: string; fullName: string; email: string };
type CenterDirector = { id: string; campusCode: string; campusName: string | null; fullName: string; email: string; region: string | null };

type CierreQueueItem = {
  recipientName: string;
  recipientEmail: string | null;
  cc?: string;
  teacherId?: string;
  coordinatorId?: string;
  subject: string;
  htmlBody: string;
};

function normKey(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

/**
 * Busca el coordinador cuyo programId corresponde a la coordinacion.
 * La coordinacion viene como "Nombre Programa - Campus" y el programId
 * es solo "Nombre Programa", por lo que usamos startsWith con el
 * programId completo normalizado. El match más largo gana (más específico).
 */
function findCoordinator(coord: string, cs: Coordinator[]): Coordinator | undefined {
  const ck = normKey(coord);
  // 1. Coincidencia exacta
  const exact = cs.find(c => normKey(c.programId) === ck);
  if (exact) return exact;
  // 2. coord empieza con programId normalizado completo (ej. "administracionfinancieracentro" empieza con "administracionfinanciera")
  const starts = cs
    .filter(c => { const pk = normKey(c.programId); return pk.length >= 8 && ck.startsWith(pk); })
    .sort((a, b) => normKey(b.programId).length - normKey(a.programId).length); // el más largo gana
  if (starts.length) return starts[0];
  // 3. programId empieza con coord (coord más corto que programId)
  const rev = cs
    .filter(c => { const pk = normKey(c.programId); return pk.length >= 8 && pk.startsWith(ck); })
    .sort((a, b) => normKey(a.programId).length - normKey(b.programId).length);
  if (rev.length) return rev[0];
  return undefined;
}

export function CierrePanel({ apiBase }: CierrePanelProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [coordinators, setCoordinators] = useState<Coordinator[]>([]);
  const [centerDirectors, setCenterDirectors] = useState<CenterDirector[]>([]);
  const [sendingCenterId, setSendingCenterId] = useState<string | null>(null);
  const [period, setPeriod] = useState('');
  const [moment, setMoment] = useState('MD1');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [sendingDocentes, setSendingDocentes] = useState(false);
  const [sendingTeacherReport, setSendingTeacherReport] = useState<string | null>(null);
  const [sendingCoords, setSendingCoords] = useState(false);
  const [sendingCoordId, setSendingCoordId] = useState<string | null>(null);
  const [sendingDirectivos, setSendingDirectivos] = useState<string | null>(null);
  const [sendingInsatisfactorio, setSendingInsatisfactorio] = useState(false);
  const [sendingConvocatoria, setSendingConvocatoria] = useState(false);
  const [sendingConvocatoriaCoord, setSendingConvocatoriaCoord] = useState<string | null>(null);
  const [sendingTestConvocatoria, setSendingTestConvocatoria] = useState(false);
  const [testEmailConvocatoria, setTestEmailConvocatoria] = useState('');
  const [specificRecipientName, setSpecificRecipientName] = useState('');
  const [specificRecipientEmail, setSpecificRecipientEmail] = useState('');
  const [sendingSpecificRecipient, setSendingSpecificRecipient] = useState(false);
  const [extraConvocatoriaRecipients, setExtraConvocatoriaRecipients] = useState<Array<{ label: string; email: string }>>([
    { label: 'Subdirección de Docencia', email: '' },
    { label: 'Dirección de Docencia', email: '' },
  ]);
  const [excludedFromInsatisf, setExcludedFromInsatisf] = useState<Set<string>>(new Set());
  const [significantEventCutoffDate, setSignificantEventCutoffDate] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(`significant-event-cutoff-${moment}`);
      if (saved) return saved;
    } catch {}
    return new Date().toISOString().slice(0, 10);
  });
  const [extraDirectivosRecipients, setExtraDirectivosRecipients] = useState<Array<{ label: string; email: string }>>(() => {
    try {
      const saved = localStorage.getItem('directivos-extra-recipients');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [directivosEmails, setDirectivosEmails] = useState({
    subdireccion: '',
    direccion: '',
    vicerectoria: '',
  });
  const [sendResult, setSendResult] = useState('');
  const [uniqueStudentStats, setUniqueStudentStats] = useState<{ uniqueStudents: number; totalRows: number } | null>(null);
  const [rosterSyncing, setRosterSyncing] = useState(false);
  const [rosterMsg, setRosterMsg] = useState('');
  // Periodo para registrar correos en outbox (independiente del filtro period)
  const [outboxPeriodCode, setOutboxPeriodCode] = useState('');
  // Periodo a mostrar en reportes: usa outbox o filtro; nunca vacío si hay datos
  const displayPeriod = outboxPeriodCode.trim() || period.trim();

  // Persistir destinatarios extra de directivos en localStorage
  useEffect(() => {
    try { localStorage.setItem('directivos-extra-recipients', JSON.stringify(extraDirectivosRecipients)); } catch { /* noop */ }
  }, [extraDirectivosRecipients]);

  function resolveOutboxPeriodCode(): string | null {
    // Primero: campo dedicado para outbox
    if (outboxPeriodCode.trim().length >= 3) return outboxPeriodCode.trim();
    // Segundo: filtro de periodo si está configurado
    if (period.trim().length >= 3) return period.trim();
    // Último recurso: el más reciente de los cursos cargados
    const codes = [...new Set(courses.map(c => c.period?.code).filter(Boolean))] as string[];
    const latest = codes.sort().at(-1);
    return latest && latest.length >= 3 ? latest : null;
  }

  async function queueAndSend(audience: string, items: CierreQueueItem[]): Promise<{ sentCount: number; failedCount: number; skippedCount: number }> {
    const periodCode = resolveOutboxPeriodCode();
    if (!periodCode) throw new Error('Ingresa el codigo de periodo (ej: 202615) antes de enviar.');

    const BATCH = 20;
    let sentCount = 0, failedCount = 0, skippedCount = 0;

    for (let i = 0; i < items.length; i += BATCH) {
      const chunk = items.slice(i, i + BATCH);
      const queueRes = await fetchJson<{ ok: boolean; created: number; createdMessageIds: string[] }>(
        `${apiBase}/outbox/queue-cierre`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ periodCode, moment, audience, items: chunk }),
        },
      );
      if (!queueRes.createdMessageIds?.length) continue;

      const sendRes = await fetchJson<{ ok: boolean; sentCount: number; failedCount: number; skippedCount?: number }>(
        `${apiBase}/outbox/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: queueRes.createdMessageIds }),
        },
      );
      sentCount += sendRes.sentCount ?? 0;
      failedCount += sendRes.failedCount ?? 0;
      skippedCount += sendRes.skippedCount ?? 0;
    }

    return { sentCount, failedCount, skippedCount };
  }

  async function sendDocentesReports() {
    setSendingDocentes(true);
    setSendResult('');
    try {
      const items: CierreQueueItem[] = [];
      for (const e of entries) {
        const recipients = uniqueEmails(e.teacherEmail, e.teacherEmail2);
        if (!recipients.length) continue;
        const html = buildTeacherReport(e, displayPeriod, moment, generatedAt);
        for (const r of recipients) {
          items.push({
            recipientName: e.teacherName,
            recipientEmail: r,
            teacherId: e.teacherId,
            subject: `[UNIMINUTO] Informe de Cierre Momento ${moment} — Periodo ${period}`,
            htmlBody: html,
          });
        }
      }
      if (!items.length) { setSendResult('Sin docentes con correo registrado.'); return; }
      const result = await queueAndSend('DOCENTE', items);
      setSendResult(`Docentes: ${result.sentCount} correos enviados a ${entries.filter(e => uniqueEmails(e.teacherEmail, e.teacherEmail2).length > 0).length} docentes${result.failedCount ? `, ${result.failedCount} fallidos` : ''}.`);
    } catch (err) {
      setSendResult(`Error al enviar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingDocentes(false);
    }
  }

  async function sendCoordsReports() {
    setSendingCoords(true);
    setSendResult('');
    try {
      const items: CierreQueueItem[] = [];
      for (const coord of coordinations) {
        const list = entries.filter(e => e.coordination === coord);
        const coordKey = normKey(coord);
        const matched = findCoordinator(coord, coordinators);
        if (!matched?.email) continue;
        items.push({
          recipientName: matched.fullName,
          recipientEmail: matched.email,
          coordinatorId: matched.id,
          subject: `[UNIMINUTO] Informe Coordinacion ${coord} — Momento ${moment} — ${period}`,
          htmlBody: buildCoordinatorReport(coord, list, displayPeriod, moment, generatedAt),
        });
      }
      if (!items.length) { setSendResult('Sin coordinadores con correo registrado en el sistema.'); return; }
      const result = await queueAndSend('COORDINADOR', items);
      setSendResult(`Coordinaciones: ${result.sentCount} enviadas${result.failedCount ? `, ${result.failedCount} fallidas` : ''}.`);
    } catch (err) {
      setSendResult(`Error al enviar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingCoords(false);
    }
  }

  async function sendDirectivosReport(audience: string, email: string, label: string) {
    if (!email.trim()) { setSendResult('Ingresa un correo válido para ' + label); return; }
    setSendingDirectivos(audience);
    setSendResult('');
    try {
      const html = buildDirectivosReport(entries, displayPeriod, moment, generatedAt, label);
      const result = await queueAndSend('GLOBAL', [{
        recipientName: label,
        recipientEmail: email.trim(),
        subject: `[UNIMINUTO] Informe Ejecutivo Cierre Momento ${moment} — ${period} — ${label}`,
        htmlBody: html,
      }]);
      setSendResult(`${label}: ${result.sentCount > 0 ? 'enviado correctamente' : 'no enviado'}.`);
    } catch (err) {
      setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingDirectivos(null);
    }
  }

  async function sendCenterReport(director: CenterDirector) {
    if (!director.email?.trim()) { setSendResult('Director sin correo registrado.'); return; }
    const list = entriesByCenter.get(director.campusCode) ?? [];
    if (!list.length) { setSendResult(`Sin docentes para ${director.campusCode}.`); return; }
    setSendingCenterId(director.id);
    setSendResult('');
    try {
      const campusLabel = director.campusName ?? director.campusCode;
      const html = buildCenterReport(
        director.campusCode,
        director.campusName ?? '',
        director.fullName,
        list,
        displayPeriod,
        moment,
        generatedAt,
      );
      const result = await queueAndSend('GLOBAL', [{
        recipientName: director.fullName,
        recipientEmail: director.email.trim(),
        subject: `[UNIMINUTO] Informe Centro ${campusLabel} — Momento ${moment} — ${period}`,
        htmlBody: html,
      }]);
      setSendResult(`Centro ${campusLabel}: ${result.sentCount > 0 ? 'enviado' : 'no enviado'}.`);
    } catch (err) {
      setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingCenterId(null);
    }
  }

  async function sendAllCenterReports() {
    if (!centerDirectors.length) { setSendResult('Sin directores registrados.'); return; }
    setSendResult('');
    let sent = 0;
    for (const d of centerDirectors) {
      const list = entriesByCenter.get(d.campusCode) ?? [];
      if (!list.length || !d.email?.trim()) continue;
      try {
        const html = buildCenterReport(d.campusCode, d.campusName ?? '', d.fullName, list, displayPeriod, moment, generatedAt);
        const result = await queueAndSend('GLOBAL', [{
          recipientName: d.fullName,
          recipientEmail: d.email.trim(),
          subject: `[UNIMINUTO] Informe Centro ${d.campusName ?? d.campusCode} — Momento ${moment} — ${period}`,
          htmlBody: html,
        }]);
        if (result.sentCount > 0) sent += 1;
      } catch {
        // continua con el siguiente
      }
    }
    setSendResult(`Centros: ${sent} reporte(s) enviado(s) de ${centerDirectors.length} director(es).`);
  }

  async function sendInsatisfactorioReports() {
    setSendingInsatisfactorio(true);
    setSendResult('');
    try {
      const targets = entries.filter(e => e.totalScore !== null && e.totalScore < 70 && uniqueEmails(e.teacherEmail, e.teacherEmail2).length > 0);
      if (!targets.length) { setSendResult('Sin docentes insatisfactorios con correo registrado.'); return; }
      const items: CierreQueueItem[] = [];
      for (const e of targets) {
        const recipients = uniqueEmails(e.teacherEmail, e.teacherEmail2);
        const html = buildInsatisfactorioReport(e, displayPeriod, moment, generatedAt);
        for (const r of recipients) {
          items.push({
            recipientName: e.teacherName,
            recipientEmail: r,
            teacherId: e.teacherId,
            subject: `[UNIMINUTO] Plan de Mejora — Campus Virtual Momento ${moment} — ${period}`,
            htmlBody: html,
          });
        }
      }
      const result = await queueAndSend('DOCENTE', items);
      setSendResult(`Plan de mejora: ${result.sentCount} correos enviados a ${targets.length} docentes${result.failedCount ? `, ${result.failedCount} fallidos` : ''}.`);
    } catch (err) {
      setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingInsatisfactorio(false);
    }
  }

  function buildConvocatoriaGroups(activeInsatisfactorios: ReportEntry[]) {
    const byCoord = new Map<string, ReportEntry[]>();
    for (const e of activeInsatisfactorios) {
      const coord = e.coordination || 'Sin coordinacion';
      if (!byCoord.has(coord)) byCoord.set(coord, []);
      byCoord.get(coord)!.push(e);
    }
    return byCoord;
  }

  async function sendConvocatoriaToCoords() {
    if (!moment.trim()) { setSendResult('Ingresa el momento primero (ej: MD1).'); return; }
    setSendingConvocatoria(true);
    setSendResult('');
    try {
      const activeInsatisfactorios = entries.filter(e => e.totalScore !== null && e.totalScore < 70 && !excludedFromInsatisf.has(e.teacherId));
      if (!activeInsatisfactorios.length) { setSendResult('Sin docentes insatisfactorios activos para convocar.'); return; }

      const byCoord = buildConvocatoriaGroups(activeInsatisfactorios);
      const coordGroups = [...byCoord.entries()].map(([coord, teachers]) => ({ coord, teachers }));

      const items: CierreQueueItem[] = [];

      // Correos CC: todos los destinatarios adicionales con email
      const ccEmails = extraConvocatoriaRecipients
        .map(r => r.email.trim())
        .filter(Boolean)
        .join(', ');

      // Un correo por coordinador (con CC a directivos)
      for (const { coord, teachers } of coordGroups) {
        const matched = findCoordinator(coord, coordinators);
        if (!matched?.email) continue;
        items.push({
          recipientName: matched.fullName,
          recipientEmail: matched.email,
          cc: ccEmails || undefined,
          coordinatorId: matched.id,
          subject: `[UNIMINUTO] Convocatoria Jornada Induccion Campus Virtual — Momento ${moment} — ${period}`,
          htmlBody: buildConvocatoriaCoordReport(coord, teachers, displayPeriod, moment, generatedAt),
        });
      }

      // Destinatarios adicionales reciben el resumen consolidado
      for (const extra of extraConvocatoriaRecipients) {
        if (!extra.email.trim()) continue;
        items.push({
          recipientName: extra.label,
          recipientEmail: extra.email.trim(),
          subject: `[UNIMINUTO] Resumen Convocatoria Jornada Induccion — Momento ${moment} — ${period}`,
          htmlBody: buildConvocatoriaResumenReport(coordGroups, displayPeriod, moment, generatedAt, extra.label),
        });
      }

      if (!items.length) { setSendResult('Sin destinatarios con correo registrado para enviar.'); return; }
      const result = await queueAndSend('COORDINADOR', items);
      setSendResult(`Convocatoria: ${result.sentCount} correo(s) enviado(s)${result.failedCount ? `, ${result.failedCount} fallidos` : ''}.`);
    } catch (err) {
      setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingConvocatoria(false);
    }
  }

  async function sendTestConvocatoria() {
    const email = testEmailConvocatoria.trim();
    if (!email) { setSendResult('Ingresa un correo de prueba.'); return; }
    if (!moment.trim()) { setSendResult('Ingresa el momento primero (ej: MD1).'); return; }
    setSendingTestConvocatoria(true);
    setSendResult('');
    try {
      const activeInsatisfactorios = entries.filter(e => e.totalScore !== null && e.totalScore < 70 && !excludedFromInsatisf.has(e.teacherId));
      if (!activeInsatisfactorios.length) { setSendResult('Sin datos cargados. Genera el reporte primero con el periodo y momento correctos.'); return; }
      const byCoord = buildConvocatoriaGroups(activeInsatisfactorios);
      const coordGroups = [...byCoord.entries()].map(([coord, teachers]) => ({ coord, teachers }));
      // Enviar el resumen consolidado como prueba
      const result = await queueAndSend('COORDINADOR', [{
        recipientName: `[PRUEBA] ${email}`,
        recipientEmail: email,
        subject: `[PRUEBA] Convocatoria Jornada Induccion — Momento ${moment} — ${period}`,
        htmlBody: buildConvocatoriaResumenReport(coordGroups, displayPeriod, moment, generatedAt, `[PRUEBA] ${email}`),
      }]);
      setSendResult(`Prueba enviada a ${email}: ${result.sentCount > 0 ? 'OK' : 'no enviado'}.`);
    } catch (err) {
      setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingTestConvocatoria(false);
    }
  }

  async function sendResumenToSpecific() {
    const email = specificRecipientEmail.trim();
    const name = specificRecipientName.trim() || email;
    if (!email) { setSendResult('Ingresa el correo del destinatario.'); return; }
    if (!moment.trim()) { setSendResult('Selecciona el momento primero.'); return; }
    setSendingSpecificRecipient(true);
    setSendResult('');
    try {
      const activeInsatisfactorios = entries.filter(e => e.totalScore !== null && e.totalScore < 70 && !excludedFromInsatisf.has(e.teacherId));
      if (!activeInsatisfactorios.length) { setSendResult('Sin datos cargados. Genera el reporte primero.'); return; }
      const byCoord = buildConvocatoriaGroups(activeInsatisfactorios);
      const coordGroups = [...byCoord.entries()].map(([coord, teachers]) => ({ coord, teachers }));
      const result = await queueAndSend('GLOBAL', [{
        recipientName: name,
        recipientEmail: email,
        subject: `[UNIMINUTO] Resumen Insatisfactorios Jornada Induccion — Momento ${moment} — ${displayPeriod}`,
        htmlBody: buildConvocatoriaResumenReport(coordGroups, displayPeriod, moment, generatedAt, name),
      }]);
      setSendResult(`Resumen enviado a ${name} (${email}): ${result.sentCount > 0 ? 'OK' : 'no enviado'}.`);
    } catch (err) {
      setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingSpecificRecipient(false);
    }
  }

  async function loadUniqueStudents() {
    if (!period.trim()) { setRosterMsg('Ingresa un periodo primero (ej: 202615).'); return; }
    setRosterMsg('');
    try {
      const res = await fetchJson<{ uniqueStudents: number; totalRows: number }>(
        `${apiBase}/integrations/banner-people/unique-students?periodCode=${period.trim()}`
      );
      setUniqueStudentStats(res);
    } catch (err) {
      setRosterMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function runRosterSync() {
    if (!period.trim()) { setRosterMsg('Ingresa un periodo primero.'); return; }
    if (!window.confirm(`¿Sincronizar matrícula SFAALST para el periodo ${period.trim()}?\n\nEsto consultará Banner NRC por NRC. Puede tardar varias horas para periodos grandes.`)) return;
    setRosterSyncing(true);
    setRosterMsg('Sincronizando... (esto puede tardar varios minutos u horas según la cantidad de NRCs)');
    try {
      const res = await fetchJson<{
        ok: boolean;
        uniqueStudents: number;
        totalRows: number;
        roster: { nrcsQueried: number; totalStudentRows: number; foundCourses: number; emptyCourses: number; failedCourses: number };
      }>(`${apiBase}/integrations/banner-people/roster-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodCode: period.trim() }),
      });
      setUniqueStudentStats({ uniqueStudents: res.uniqueStudents, totalRows: res.totalRows });
      setRosterMsg(`Completado: ${res.roster.nrcsQueried} NRCs consultados, ${res.roster.foundCourses} con estudiantes, ${res.roster.failedCourses} con error. ${res.uniqueStudents.toLocaleString()} estudiantes únicos importados.`);
    } catch (err) {
      setRosterMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRosterSyncing(false);
    }
  }

  async function loadData() {
    try {
      setLoading(true);
      setMessage('');
      const [data, coordData, dirData] = await Promise.all([
        fetchJson<{ items: CourseItem[] }>(`${apiBase}/courses?limit=5000`),
        fetchJson<{ items: Coordinator[] }>(`${apiBase}/coordinators?limit=500`).catch(() => ({ items: [] as Coordinator[] })),
        fetchJson<{ items: CenterDirector[] }>(`${apiBase}/center-directors?limit=500`).catch(() => ({ items: [] as CenterDirector[] })),
      ]);
      const items = data.items ?? [];
      setCourses(items);
      setCoordinators(coordData.items ?? []);
      setCenterDirectors(dirData.items ?? []);
      // Auto-detectar el periodo más reciente para el registro de correos
      if (items.length) {
        const codes = [...new Set(items.map(c => c.period?.code).filter(Boolean))] as string[];
        const latest = codes.sort().at(-1);
        if (latest) setOutboxPeriodCode(latest);
      }
      setMessage(`${items.length} NRC cargados correctamente.`);
    } catch (error) {
      setMessage(`Error al cargar datos: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    return courses.filter(c => {
      const matchPeriod = !period.trim() || c.period?.code === period.trim();
      const matchMoment = !moment.trim() || moment.trim() === 'TODOS' || c.moment === moment.trim();
      return matchPeriod && matchMoment;
    });
  }, [courses, period, moment]);

  const entries = useMemo((): ReportEntry[] => {
    const map = new Map<string, ReportEntry>();
    // scorableCount: cursos no excluidos que aportan al puntaje
    const scorableCount = new Map<string, number>();
    for (const c of filtered) {
      if (!c.teacherId) continue;
      if (!map.has(c.teacherId)) {
        map.set(c.teacherId, {
          teacherId: c.teacherId,
          teacherName: c.teacher?.fullName ?? 'Docente sin nombre',
          teacherEmail: c.teacher?.email ?? '',
          teacherEmail2: c.teacher?.email2 ?? '',
          coordination: c.teacher?.coordination ?? 'Sin coordinacion',
          campus: c.teacher?.campus ?? '-',
          courses: [],
          totalScore: null,
          alistamiento: null,
          ejecucion: null,
        });
        scorableCount.set(c.teacherId, 0);
      }
      const entry = map.get(c.teacherId)!;
      // Cursos excluidos de revision no aparecen ni aportan al puntaje
      if (c.reviewExcluded) continue;
      entry.courses.push(c);
      const al = c.evaluationSummary?.alistamientoScore ?? null;
      const ej = c.evaluationSummary?.ejecucionScore ?? null;
      scorableCount.set(c.teacherId, (scorableCount.get(c.teacherId) ?? 0) + 1);
      if (al !== null) entry.alistamiento = (entry.alistamiento ?? 0) + al;
      if (ej !== null) entry.ejecucion = (entry.ejecucion ?? 0) + ej;
    }
    // Eliminar docentes que quedaron sin ningun curso valido
    for (const [tid, entry] of map.entries()) {
      if (entry.courses.length === 0) map.delete(tid);
    }
    // Promedio por docente usando solo cursos no excluidos
    for (const entry of map.values()) {
      const n = scorableCount.get(entry.teacherId) || 1;
      if (entry.alistamiento !== null) entry.alistamiento = entry.alistamiento / n;
      if (entry.ejecucion !== null) entry.ejecucion = entry.ejecucion / n;
      if (entry.alistamiento !== null && entry.ejecucion !== null) {
        entry.totalScore = entry.alistamiento + entry.ejecucion;
      } else if (entry.alistamiento !== null) {
        entry.totalScore = entry.alistamiento;
      } else if (entry.ejecucion !== null) {
        entry.totalScore = entry.ejecucion;
      }
    }
    return [...map.values()];
  }, [filtered]);

  const coordinations = useMemo(() => {
    const s = new Set(entries.map(e => e.coordination));
    return [...s].sort();
  }, [entries]);

  const entriesByCenter = useMemo(() => {
    const map = new Map<string, ReportEntry[]>();
    for (const e of entries) {
      const key = e.campus || 'Sin centro';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [entries]);

  const generatedAt = new Date().toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });

  function openPreview(html: string, title: string) {
    setPreviewHtml(html);
    setPreviewTitle(title);
  }

  function downloadCsv(content: string, filename: string) {
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadHtml(html: string, filename: string) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printAsPdf(html: string) {
    const win = window.open('', '_blank');
    if (!win) { alert('Permite ventanas emergentes para generar el PDF.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  function buildCombinedInsatisfactorioPdf(list: ReportEntry[]): string {
    const bodies = list.map(e => {
      const html = buildInsatisfactorioReport(e, displayPeriod, moment, generatedAt);
      const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      return match ? match[1].trim() : '';
    });
    return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8">
<title>Planes de Mejora — Momento ${moment} — ${displayPeriod}</title>
${BASE_CSS}
<style>
.shell{page-break-after:always;break-after:page;margin:0 auto;}
.shell:last-child{page-break-after:avoid;break-after:avoid;}
@media print{body{background:#fff;}}
</style>
</head><body>${bodies.join('\n')}</body></html>`;
  }

  function generateAllTeacherReports() {
    entries.forEach(entry => {
      const html = buildTeacherReport(entry, displayPeriod, moment, generatedAt);
      downloadHtml(html, `CIERRE_M${moment}_${period}_DOCENTE_${entry.teacherName.replace(/\s+/g, '_').toUpperCase()}.html`);
    });
    setMessage(`${entries.length} reportes de docentes descargados.`);
  }

  function generateAllCoordReports() {
    coordinations.forEach(coord => {
      const list = entries.filter(e => e.coordination === coord);
      const html = buildCoordinatorReport(coord, list, displayPeriod, moment, generatedAt);
      downloadHtml(html, `CIERRE_M${moment}_${period}_COORD_${coord.replace(/\s+/g, '_').toUpperCase()}.html`);
    });
    setMessage(`${coordinations.length} reportes de coordinacion descargados.`);
  }

  function generateDirectivosReport(audience: string) {
    const html = buildDirectivosReport(entries, displayPeriod, moment, generatedAt, audience);
    downloadHtml(html, `CIERRE_M${moment}_${period}_DIRECTIVOS_${audience.replace(/\s+/g, '_').toUpperCase()}.html`);
  }

  const withScore = entries.filter(e => e.totalScore !== null);
  const avgGlobal = withScore.length ? withScore.reduce((s, e) => s + (e.totalScore ?? 0), 0) / withScore.length : null;
  const bandCounts = {
    excelente: withScore.filter(e => (e.totalScore ?? 0) >= 91).length,
    bueno: withScore.filter(e => { const s = e.totalScore ?? 0; return s >= 80 && s < 91; }).length,
    aceptable: withScore.filter(e => { const s = e.totalScore ?? 0; return s >= 70 && s < 80; }).length,
    insatisfactorio: withScore.filter(e => (e.totalScore ?? 0) < 70).length,
  };

  return (
    <article className="panel">
      <h2>Reportes de Cierre</h2>
      <div className="actions">
        Genera reportes profesionales de cierre de momento con el 100% de la puntuacion (Alistamiento + Ejecucion).
        Disponibles para docentes, coordinaciones y directivos (Subdireccion, Direccion, Vicerectoria).
      </div>

      {/* ESTUDIANTES UNICOS — SFAALST */}
      <div className="subtitle" style={{ marginTop: 16 }}>Estudiantes únicos — Banner (SFAALST)</div>
      <div className="actions" style={{ marginBottom: 8 }}>
        Consulta o sincroniza la nómina de estudiantes matriculados desde Banner vía SFAALST.
        La consulta muestra el conteo de la última sincronización. La sincronización actualiza los datos desde Banner (puede tardar horas para periodos grandes).
      </div>
      <div className="controls" style={{ alignItems: 'flex-start', gap: 10 }}>
        <label>
          Periodo
          <input value={period} onChange={e => setPeriod(e.target.value)} placeholder="ej: 202615" style={{ width: 160 }} />
        </label>
        <button onClick={() => void loadUniqueStudents()} style={{ background: '#1e40af', color: '#fff', alignSelf: 'flex-end' }}>
          Consultar conteo actual
        </button>
        <button onClick={() => void runRosterSync()} disabled={rosterSyncing} style={{ background: rosterSyncing ? '#9ca3af' : '#7c3aed', color: '#fff', alignSelf: 'flex-end' }}>
          {rosterSyncing ? 'Sincronizando SFAALST...' : 'Sincronizar matrícula SFAALST'}
        </button>
      </div>
      {uniqueStudentStats !== null && (
        <div className="badges" style={{ marginTop: 8, gap: 8 }}>
          <span className="badge" style={{ background: '#ede9fe', color: '#4c1d95', fontSize: 14, fontWeight: 700 }}>
            Estudiantes únicos: {uniqueStudentStats.uniqueStudents.toLocaleString()}
          </span>
          <span className="badge" style={{ background: '#f3f4f6', color: '#374151' }}>
            Total filas: {uniqueStudentStats.totalRows.toLocaleString()}
          </span>
        </div>
      )}
      {rosterMsg && (
        <div className="message" style={{ marginTop: 8, background: rosterMsg.toLowerCase().includes('error') ? '#fee2e2' : '#f0fdf4', color: rosterMsg.toLowerCase().includes('error') ? '#991b1b' : '#166534', border: `1px solid ${rosterMsg.toLowerCase().includes('error') ? '#fca5a5' : '#86efac'}` }}>
          {rosterMsg}
        </div>
      )}

      {/* CONFIGURACION */}
      <div className="subtitle" style={{ marginTop: 20 }}>1. Configurar el reporte</div>
      <div className="controls">
        <label>
          Periodo
          <input value={period} onChange={e => setPeriod(e.target.value)} placeholder="ej: 202621 (vacío = todos)" style={{ width: 180 }} />
        </label>
        <label>
          Momento
          <select value={moment} onChange={e => setMoment(e.target.value)}>
            <option value="TODOS">Todos los momentos</option>
            <option value="MD1">Momento 1 (MD1)</option>
            <option value="MD2">Momento 2 (MD2)</option>
            <option value="1">Semestral / RYC</option>
            <option value="INTER">Intersemestral</option>
            <option value="RM1">Remedial M1</option>
            <option value="RM2">Remedial M2</option>
          </select>
        </label>
        <label title="Periodo bajo el cual se registran los correos enviados. Se detecta automáticamente al cargar datos.">
          Periodo correos
          <input
            value={outboxPeriodCode}
            onChange={e => setOutboxPeriodCode(e.target.value)}
            placeholder="auto-detectado"
            style={{ width: 150 }}
          />
        </label>
        <button className="primary" onClick={() => void loadData()} disabled={loading}>
          {loading ? 'Cargando datos...' : 'Cargar datos'}
        </button>
      </div>

      {/* RESUMEN */}
      {entries.length > 0 && (
        <>
          <div className="subtitle" style={{ marginTop: 12 }}>2. Resumen del periodo</div>
          <div className="badges" style={{ marginTop: 8, gap: 8 }}>
            <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>
              NRC filtrados: {filtered.length}
            </span>
            <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>
              Docentes: {entries.length}
            </span>
            <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>
              Coordinaciones: {coordinations.length}
            </span>
            <span className="badge" style={{ background: avgGlobal !== null && avgGlobal >= 70 ? '#dcfce7' : '#fef3c7', color: avgGlobal !== null && avgGlobal >= 70 ? '#166534' : '#92400e' }}>
              Promedio global: {avgGlobal !== null ? avgGlobal.toFixed(1) : 'N/A'} / 100
            </span>
            <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>★ Excelente: {bandCounts.excelente}</span>
            <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>▲ Bueno: {bandCounts.bueno}</span>
            <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>● Aceptable: {bandCounts.aceptable}</span>
            <span className="badge" style={{ background: '#fee2e2', color: '#991b1b' }}>▼ Insatisfactorio: {bandCounts.insatisfactorio}</span>
          </div>

          {/* REPORTE DOCENTES */}
          <div className="subtitle" style={{ marginTop: 16 }}>3. Reportes para Docentes</div>
          <div className="actions">
            Un reporte individual por docente con su puntuacion total, desglose por aula y mensaje personalizado segun su resultado.
          </div>
          <div className="controls" style={{ marginTop: 8 }}>
            <button className="primary" onClick={generateAllTeacherReports}>
              Descargar todos ({entries.length} reportes)
            </button>
            <button
              className="primary"
              onClick={() => void sendDocentesReports()}
              disabled={sendingDocentes}
              style={{ background: '#16a34a' }}
            >
              {sendingDocentes ? 'Enviando...' : `Enviar por correo (${entries.filter(e => e.teacherEmail).length} con email)`}
            </button>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Docente</th>
                  <th>Coordinacion</th>
                  <th style={{ textAlign: 'center' }}>NRC</th>
                  <th style={{ textAlign: 'center' }}>Alistamiento</th>
                  <th style={{ textAlign: 'center' }}>Ejecucion</th>
                  <th style={{ textAlign: 'center' }}>Total / 100</th>
                  <th style={{ textAlign: 'center' }}>Banda</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {entries.sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1)).map(entry => {
                  const b = entry.totalScore !== null ? getBand(entry.totalScore) : null;
                  return (
                    <tr key={entry.teacherId}>
                      <td>
                        <strong>{entry.teacherName}</strong>
                        <br /><span style={{ fontSize: 11, color: '#6b7280' }}>{entry.teacherEmail}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>{entry.coordination}</td>
                      <td style={{ textAlign: 'center' }}>{entry.courses.length}</td>
                      <td style={{ textAlign: 'center' }}>{entry.alistamiento !== null ? entry.alistamiento.toFixed(1) : '-'}</td>
                      <td style={{ textAlign: 'center' }}>{entry.ejecucion !== null ? entry.ejecucion.toFixed(1) : '-'}</td>
                      <td style={{ textAlign: 'center' }}><strong>{entry.totalScore !== null ? entry.totalScore.toFixed(1) : '-'}</strong></td>
                      <td style={{ textAlign: 'center' }}>
                        {b ? (
                          <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, background: b.bg, color: b.color, border: `1px solid ${b.border}`, fontSize: 11, fontWeight: 700 }}>
                            {b.label}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          style={{ background: '#f3f4f6', color: '#111827', marginRight: 6, fontSize: 11 }}
                          onClick={() => openPreview(buildTeacherReport(entry, displayPeriod, moment, generatedAt), `Docente: ${entry.teacherName}`)}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          style={{ background: '#1e40af', color: '#fff', fontSize: 11, marginRight: 6 }}
                          onClick={() => downloadHtml(buildTeacherReport(entry, displayPeriod, moment, generatedAt), `CIERRE_M${moment}_${period}_${entry.teacherName.replace(/\s+/g, '_').toUpperCase()}.html`)}
                        >
                          Descargar
                        </button>
                        <button
                          type="button"
                          disabled={sendingTeacherReport === entry.teacherId || uniqueEmails(entry.teacherEmail, entry.teacherEmail2).length === 0}
                          style={{ background: '#16a34a', color: '#fff', fontSize: 11, opacity: uniqueEmails(entry.teacherEmail, entry.teacherEmail2).length > 0 ? 1 : 0.45 }}
                          title={uniqueEmails(entry.teacherEmail, entry.teacherEmail2).join(' + ') || 'Sin correo registrado'}
                          onClick={async () => {
                            const recipients = uniqueEmails(entry.teacherEmail, entry.teacherEmail2);
                            if (!recipients.length) return;
                            setSendingTeacherReport(entry.teacherId);
                            setSendResult('');
                            try {
                              const html = buildTeacherReport(entry, displayPeriod, moment, generatedAt);
                              const items = recipients.map((r) => ({
                                recipientName: entry.teacherName,
                                recipientEmail: r,
                                teacherId: entry.teacherId,
                                subject: `[UNIMINUTO] Informe de Cierre — Campus Virtual Momento ${moment} — ${displayPeriod}`,
                                htmlBody: html,
                              }));
                              const result = await queueAndSend('DOCENTE', items);
                              setSendResult(`${entry.teacherName}: ${result.sentCount}/${recipients.length} correos enviados.`);
                            } catch (err) {
                              setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
                            } finally {
                              setSendingTeacherReport(null);
                            }
                          }}
                        >
                          {sendingTeacherReport === entry.teacherId ? 'Enviando...' : `Enviar (${uniqueEmails(entry.teacherEmail, entry.teacherEmail2).length})`}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* REPORTE COORDINACIONES */}
          <div className="subtitle" style={{ marginTop: 20 }}>4. Reportes para Coordinaciones</div>
          <div className="actions">
            Un reporte por coordinacion con el consolidado de todos sus docentes, estadisticas de distribucion y alertas de mejora.
          </div>
          <div className="controls" style={{ marginTop: 8 }}>
            <button className="primary" onClick={generateAllCoordReports}>
              Descargar todos ({coordinations.length} reportes)
            </button>
            <button
              className="primary"
              onClick={() => void sendCoordsReports()}
              disabled={sendingCoords}
              style={{ background: '#16a34a' }}
            >
              {sendingCoords ? 'Enviando...' : `Enviar por correo (${coordinations.filter(coord => !!findCoordinator(coord, coordinators)?.email).length} con coordinador)`}
            </button>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Coordinacion</th>
                  <th style={{ textAlign: 'center' }}>Docentes</th>
                  <th style={{ textAlign: 'center' }}>NRC</th>
                  <th style={{ textAlign: 'center' }}>Promedio</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {coordinations.map(coord => {
                  const list = entries.filter(e => e.coordination === coord);
                  const ws = list.filter(e => e.totalScore !== null);
                  const avg = ws.length ? ws.reduce((s, e) => s + (e.totalScore ?? 0), 0) / ws.length : null;
                  const totalNrcCoord = list.reduce((s, e) => s + e.courses.length, 0);
                  const b = avg !== null ? getBand(avg) : null;
                  const coordKey = normKey(coord);
                  const matchedCoord = findCoordinator(coord, coordinators);
                  return (
                    <tr key={coord}>
                      <td>
                        <strong>{coord}</strong>
                        <br />
                        <span style={{ fontSize: 11, color: matchedCoord ? '#16a34a' : '#9ca3af' }}>
                          {matchedCoord ? `✓ ${matchedCoord.fullName} — ${matchedCoord.email}` : '— sin coordinador registrado'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>{list.length}</td>
                      <td style={{ textAlign: 'center' }}>{totalNrcCoord}</td>
                      <td style={{ textAlign: 'center' }}>
                        {avg !== null ? (
                          <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, background: b!.bg, color: b!.color, border: `1px solid ${b!.border}`, fontSize: 11, fontWeight: 700 }}>
                            {avg.toFixed(1)} — {b!.label}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          style={{ background: '#f3f4f6', color: '#111827', marginRight: 6, fontSize: 11 }}
                          onClick={() => openPreview(buildCoordinatorReport(coord, list, displayPeriod, moment, generatedAt), `Coordinacion: ${coord}`)}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          style={{ background: '#1e40af', color: '#fff', fontSize: 11, marginRight: 6 }}
                          onClick={() => { const html = buildCoordinatorReport(coord, list, displayPeriod, moment, generatedAt); downloadHtml(html, `CIERRE_M${moment}_${period}_COORD_${coord.replace(/\s+/g, '_').toUpperCase()}.html`); }}
                        >
                          Descargar
                        </button>
                        <button
                          type="button"
                          style={{ background: matchedCoord?.email ? '#16a34a' : '#9ca3af', color: '#fff', fontSize: 11, cursor: matchedCoord?.email ? 'pointer' : 'not-allowed' }}
                          disabled={sendingCoordId === coord || !matchedCoord?.email}
                          title={matchedCoord?.email ? `Enviar a ${matchedCoord.email}` : 'Sin coordinador registrado'}
                          onClick={async () => {
                            if (!matchedCoord?.email) return;
                            setSendingCoordId(coord);
                            setSendResult('');
                            try {
                              const result = await queueAndSend('COORDINADOR', [{
                                recipientName: matchedCoord.fullName,
                                recipientEmail: matchedCoord.email,
                                coordinatorId: matchedCoord.id,
                                subject: `[UNIMINUTO] Informe Coordinacion ${coord} — Momento ${moment} — ${period}`,
                                htmlBody: buildCoordinatorReport(coord, list, displayPeriod, moment, generatedAt),
                              }]);
                              setSendResult(`${coord}: ${result.sentCount > 0 ? 'enviado correctamente' : 'no enviado'}${result.failedCount ? ` (${result.failedCount} fallido)` : ''}${result.skippedCount ? ` (omitido - duplicado)` : ''}.`);
                            } catch (err) {
                              setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
                            } finally {
                              setSendingCoordId(null);
                            }
                          }}
                        >
                          {sendingCoordId === coord ? 'Enviando...' : 'Enviar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* REPORTE POR CENTRO UNIVERSITARIO */}
          <div className="subtitle" style={{ marginTop: 20 }}>5. Reportes por Centro Universitario</div>
          <div className="actions">
            Informe consolidado por centro universitario, dirigido al director de centro. Incluye todos los docentes del centro y sus calificaciones.
          </div>
          <div style={{ marginTop: 10 }}>
            {centerDirectors.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                No hay directores de centro registrados. Agregalos en{' '}
                <a href="/centros-universitarios" style={{ color: '#1e40af', textDecoration: 'underline' }}>Centros Universitarios</a>.
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className="primary"
                    style={{ background: '#16a34a', color: '#fff' }}
                    onClick={() => void sendAllCenterReports()}
                  >
                    Enviar a todos los directores ({centerDirectors.filter((d) => (entriesByCenter.get(d.campusCode) ?? []).length > 0 && d.email).length})
                  </button>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Centro</th>
                      <th>Director</th>
                      <th style={{ textAlign: 'center' }}>Docentes</th>
                      <th style={{ textAlign: 'center' }}>Promedio</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {centerDirectors.map((d) => {
                      const list = entriesByCenter.get(d.campusCode) ?? [];
                      const ws = list.filter((e) => e.totalScore !== null);
                      const avg = ws.length ? ws.reduce((s, e) => s + (e.totalScore ?? 0), 0) / ws.length : null;
                      const label = d.campusName ?? d.campusCode;
                      const html = buildCenterReport(d.campusCode, d.campusName ?? '', d.fullName, list, displayPeriod, moment, generatedAt);
                      return (
                        <tr key={d.id}>
                          <td><strong>{label}</strong> <span className="muted" style={{ fontSize: 11 }}>({d.campusCode})</span></td>
                          <td>{d.fullName}<br /><span style={{ fontSize: 11, color: '#6b7280' }}>{d.email}</span></td>
                          <td style={{ textAlign: 'center' }}>{list.length}</td>
                          <td style={{ textAlign: 'center' }}>{avg !== null ? avg.toFixed(1) : '—'}</td>
                          <td>
                            <button type="button" onClick={() => openPreview(html, `Informe centro ${label}`)}>Preview</button>{' '}
                            <button
                              type="button"
                              className="primary"
                              disabled={sendingCenterId === d.id || !list.length}
                              style={{ background: '#16a34a', color: '#fff' }}
                              onClick={() => void sendCenterReport(d)}
                            >
                              {sendingCenterId === d.id ? 'Enviando...' : 'Enviar'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Centros sin director */}
                    {[...entriesByCenter.keys()]
                      .filter((c) => !centerDirectors.some((d) => d.campusCode === c))
                      .map((c) => {
                        const list = entriesByCenter.get(c) ?? [];
                        const ws = list.filter((e) => e.totalScore !== null);
                        const avg = ws.length ? ws.reduce((s, e) => s + (e.totalScore ?? 0), 0) / ws.length : null;
                        return (
                          <tr key={`pending-${c}`} style={{ background: '#fef3c7' }}>
                            <td><strong>{c}</strong></td>
                            <td className="muted" style={{ fontSize: 11 }}>— sin director registrado —</td>
                            <td style={{ textAlign: 'center' }}>{list.length}</td>
                            <td style={{ textAlign: 'center' }}>{avg !== null ? avg.toFixed(1) : '—'}</td>
                            <td>
                              <a href="/centros-universitarios" style={{ fontSize: 11, color: '#854d0e', textDecoration: 'underline' }}>Asignar director</a>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {/* REPORTE DIRECTIVOS */}
          <div className="subtitle" style={{ marginTop: 20 }}>6. Reportes para Directivos</div>
          <div className="actions">
            Informe ejecutivo consolidado con KPIs institucionales, distribucion por coordinacion y analisis de bandas. Personalizable por audiencia.
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Subdireccion Academica', key: 'subdireccion' as const },
              { label: 'Direccion Academica', key: 'direccion' as const },
              { label: 'Vicerectoria Academica', key: 'vicerectoria' as const },
            ].map(({ label, key }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, width: 180, flexShrink: 0 }}>{label}</span>
                <input
                  type="email"
                  placeholder="correo@uniminuto.edu.co"
                  value={directivosEmails[key]}
                  onChange={e => setDirectivosEmails(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{ flex: '1 1 220px', minWidth: 180 }}
                />
                <button
                  type="button"
                  style={{ background: '#f3f4f6', color: '#111827', whiteSpace: 'nowrap' }}
                  onClick={() => openPreview(buildDirectivosReport(entries, displayPeriod, moment, generatedAt, label), `Informe: ${label}`)}
                >
                  Preview
                </button>
                <button
                  type="button"
                  style={{ background: '#1e40af', color: '#fff', whiteSpace: 'nowrap' }}
                  onClick={() => generateDirectivosReport(label)}
                >
                  Descargar
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={sendingDirectivos === key || !directivosEmails[key].trim()}
                  style={{ background: '#16a34a', color: '#fff', whiteSpace: 'nowrap' }}
                  onClick={() => void sendDirectivosReport(key, directivosEmails[key], label)}
                >
                  {sendingDirectivos === key ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            ))}

            {/* Extra destinatarios */}
            {extraDirectivosRecipients.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '6px 10px' }}>
                <input
                  type="text"
                  placeholder="Nombre / cargo"
                  value={r.label}
                  onChange={e => setExtraDirectivosRecipients(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                  style={{ flex: '1 1 160px', minWidth: 130 }}
                />
                <input
                  type="email"
                  placeholder="correo@uniminuto.edu"
                  value={r.email}
                  onChange={e => setExtraDirectivosRecipients(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))}
                  style={{ flex: '1 1 220px', minWidth: 180 }}
                />
                <button
                  type="button"
                  style={{ background: '#f3f4f6', color: '#111827', whiteSpace: 'nowrap' }}
                  onClick={() => openPreview(buildDirectivosReport(entries, displayPeriod, moment, generatedAt, r.label || 'Directivo'), `Informe: ${r.label || 'Directivo'}`)}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={sendingDirectivos === `extra_${i}` || !r.email.trim()}
                  style={{ background: '#16a34a', color: '#fff', whiteSpace: 'nowrap' }}
                  onClick={() => void sendDirectivosReport(`extra_${i}`, r.email, r.label || r.email)}
                >
                  {sendingDirectivos === `extra_${i}` ? 'Enviando...' : 'Enviar'}
                </button>
                <button
                  type="button"
                  title="Eliminar destinatario"
                  style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 4, padding: '3px 10px', fontSize: 11, fontWeight: 600, flexShrink: 0 }}
                  onClick={() => setExtraDirectivosRecipients(prev => prev.filter((_, j) => j !== i))}
                >
                  Eliminar
                </button>
              </div>
            ))}

            <button
              type="button"
              style={{ marginTop: 4, background: '#7c3aed', color: '#fff', fontSize: 11 }}
              onClick={() => setExtraDirectivosRecipients(prev => [...prev, { label: '', email: '' }])}
            >
              + Agregar destinatario
            </button>
          </div>
        </>
      )}

          {/* INSATISFACTORIO */}
          {(() => {
            const insatisfactorios = entries.filter(e => e.totalScore !== null && e.totalScore < 70 && !excludedFromInsatisf.has(e.teacherId));
            const allInsatisfactorios = entries.filter(e => e.totalScore !== null && e.totalScore < 70);
            if (!allInsatisfactorios.length) return null;
            return (
              <>
                <div className="subtitle" style={{ marginTop: 24, color: '#991b1b' }}>
                  6. Docentes con Resultado Insatisfactorio
                  <span style={{ marginLeft: 8, display: 'inline-block', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '2px 10px' }}>
                    {insatisfactorios.length} activo{insatisfactorios.length !== 1 ? 's' : ''}{excludedFromInsatisf.size > 0 ? ` / ${excludedFromInsatisf.size} excluido${excludedFromInsatisf.size !== 1 ? 's' : ''}` : ''}
                  </span>
                </div>
                <div className="actions" style={{ color: '#7f1d1d' }}>
                  Docentes con puntaje inferior a 70 puntos. Se genera una notificacion individual con plan de mejora y acciones concretas para el proximo momento.
                </div>
                <div className="controls" style={{ marginTop: 8 }}>
                  <button
                    className="primary"
                    onClick={() => {
                      const header = ['Docente', 'Email', 'Coordinacion', 'Campus', 'NRCs', 'Alistamiento', 'Ejecucion', 'Total', 'Deficit'].join(',');
                      const rows = insatisfactorios
                        .sort((a, b) => (a.totalScore ?? 0) - (b.totalScore ?? 0))
                        .map(e => [
                          `"${e.teacherName.replace(/"/g, '""')}"`,
                          `"${(e.teacherEmail || '').replace(/"/g, '""')}"`,
                          `"${e.coordination.replace(/"/g, '""')}"`,
                          `"${e.campus.replace(/"/g, '""')}"`,
                          e.courses.length,
                          e.alistamiento !== null ? e.alistamiento.toFixed(1) : '',
                          e.ejecucion !== null ? e.ejecucion.toFixed(1) : '',
                          e.totalScore !== null ? e.totalScore.toFixed(1) : '',
                          e.totalScore !== null ? (70 - e.totalScore).toFixed(1) : '',
                        ].join(','));
                      downloadCsv([header, ...rows].join('\n'), `INSATISFACTORIOS_M${moment}_${period}.csv`);
                    }}
                    style={{ background: '#374151', color: '#fff' }}
                  >
                    Descargar listado CSV
                  </button>
                  <button
                    className="primary"
                    onClick={() => insatisfactorios.forEach(e => downloadHtml(buildInsatisfactorioReport(e, displayPeriod, moment, generatedAt), `PLAN_MEJORA_M${moment}_${period}_${e.teacherName.replace(/\s+/g, '_').toUpperCase()}.html`))}
                    style={{ background: '#b91c1c' }}
                  >
                    Descargar planes HTML ({insatisfactorios.length})
                  </button>
                  <button
                    className="primary"
                    onClick={() => printAsPdf(buildCombinedInsatisfactorioPdf(insatisfactorios))}
                    style={{ background: '#7f1d1d' }}
                    title="Abre todos los planes en una sola ventana lista para imprimir o guardar como PDF"
                  >
                    Descargar todos como PDF ({insatisfactorios.length})
                  </button>
                  <button
                    className="primary"
                    onClick={() => void sendInsatisfactorioReports()}
                    disabled={sendingInsatisfactorio}
                    style={{ background: '#b91c1c' }}
                  >
                    {sendingInsatisfactorio ? 'Enviando...' : `Notificar a todos (${insatisfactorios.filter(e => e.teacherEmail).length} con email)`}
                  </button>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: '#7c2d12' }} htmlFor="cutoff-date-input">
                      Fecha corte del momento:
                    </label>
                    <input
                      id="cutoff-date-input"
                      type="date"
                      value={significantEventCutoffDate}
                      onChange={(e) => {
                        setSignificantEventCutoffDate(e.target.value);
                        try { localStorage.setItem(`significant-event-cutoff-${moment}`, e.target.value); } catch {}
                      }}
                      style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d97706', borderRadius: 4 }}
                      title="Fecha de cierre oficial del momento. Se usa para calcular antiguedad >=90 dias de cada docente."
                    />
                  </div>
                  <button
                    className="primary"
                    onClick={async () => {
                      if (!significantEventCutoffDate) {
                        alert('Define la fecha de corte del momento antes de registrar.');
                        return;
                      }
                      try {
                        const res = await fetch(`${apiBase}/outbox/significant-events/backfill`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            periodCode: period,
                            moment,
                            phase: 'CIERRE',
                            cutoffDate: new Date(significantEventCutoffDate + 'T00:00:00.000Z').toISOString(),
                            tenureDays: 90,
                            teachers: insatisfactorios.map(e => ({
                              teacherId: e.teacherId,
                              totalScore: e.totalScore,
                              alistamientoScore: e.alistamiento,
                              ejecucionScore: e.ejecucion,
                              coordination: e.coordination,
                              campus: e.campus,
                            })),
                          }),
                        });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const json = await res.json();
                        alert(`Eventos significativos registrados (corte ${significantEventCutoffDate}): ${json.created} creados, ${json.updated} actualizados, ${json.skipped} omitidos. Ve al modulo "Eventos Significativos" para gestionar firma/entrega/cargue.`);
                      } catch (err) {
                        alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
                      }
                    }}
                    style={{ background: '#7c2d12' }}
                    title="Registra estos docentes en la tabla de Eventos Significativos para hacer seguimiento de firma, entrega y cargue en Subdireccion de Docencia."
                  >
                    Registrar eventos significativos ({insatisfactorios.length})
                  </button>
                  {(() => {
                    const byCoord = new Map<string, ReportEntry[]>();
                    for (const e of insatisfactorios) {
                      const coord = e.coordination || 'Sin coordinacion';
                      if (!byCoord.has(coord)) byCoord.set(coord, []);
                      byCoord.get(coord)!.push(e);
                    }
                    const withEmail = [...byCoord.keys()].filter(coord => !!findCoordinator(coord, coordinators)?.email);
                    return (
                      <button
                        className="primary"
                        onClick={() => void sendConvocatoriaToCoords()}
                        disabled={sendingConvocatoria}
                        style={{ background: '#b45309' }}
                      >
                        {sendingConvocatoria ? 'Enviando...' : `Convocar coordinadores (${withEmail.length} con email)`}
                      </button>
                    );
                  })()}
                </div>

                {/* Destinatarios adicionales — siempre visible */}
                {(() => {
                  const byCoordExtra = buildConvocatoriaGroups(insatisfactorios);
                  const coordGroupsExtra = [...byCoordExtra.entries()].map(([coord, teachers]) => ({ coord, teachers }));
                  return (
                    <div style={{ marginTop: 10, background: '#faf5ff', border: '1px solid #d8b4fe', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#581c87', flex: 1 }}>
                          Tambien enviar a (reciben el resumen consolidado)
                        </div>
                        <button
                          type="button"
                          style={{ background: '#d97706', color: '#fff', fontSize: 11, flexShrink: 0 }}
                          onClick={() => openPreview(
                            buildConvocatoriaResumenReport(coordGroupsExtra, displayPeriod, moment, generatedAt, 'Subdirección / Dirección'),
                            'Preview resumen — correo que reciben los directivos',
                          )}
                        >
                          Ver preview del resumen
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {extraConvocatoriaRecipients.map((rec, idx) => (
                          <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                              value={rec.label}
                              onChange={e => setExtraConvocatoriaRecipients(prev => prev.map((r, i) => i === idx ? { ...r, label: e.target.value } : r))}
                              placeholder="Cargo / nombre"
                              style={{ flex: '1 1 180px', fontSize: '0.8125rem' }}
                            />
                            <input
                              type="email"
                              value={rec.email}
                              onChange={e => setExtraConvocatoriaRecipients(prev => prev.map((r, i) => i === idx ? { ...r, email: e.target.value } : r))}
                              placeholder="correo@uniminuto.edu"
                              style={{ flex: '2 1 240px', fontSize: '0.8125rem' }}
                            />
                            <button
                              type="button"
                              style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11, flexShrink: 0, padding: '4px 10px' }}
                              onClick={() => setExtraConvocatoriaRecipients(prev => prev.filter((_, i) => i !== idx))}
                              title="Eliminar destinatario"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        style={{ marginTop: 8, background: '#7c3aed', color: '#fff', fontSize: 11 }}
                        onClick={() => setExtraConvocatoriaRecipients(prev => [...prev, { label: '', email: '' }])}
                      >
                        + Agregar destinatario
                      </button>
                      <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
                        Todos reciben el mismo resumen consolidado. El boton <strong>"Ver preview del resumen"</strong> muestra exactamente ese correo.
                      </div>
                    </div>
                  );
                })()}

                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'center', width: 36 }} title="Incluir en reportes y convocatoria">Incl.</th>
                        <th>Docente</th>
                        <th>Coordinacion</th>
                        <th style={{ textAlign: 'center' }}>Alistamiento</th>
                        <th style={{ textAlign: 'center' }}>Ejecucion</th>
                        <th style={{ textAlign: 'center' }}>Total / 100</th>
                        <th style={{ textAlign: 'center' }}>Deficit</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allInsatisfactorios
                        .sort((a, b) => (a.totalScore ?? 0) - (b.totalScore ?? 0))
                        .map(entry => {
                          const excluded = excludedFromInsatisf.has(entry.teacherId);
                          const deficit = 70 - (entry.totalScore ?? 0);
                          return (
                            <tr key={entry.teacherId} style={{ background: excluded ? '#f9fafb' : '#fff5f5', opacity: excluded ? 0.55 : 1 }}>
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={!excluded}
                                  title={excluded ? 'Excluido de reportes y convocatoria' : 'Incluido en reportes y convocatoria'}
                                  onChange={() => setExcludedFromInsatisf(prev => {
                                    const next = new Set(prev);
                                    if (next.has(entry.teacherId)) next.delete(entry.teacherId);
                                    else next.add(entry.teacherId);
                                    return next;
                                  })}
                                />
                              </td>
                              <td>
                                <strong style={{ color: excluded ? '#9ca3af' : '#991b1b' }}>{entry.teacherName}</strong>
                                <br />
                                <span style={{ fontSize: 11, color: entry.teacherEmail ? '#6b7280' : '#fca5a5' }}>
                                  {entry.teacherEmail || '— sin correo registrado'}
                                </span>
                              </td>
                              <td style={{ fontSize: 12 }}>{entry.coordination}</td>
                              <td style={{ textAlign: 'center', color: (entry.alistamiento ?? 0) < 25 ? '#991b1b' : '#92400e', fontWeight: 700 }}>
                                {entry.alistamiento !== null ? entry.alistamiento.toFixed(1) : '-'}
                              </td>
                              <td style={{ textAlign: 'center', color: (entry.ejecucion ?? 0) < 25 ? '#991b1b' : '#92400e', fontWeight: 700 }}>
                                {entry.ejecucion !== null ? entry.ejecucion.toFixed(1) : '-'}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <strong style={{ color: '#991b1b', fontSize: 15 }}>{entry.totalScore !== null ? entry.totalScore.toFixed(1) : '-'}</strong>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', fontSize: 11, fontWeight: 700 }}>
                                  &minus;{deficit.toFixed(1)} pts
                                </span>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button
                                  type="button"
                                  style={{ background: '#f3f4f6', color: '#111827', marginRight: 6, fontSize: 11 }}
                                  onClick={() => openPreview(buildInsatisfactorioReport(entry, displayPeriod, moment, generatedAt), `Plan mejora: ${entry.teacherName}`)}
                                >
                                  Preview
                                </button>
                                <button
                                  type="button"
                                  style={{ background: '#b91c1c', color: '#fff', fontSize: 11, marginRight: 4 }}
                                  onClick={() => downloadHtml(buildInsatisfactorioReport(entry, displayPeriod, moment, generatedAt), `PLAN_MEJORA_M${moment}_${period}_${entry.teacherName.replace(/\s+/g, '_').toUpperCase()}.html`)}
                                >
                                  HTML
                                </button>
                                <button
                                  type="button"
                                  style={{ background: '#7f1d1d', color: '#fff', fontSize: 11, marginRight: 6 }}
                                  title="Abre el plan en una ventana nueva — usa Ctrl+P o el menú para guardar como PDF"
                                  onClick={() => printAsPdf(buildInsatisfactorioReport(entry, displayPeriod, moment, generatedAt))}
                                >
                                  PDF
                                </button>
                                <button
                                  type="button"
                                  style={{ background: entry.teacherEmail ? '#16a34a' : '#d1d5db', color: '#fff', fontSize: 11, cursor: entry.teacherEmail ? 'pointer' : 'not-allowed' }}
                                  disabled={!entry.teacherEmail || sendingInsatisfactorio}
                                  onClick={async () => {
                                    if (!entry.teacherEmail) return;
                                    setSendingInsatisfactorio(true);
                                    setSendResult('');
                                    try {
                                      const result = await queueAndSend('DOCENTE', [{
                                        recipientName: entry.teacherName,
                                        recipientEmail: entry.teacherEmail,
                                        teacherId: entry.teacherId,
                                        subject: `[UNIMINUTO] Plan de Mejora — Campus Virtual Momento ${moment} — ${period}`,
                                        htmlBody: buildInsatisfactorioReport(entry, displayPeriod, moment, generatedAt),
                                      }]);
                                      setSendResult(`${entry.teacherName}: ${result.sentCount > 0 ? 'notificacion enviada' : 'no enviado'}.`);
                                    } finally {
                                      setSendingInsatisfactorio(false);
                                    }
                                  }}
                                >
                                  Notificar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 10, padding: '10px 14px', background: '#fff1f2', border: '1px solid #fca5a5', borderLeft: '4px solid #dc2626', borderRadius: 10, fontSize: 12, color: '#7f1d1d' }}>
                  <strong>Nota:</strong> Las notificaciones individuales se envian al correo registrado del docente e incluyen su puntaje detallado, el deficit respecto al minimo y un plan de mejora con acciones concretas segun las fases con mayor debilidad (Alistamiento y/o Ejecucion).
                </div>

                {/* Panel configuracion convocatoria coordinadores */}
                {(() => {
                  const byCoord = buildConvocatoriaGroups(insatisfactorios);
                  const coordGroups = [...byCoord.entries()].map(([coord, teachers]) => ({ coord, teachers }));
                  return (
                    <details style={{ marginTop: 14 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', padding: '8px 10px', color: '#92400e', userSelect: 'none', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8 }}>
                        Configurar y previsualizar convocatoria a coordinadores ({byCoord.size} coordinacion{byCoord.size !== 1 ? 'es' : ''})
                      </summary>
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>

                        {/* A) Preview por coordinacion */}
                        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: 8, color: '#374151' }}>
                            Vista previa por coordinacion
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <button
                              type="button"
                              style={{ background: '#d97706', color: '#fff', fontSize: 12, marginRight: 8 }}
                              onClick={() => openPreview(
                                buildConvocatoriaResumenReport(coordGroups, displayPeriod, moment, generatedAt, 'Subdirección / Dirección de Docencia'),
                                'Vista resumen — Subdirección / Dirección',
                              )}
                            >
                              Preview resumen (Subdirección / Dirección)
                            </button>
                            <button
                              type="button"
                              style={{ background: '#374151', color: '#fff', fontSize: 12 }}
                              onClick={() => downloadHtml(
                                buildConvocatoriaResumenReport(coordGroups, displayPeriod, moment, generatedAt),
                                `RESUMEN_CONVOCATORIA_M${moment}_${period}.html`,
                              )}
                            >
                              Descargar resumen
                            </button>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {coordGroups.map(({ coord, teachers }) => {
                              const matchedCoord = findCoordinator(coord, coordinators);
                              return (
                                <div key={coord} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12 }}>
                                  <div style={{ flex: 1 }}>
                                    <strong style={{ color: '#92400e' }}>{coord}</strong>
                                    <span style={{ marginLeft: 6, background: '#fee2e2', color: '#991b1b', padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{teachers.length} docente{teachers.length !== 1 ? 's' : ''}</span>
                                    <br />
                                    <span style={{ color: matchedCoord ? '#6b7280' : '#fca5a5', fontSize: 11 }}>
                                      {matchedCoord ? `${matchedCoord.fullName} — ${matchedCoord.email}` : '— sin coordinador registrado'}
                                    </span>
                                  </div>
                                  <button type="button" style={{ background: '#f3f4f6', color: '#111827', fontSize: 11, flexShrink: 0 }}
                                    onClick={() => openPreview(buildConvocatoriaCoordReport(coord, teachers, displayPeriod, moment, generatedAt), `Convocatoria: ${coord}`)}>
                                    Preview
                                  </button>
                                  <button type="button" style={{ background: '#b45309', color: '#fff', fontSize: 11, flexShrink: 0 }}
                                    onClick={() => downloadHtml(buildConvocatoriaCoordReport(coord, teachers, displayPeriod, moment, generatedAt), `CONVOCATORIA_M${moment}_${period}_${coord.replace(/\s+/g, '_').toUpperCase()}.html`)}>
                                    Descargar
                                  </button>
                                  <button
                                    type="button"
                                    style={{ background: '#16a34a', color: '#fff', fontSize: 11, flexShrink: 0, opacity: matchedCoord?.email ? 1 : 0.45 }}
                                    disabled={sendingConvocatoriaCoord === coord || !matchedCoord?.email}
                                    title={matchedCoord?.email ? `Enviar a ${matchedCoord.email}` : 'Sin coordinador registrado'}
                                    onClick={async () => {
                                      if (!matchedCoord?.email) return;
                                      setSendingConvocatoriaCoord(coord);
                                      setSendResult('');
                                      try {
                                        const ccEmails = extraConvocatoriaRecipients
                                          .map(r => r.email.trim())
                                          .filter(Boolean)
                                          .join(', ');
                                        const result = await queueAndSend('COORDINADOR', [{
                                          recipientName: matchedCoord.fullName,
                                          recipientEmail: matchedCoord.email,
                                          cc: ccEmails || undefined,
                                          subject: `[UNIMINUTO] Convocatoria Jornada Induccion — Momento ${moment} — ${displayPeriod}`,
                                          htmlBody: buildConvocatoriaCoordReport(coord, teachers, displayPeriod, moment, generatedAt),
                                        }]);
                                        setSendResult(`${matchedCoord.fullName}: ${result.sentCount > 0 ? 'enviado' : 'no enviado'}.`);
                                      } catch (err) {
                                        setSendResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
                                      } finally {
                                        setSendingConvocatoriaCoord(null);
                                      }
                                    }}
                                  >
                                    {sendingConvocatoriaCoord === coord ? 'Enviando...' : 'Enviar'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* B) Correo de prueba */}
                        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: 8, color: '#0c4a6e' }}>
                            Enviar correo de prueba
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="email"
                              placeholder="tu@correo.edu.co"
                              value={testEmailConvocatoria}
                              onChange={e => setTestEmailConvocatoria(e.target.value)}
                              style={{ flex: '1 1 220px', fontSize: '0.875rem' }}
                            />
                            <button
                              type="button"
                              style={{ background: '#0369a1', color: '#fff', fontSize: 12, flexShrink: 0 }}
                              disabled={sendingTestConvocatoria || !testEmailConvocatoria.trim()}
                              onClick={() => void sendTestConvocatoria()}
                            >
                              {sendingTestConvocatoria ? 'Enviando...' : 'Enviar prueba (resumen)'}
                            </button>
                          </div>
                          <div style={{ marginTop: 6, fontSize: 11, color: '#0c4a6e' }}>
                            Recibiras el reporte resumen consolidado (el mismo que va a Subdirección / Dirección) marcado como [PRUEBA].
                          </div>
                        </div>

                        {/* C) Enviar resumen a persona específica */}
                        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 14px' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: 8, color: '#14532d' }}>
                            Enviar resumen a persona específica
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              placeholder="Nombre del destinatario"
                              value={specificRecipientName}
                              onChange={e => setSpecificRecipientName(e.target.value)}
                              style={{ flex: '1 1 180px', fontSize: '0.875rem' }}
                            />
                            <input
                              type="email"
                              placeholder="correo@uniminuto.edu"
                              value={specificRecipientEmail}
                              onChange={e => setSpecificRecipientEmail(e.target.value)}
                              style={{ flex: '1 1 220px', fontSize: '0.875rem' }}
                            />
                            <button
                              type="button"
                              style={{ background: '#16a34a', color: '#fff', fontSize: 12, flexShrink: 0 }}
                              disabled={sendingSpecificRecipient || !specificRecipientEmail.trim()}
                              onClick={() => void sendResumenToSpecific()}
                            >
                              {sendingSpecificRecipient ? 'Enviando...' : 'Enviar resumen'}
                            </button>
                          </div>
                          <div style={{ marginTop: 6, fontSize: 11, color: '#166534' }}>
                            Envía el resumen consolidado de insatisfactorios a cualquier destinatario. Sin prefijo [PRUEBA].
                          </div>
                        </div>

                      </div>
                    </details>
                  );
                })()}
              </>
            );
          })()}

      {/* ── REPORTES FUTUROS ── */}
      <div className="subtitle" style={{ marginTop: 24 }}>Proximos reportes planificados</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginTop: 10 }}>
        {[
          { titulo: 'Cierre de Semestre', desc: 'Consolidado de todos los momentos del semestre. Promedio ponderado, tendencia por docente, ranking por coordinacion y comparativo con el semestre anterior.', estado: 'Proximamente' },
          { titulo: 'Informe Anual Institucional', desc: 'Cierre del año academico con indicadores de los dos semestres. Evolucion de la calidad del campus virtual, logros y plan de mejora para el siguiente año.', estado: 'Proximamente' },
          { titulo: 'Reporte de Tendencias', desc: 'Analisis historico de la evolucion del puntaje por docente, coordinacion y periodo. Identifica mejoras y retrocesos.', estado: 'Proximamente' },
          { titulo: 'Reporte de Riesgo', desc: 'Listado priorizado de docentes con calificacion critica en multiples momentos. Insumo para planes de acompanamiento.', estado: 'Proximamente' },
        ].map(item => (
          <div key={item.titulo} style={{ background: '#f8fafc', border: '1px dashed #d1d5db', borderRadius: 12, padding: '14px 16px' }}>
            <strong style={{ fontSize: 13, color: '#374151' }}>{item.titulo}</strong>
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>{item.desc}</p>
            <span style={{ display: 'inline-block', marginTop: 8, fontSize: 11, background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 999 }}>{item.estado}</span>
          </div>
        ))}
      </div>

      {sendResult ? (
        <div className="message" style={{ marginTop: 12, background: sendResult.toLowerCase().includes('error') ? '#fee2e2' : '#dcfce7', color: sendResult.toLowerCase().includes('error') ? '#991b1b' : '#166534', border: `1px solid ${sendResult.toLowerCase().includes('error') ? '#fca5a5' : '#86efac'}` }}>
          {sendResult}
        </div>
      ) : null}
      {message ? <div className="message" style={{ marginTop: 12 }}>{message}</div> : null}

      {/* MODAL PREVIEW */}
      {previewHtml ? (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) { setPreviewHtml(null); } }}
        >
          <div style={{ width: 'min(860px, 96vw)', maxHeight: '92vh', background: '#fff', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
              <strong style={{ fontSize: 14 }}>{previewTitle}</strong>
              <button
                type="button"
                onClick={() => setPreviewHtml(null)}
                style={{ background: 'transparent', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 10px', fontSize: 16, cursor: 'pointer', color: '#374151' }}
                title="Cerrar"
              >
                ✕
              </button>
            </div>
            <iframe
              title="preview-reporte"
              srcDoc={previewHtml}
              style={{ flex: 1, border: 'none', minHeight: '80vh' }}
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}
