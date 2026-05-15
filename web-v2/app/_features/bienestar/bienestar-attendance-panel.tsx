'use client';

import { useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';
import { Button, PageHero, StatsGrid, AlertBox } from '../../_components/ui';

type BienestarAttendancePanelProps = {
  apiBase: string;
};

type RequestItem = {
  activity: string;
  shift: string;
  sessionDay: string;
  nrc: string;
};

type ParseResult = {
  items: RequestItem[];
  warnings: string[];
};

type AttendanceStudentReportResponse = {
  ok: boolean;
  summary: {
    selectedDayCount: number;
    matchedSessionCount: number;
    courseCount: number;
    studentCount: number;
    rowCount: number;
    presentCount: number;
    absentCount: number;
    justifiedCount: number;
    unknownCount: number;
    attendanceRate: number | null;
    inattendanceRate: number | null;
  };
  rows: Array<{
    sessionDay: string;
    sessionLabel: string;
    periodCode: string;
    nrc: string;
    subjectName: string | null;
    programName: string | null;
    campusCode: string | null;
    teacherName: string | null;
    studentName: string;
    studentEmail: string | null;
    studentId: string | null;
    statusCode: string | null;
    statusLabel: string;
    rawValue: string | null;
  }>;
};

type EnrichedRow = AttendanceStudentReportResponse['rows'][number] & {
  activity: string;
  shift: string;
  requestedNrc: string;
};

const SAMPLE_TEXT = `Actividad: Sumamos diversidad, multiplicamos comunidad
Jornada manana - Chicala
11/03
87476
Actividad: Pausa en 1 minuto - Respira
Jornada manana - Chicala
21/03
72661`;

function parseDayToken(value: string, year: string) {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!match) return null;
  const yyyy = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : year;
  return `${yyyy}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function parseRequestText(text: string, year: string): ParseResult {
  const items: RequestItem[] = [];
  const warnings: string[] = [];
  let activity = '';
  let shift = '';
  let sessionDay = '';

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const [index, line] of lines.entries()) {
    const activityMatch = line.match(/^actividad\s*:\s*(.+)$/i);
    if (activityMatch) {
      activity = activityMatch[1].trim();
      shift = '';
      sessionDay = '';
      continue;
    }

    if (/^jornada\b/i.test(line)) {
      shift = line;
      continue;
    }

    const parsedDay = parseDayToken(line, year);
    if (parsedDay) {
      sessionDay = parsedDay;
      continue;
    }

    const nrcMatch = line.match(/^\d{4,8}$/);
    if (nrcMatch) {
      if (!activity) warnings.push(`Linea ${index + 1}: NRC ${line} sin actividad detectada.`);
      if (!shift) warnings.push(`Linea ${index + 1}: NRC ${line} sin jornada detectada.`);
      if (!sessionDay) warnings.push(`Linea ${index + 1}: NRC ${line} sin fecha detectada.`);
      items.push({
        activity: activity || 'Sin actividad',
        shift: shift || 'Sin jornada',
        sessionDay: sessionDay || '',
        nrc: line,
      });
      continue;
    }

    warnings.push(`Linea ${index + 1}: no se reconocio "${line}".`);
  }

  return {
    items: items.filter((item) => item.sessionDay),
    warnings,
  };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function escapeCsvCell(value: string | number | null | undefined) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatPercent(value: number | null | undefined) {
  return value == null ? '-' : `${value.toFixed(1)}%`;
}

function nrcDigitsSuffix(nrc: string) {
  return nrc.replace(/\D/g, '');
}

function nrcEndsWith(systemNrc: string, requestedNrc: string) {
  return nrcDigitsSuffix(systemNrc).endsWith(nrcDigitsSuffix(requestedNrc));
}

function matchRequestItems(items: RequestItem[], row: AttendanceStudentReportResponse['rows'][number]) {
  return items.filter((item) => item.sessionDay === row.sessionDay && nrcEndsWith(row.nrc, item.nrc));
}

const PlayIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>;
const DownloadIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>;
const AlertIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>;
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>;
const CalendarIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>;
const FileTextIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>;

export default function BienestarAttendancePanel({ apiBase }: BienestarAttendancePanelProps) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [requestText, setRequestText] = useState(SAMPLE_TEXT);
  const [report, setReport] = useState<AttendanceStudentReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const parsed = useMemo(() => parseRequestText(requestText, year), [requestText, year]);
  const dates = useMemo(() => unique(parsed.items.map((item) => item.sessionDay)), [parsed.items]);
  const nrcs = useMemo(() => unique(parsed.items.map((item) => item.nrc)), [parsed.items]);

  const enrichedRows = useMemo<EnrichedRow[]>(() => {
    if (!report) return [];
    return report.rows.flatMap((row) => {
      const matches = matchRequestItems(parsed.items, row);
      return matches.map((item) => ({
        ...row,
        activity: item.activity,
        shift: item.shift,
        requestedNrc: item.nrc,
      }));
    });
  }, [parsed.items, report]);

  const missingItems = useMemo(() => {
    if (!report) return [];
    return parsed.items.filter((item) =>
      !report.rows.some((row) => row.sessionDay === item.sessionDay && nrcEndsWith(row.nrc, item.nrc)),
    );
  }, [parsed.items, report]);

  async function generateReport() {
    if (!parsed.items.length) {
      setMessage('Pega la solicitud de Bienestar con actividad, jornada, fecha y NRC.');
      return;
    }

    try {
      setLoading(true);
      setMessage('');
      const params = new URLSearchParams();
      params.set('sessionDays', dates.join(','));
      params.set('nrcs', nrcs.join(','));
      const result = await fetchJson<AttendanceStudentReportResponse>(
        `${apiBase}/integrations/moodle-analytics/attendance/student-report?${params.toString()}`,
      );
      setReport(result);
      setMessage(`Reporte listo: ${result.summary.rowCount} registros encontrados en asistencia Moodle.`);
    } catch (error) {
      setMessage(`No se pudo generar el reporte: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!enrichedRows.length) return;
    const rows = [
      [
        'actividad',
        'jornada',
        'fecha',
        'sesion_moodle',
        'nrc_solicitado',
        'nrc_sistema',
        'periodo',
        'curso',
        'programa',
        'sede',
        'docente',
        'estudiante',
        'correo',
        'id_estudiante',
        'estado_asistencia',
        'codigo_estado',
        'valor_original',
      ].join(','),
    ];

    for (const row of enrichedRows) {
      rows.push(
        [
          row.activity,
          row.shift,
          row.sessionDay,
          row.sessionLabel,
          row.requestedNrc,
          row.nrc,
          row.periodCode,
          row.subjectName ?? '',
          row.programName ?? '',
          row.campusCode ?? '',
          row.teacherName ?? '',
          row.studentName,
          row.studentEmail ?? '',
          row.studentId ?? '',
          row.statusLabel,
          row.statusCode ?? '',
          row.rawValue ?? '',
        ]
          .map((value) => escapeCsvCell(value))
          .join(','),
      );
    }

    const blob = new Blob(['\uFEFF', `${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `reporte_bienestar_asistencia_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadPresentStudentsCsv() {
    const presentRows = enrichedRows.filter((row) => row.statusCode === 'A');
    if (!presentRows.length) return;

    const rows = [['nrc', 'fecha', 'id', 'nombre_estudiante', 'correo_institucional'].join(',')];
    for (const row of presentRows) {
      rows.push(
        [
          row.requestedNrc,
          row.sessionDay,
          row.studentId ?? '',
          row.studentName,
          row.studentEmail ?? '',
        ]
          .map((value) => escapeCsvCell(value))
          .join(','),
      );
    }

    const blob = new Blob(['\uFEFF', `${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bienestar_presentes_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const hasPresentRows = enrichedRows.some((row) => row.statusCode === 'A');
  const isError = message.startsWith('No se pudo');

  return (
    <div className="premium-card">
      <PageHero
        title="Asistencia a Eventos de Bienestar"
        description="Pega el bloque de texto con la programación de actividades. El sistema cruzará cada actividad, jornada, fecha y NRC con los registros de asistencia en Moodle."
      />

      <div className="panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '300px' }}>
            <label style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>Año de las fechas</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f9fafb', border: '1px solid #d1d5db', borderRadius: '0.375rem', padding: '0.5rem 0.75rem' }}>
              <CalendarIcon />
              <input
                value={year}
                onChange={(event) => setYear(event.target.value.replace(/\D/g, '').slice(0, 4))}
                style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.95rem', color: '#111827' }}
              />
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b7280' }}>Las fechas sin año usarán este valor.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>Texto de solicitud</label>
              <span style={{ fontSize: '0.8rem', color: '#6b7280', background: '#f3f4f6', padding: '0.1rem 0.5rem', borderRadius: '1rem' }}>
                {parsed.items.length} NRCs detectados
              </span>
            </div>
            <textarea
              value={requestText}
              onChange={(event) => setRequestText(event.target.value)}
              rows={10}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.9rem', fontFamily: 'monospace', lineHeight: 1.5, resize: 'vertical', outlineColor: '#1b3a6b' }}
            />
          </div>
        </div>

        {parsed.warnings.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <AlertBox tone="warn">
              <strong>Advertencias en la lectura del texto</strong>
              <ul style={{ margin: '0.25rem 0 0 0', paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {parsed.warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
                {parsed.warnings.length > 4 && <li>... y {parsed.warnings.length - 4} más.</li>}
              </ul>
            </AlertBox>
          </div>
        )}

        <div style={{ marginTop: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', borderTop: '1px solid #e5e7eb', paddingTop: '1.5rem' }}>
          <Button
            variant="primary"
            size="sm"
            loading={loading}
            disabled={loading || !parsed.items.length}
            onClick={() => void generateReport()}
          >
            {loading ? 'Procesando Moodle...' : 'Generar reporte'}
          </Button>

          <Button
            variant="primary"
            size="sm"
            disabled={!hasPresentRows}
            onClick={downloadPresentStudentsCsv}
          >
            Descargar presentes
          </Button>

          <Button
            variant="secondary"
            size="sm"
            disabled={!enrichedRows.length}
            onClick={downloadCsv}
          >
            Descargar CSV completo
          </Button>
        </div>

        {message && (
          <div style={{ marginTop: '1rem' }}>
            <AlertBox tone={isError ? 'error' : 'success'}>{message}</AlertBox>
          </div>
        )}
      </div>

      {report && (
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <StatsGrid items={[
            { label: 'NRCs Solicitados', value: nrcs.length, help: `${parsed.items.length} cruces fecha/NRC`, tone: 'default' },
            { label: 'Asistencia Global', value: formatPercent(report.summary.attendanceRate), help: `${report.summary.presentCount} presentes / ${report.summary.rowCount} total`, tone: report.summary.attendanceRate != null && report.summary.attendanceRate >= 70 ? 'ok' : 'warn' },
            { label: 'Registros Encontrados', value: report.summary.rowCount, help: 'Estudiantes en lista Moodle', tone: 'default' },
            { label: 'Sin Cruce', value: missingItems.length, help: 'Fechas/NRC no hallados', tone: missingItems.length > 0 ? 'danger' : 'default' },
          ]} />
        </div>
      )}

      {report ? (
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#122850', fontSize: '1.1rem' }}>Resultado de asistencia</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="fast-table">
              <thead>
                <tr>
                  <th>Actividad</th>
                  <th>Fecha</th>
                  <th>NRC</th>
                  <th>Estudiante</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {enrichedRows.slice(0, 100).map((row, index) => (
                  <tr key={`bienestar-row-${row.sessionDay}-${row.nrc}-${row.studentName}-${index}`}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{row.activity}</div>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{row.shift}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{row.sessionDay}</td>
                    <td>
                      <span style={{ background: '#eef2ff', color: '#3730a3', padding: '0.1rem 0.5rem', borderRadius: '0.25rem', fontFamily: 'monospace' }}>{row.requestedNrc}</span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{row.studentName}</div>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                        {row.studentEmail ?? '-'}
                        {row.studentId ? ` · ${row.studentId}` : ''}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        background: row.statusCode === 'A' ? '#dcfce7' : row.statusCode === 'P' ? '#fee2e2' : '#f3f4f6',
                        color: row.statusCode === 'A' ? '#166534' : row.statusCode === 'P' ? '#991b1b' : '#374151',
                        padding: '0.25rem 0.5rem', borderRadius: '1rem', fontSize: '0.8rem', fontWeight: 600,
                      }}>
                        {row.statusLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {enrichedRows.length > 100 && (
            <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '0.9rem', marginTop: '0.75rem' }}>
              Mostrando los primeros 100 de {enrichedRows.length}. Usa los botones de descarga para el listado completo.
            </p>
          )}

          {missingItems.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <AlertBox tone="error">
                <strong>{missingItems.length} NRCs/Fechas sin registros de asistencia</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {missingItems.map((item, index) => (
                    <span key={index} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.85rem' }}>
                      {item.nrc} ({item.sessionDay})
                    </span>
                  ))}
                </div>
              </AlertBox>
            </div>
          )}
        </div>
      ) : (
        <div className="panel-body" style={{ paddingTop: 0 }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#122850', fontSize: '1.1rem' }}>Vista previa de la solicitud</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="fast-table">
              <thead>
                <tr>
                  <th>Actividad</th>
                  <th>Jornada</th>
                  <th>Fecha</th>
                  <th>NRC</th>
                </tr>
              </thead>
              <tbody>
                {parsed.items.length > 0 ? (
                  parsed.items.map((item, index) => (
                    <tr key={`preview-${item.sessionDay}-${item.nrc}-${index}`}>
                      <td>{item.activity}</td>
                      <td>{item.shift}</td>
                      <td>{item.sessionDay}</td>
                      <td>
                        <span style={{ background: '#f3f4f6', color: '#374151', padding: '0.1rem 0.5rem', borderRadius: '0.25rem', fontFamily: 'monospace' }}>{item.nrc}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: '#6b7280' }}>
                      No se detectaron NRCs válidos en el texto.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
