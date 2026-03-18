'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type AnalyticsOptionsResponse = {
  ok: boolean;
  filters: {
    periodCodes: string[];
    programCodes: string[];
    campusCodes: string[];
    teacherIds: string[];
    nrcs: string[];
  };
  totals: {
    attendanceCourses: number;
    activityCourses: number;
    participantCourses: number;
    bannerEnrollmentCourses: number;
  };
  periods: Array<{ code: string; label: string; semester: number | null; count: number }>;
  programs: Array<{ code: string; label: string; count: number }>;
  campuses: Array<{ code: string; count: number }>;
  teachers: Array<{ id: string; fullName: string; count: number }>;
  sessionDays: string[];
};

type AnalyticsOverviewResponse = {
  ok: boolean;
  attendance: {
    courseCount: number;
    studentCount: number;
    sessionCount: number;
    presentCount: number;
    absentCount: number;
    justifiedCount: number;
    unknownCount: number;
    trackedEntries: number;
    attendanceRate: number | null;
    inattendanceRate: number | null;
    byDay: Array<{
      day: string;
      present: number;
      absent: number;
      justified: number;
      unknown: number;
      tracked: number;
      attendanceRate: number | null;
      inattendanceRate: number | null;
    }>;
    byProgram: Array<{
      key: string;
      label: string;
      courseCount: number;
      studentCount: number;
      attendanceRate: number | null;
      inattendanceRate: number | null;
      presentCount: number;
      absentCount: number;
    }>;
    byCampus: Array<{
      key: string;
      label: string;
      courseCount: number;
      studentCount: number;
      attendanceRate: number | null;
      inattendanceRate: number | null;
      presentCount: number;
      absentCount: number;
    }>;
    worstCourses: Array<{
      nrc: string;
      subjectName: string | null;
      programName: string | null;
      campusCode: string | null;
      teacherName: string | null;
      studentCount: number;
      trackedEntries: number;
      attendanceRate: number | null;
      inattendanceRate: number | null;
      absentCount: number;
      presentCount: number;
    }>;
  };
  activity: {
    courseCount: number;
    reportCount: number;
    totalEvents: number;
    summedUniqueUsers: number;
    byDay: Array<{ day: string; count: number }>;
    byComponent: Array<{ key: string; value: number }>;
    byEventName: Array<{ key: string; value: number }>;
    byActorCategory: Array<{ key: string; value: number }>;
    topCourses: Array<{
      nrc: string;
      subjectName: string | null;
      programName: string | null;
      campusCode: string | null;
      teacherName: string | null;
      events: number;
      users: number;
    }>;
  };
  participants: {
    courseCount: number;
    reportCount: number;
    totalParticipants: number;
    byActorCategory: Array<{ key: string; value: number }>;
    byRole: Array<{ key: string; value: number }>;
  };
  enrollment: {
    courseCount: number;
    reportCount: number;
    totalStudents: number;
  };
  alerts: {
    totals: {
      courseCount: number;
      userCount: number;
      bannerRosterCourses: number;
      activityActorsOutsideRoster: number;
      activityUnclassified: number;
      participantUnusualRoles: number;
      studentsWithoutActivity: number;
      studentsWithoutAttendance: number;
    };
    byType: Array<{ key: string; label: string; count: number; courseCount: number }>;
    byProgram: Array<{ key: string; label: string; count: number; courseCount: number }>;
    byCampus: Array<{ key: string; label: string; count: number; courseCount: number }>;
    courses: Array<{
      nrc: string;
      subjectName: string | null;
      programName: string | null;
      campusCode: string | null;
      teacherName: string | null;
      rosterSource: 'BANNER' | 'MOODLE_PARTICIPANTS' | 'SIN_ROSTER';
      outsideRosterActors: number;
      unclassifiedActors: number;
      unusualRoleParticipants: number;
      studentsWithoutActivity: number;
      studentsWithoutAttendance: number;
      totalAlerts: number;
      riskScore: number;
      riskLevel: string;
    }>;
    users: Array<{
      kind: string;
      kindLabel: string;
      nrc: string;
      subjectName: string | null;
      programName: string | null;
      campusCode: string | null;
      teacherName: string | null;
      fullName: string;
      email: string | null;
      institutionalId: string | null;
      actorCategory: string | null;
      rolesLabel: string | null;
      count: number;
      detail: string;
    }>;
  };
};

type AttendanceDateReportResponse = {
  ok: boolean;
  summary: {
    courseCount: number;
    participantCount: number;
    presentCount: number;
    absentCount: number;
    justifiedCount: number;
    unknownCount: number;
    attendanceRate: number | null;
    inattendanceRate: number | null;
  };
  courses: Array<{
    nrc: string;
    subjectName: string | null;
    programName: string | null;
    campusCode: string | null;
    teacherName: string | null;
    periodCode: string;
    participantCount: number;
    presentCount: number;
    absentCount: number;
    justifiedCount: number;
    unknownCount: number;
    attendanceRate: number | null;
    inattendanceRate: number | null;
    sessionLabels: string[];
    presentStudents: Array<{
      fullName: string;
      email: string | null;
      institutionalId: string | null;
    }>;
  }>;
};

type MoodlAnalyticsPanelProps = {
  apiBase: string;
};

type FilterState = {
  periodCodes: string[];
  programCodes: string[];
  campusCodes: string[];
  teacherIds: string[];
  nrcsText: string;
  sessionDay: string;
};

function toggleSelection(current: string[], value: string) {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function formatPercent(value: number | null | undefined) {
  return value == null ? '-' : `${value.toFixed(1)}%`;
}

function parseNrcList(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function escapeCsvCell(value: string | number | null | undefined) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildQuery(filters: FilterState) {
  const params = new URLSearchParams();
  if (filters.periodCodes.length) params.set('periodCodes', filters.periodCodes.join(','));
  if (filters.programCodes.length) params.set('programCodes', filters.programCodes.join(','));
  if (filters.campusCodes.length) params.set('campusCodes', filters.campusCodes.join(','));
  if (filters.teacherIds.length) params.set('teacherIds', filters.teacherIds.join(','));
  const nrcs = parseNrcList(filters.nrcsText);
  if (nrcs.length) params.set('nrcs', nrcs.join(','));
  return params;
}

function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warm' | 'danger' | 'cool';
}) {
  return (
    <article className={`analytics-card analytics-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

function BarList({
  title,
  items,
  accent = 'var(--accent)',
  suffix = '',
}: {
  title: string;
  items: Array<{ label: string; value: number; meta?: string }>;
  accent?: string;
  suffix?: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <section className="analytics-panel">
      <div className="analytics-panel-head">
        <h3>{title}</h3>
      </div>
      <div className="bar-list">
        {items.length ? (
          items.map((item) => (
            <div className="bar-row" key={`${title}-${item.label}`}>
              <div>
                <strong>{item.label}</strong>
                {item.meta ? <small>{item.meta}</small> : null}
              </div>
              <div className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.max(6, (item.value / max) * 100)}%`, background: accent }} />
              </div>
              <div className="bar-value">
                {item.value}
                {suffix}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">Sin datos para este bloque.</div>
        )}
      </div>
    </section>
  );
}

function DayBars({
  title,
  items,
  tone = 'warm',
}: {
  title: string;
  items: Array<{ day: string; count: number; secondary?: number }>;
  tone?: 'warm' | 'cool';
}) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <section className="analytics-panel">
      <div className="analytics-panel-head">
        <h3>{title}</h3>
      </div>
      <div className="day-bars">
        {items.length ? (
          items.map((item) => (
            <div className="day-bar" key={`${title}-${item.day}`}>
              <div
                className={`day-bar-fill ${tone}`}
                style={{ height: `${Math.max(10, (item.count / max) * 100)}%` }}
                title={`${item.day}: ${item.count}`}
              />
              <span>{item.day.slice(5)}</span>
            </div>
          ))
        ) : (
          <div className="empty-state">Sin serie temporal.</div>
        )}
      </div>
    </section>
  );
}

export default function MoodleAnalyticsPanel({ apiBase }: MoodlAnalyticsPanelProps) {
  const [options, setOptions] = useState<AnalyticsOptionsResponse | null>(null);
  const [overview, setOverview] = useState<AnalyticsOverviewResponse | null>(null);
  const [dateReport, setDateReport] = useState<AttendanceDateReportResponse | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);
  const [importingKind, setImportingKind] = useState<'attendance' | 'activity' | 'participants' | 'banner-enrollment' | null>(null);
  const [bannerImportPath, setBannerImportPath] = useState('');
  const [bannerImportPeriodCode, setBannerImportPeriodCode] = useState('');
  const [bannerImportNrc, setBannerImportNrc] = useState('');
  const [bannerImportSourceLabel, setBannerImportSourceLabel] = useState('');

  const [filters, setFilters] = useState<FilterState>({
    periodCodes: [],
    programCodes: [],
    campusCodes: [],
    teacherIds: [],
    nrcsText: '',
    sessionDay: '',
  });

  const nrcCount = useMemo(() => parseNrcList(filters.nrcsText).length, [filters.nrcsText]);

  async function loadOptionsAndOverview(nextFilters: FilterState) {
    try {
      setLoading(true);
      setMessage('');
      const params = buildQuery(nextFilters);
      const [nextOptions, nextOverview] = await Promise.all([
        fetchJson<AnalyticsOptionsResponse>(`${apiBase}/integrations/moodle-analytics/options?${params.toString()}`),
        fetchJson<AnalyticsOverviewResponse>(`${apiBase}/integrations/moodle-analytics/overview?${params.toString()}`),
      ]);
      setOptions(nextOptions);
      setOverview(nextOverview);
      setDateReport(null);
      if (nextFilters.sessionDay && !nextOptions.sessionDays.includes(nextFilters.sessionDay)) {
        setFilters((current) => ({ ...current, sessionDay: '' }));
      }
    } catch (error) {
      setMessage(`No se pudo cargar la analitica: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOptionsAndOverview(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importLatest(kind: 'attendance' | 'activity' | 'participants' | 'banner-enrollment') {
    try {
      if (kind === 'banner-enrollment' && !bannerImportPath.trim()) {
        setMessage('Escribe la ruta del archivo oficial de matricula Banner antes de importarlo.');
        return;
      }
      setImportingKind(kind);
      setMessage('');
      const payload =
        kind === 'banner-enrollment'
          ? {
              inputPath: bannerImportPath.trim(),
              defaultPeriodCode: bannerImportPeriodCode.trim() || undefined,
              defaultNrc: bannerImportNrc.trim() || undefined,
              sourceLabel: bannerImportSourceLabel.trim() || undefined,
            }
          : {};
      await fetchJson(`${apiBase}/integrations/moodle-analytics/import/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setMessage(
        kind === 'attendance'
          ? 'Importacion de asistencia completada.'
          : kind === 'banner-enrollment'
            ? 'Matricula Banner importada. Las alertas ahora priorizan Banner donde exista esa matricula oficial.'
          : kind === 'participants'
            ? 'Importacion de participantes completada. Reimporta actividad si quieres recalcular roles en los logs.'
            : 'Importacion de actividad completada.',
      );
      await loadOptionsAndOverview(filters);
    } catch (error) {
      setMessage(`No se pudo importar ${kind}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImportingKind(null);
    }
  }

  async function loadDateReport() {
    if (!filters.sessionDay) {
      setMessage('Selecciona una fecha de asistencia antes de consultar el reporte puntual.');
      return;
    }
    try {
      setDateLoading(true);
      setMessage('');
      const params = buildQuery(filters);
      params.set('sessionDay', filters.sessionDay);
      const result = await fetchJson<AttendanceDateReportResponse>(
        `${apiBase}/integrations/moodle-analytics/attendance/date-report?${params.toString()}`,
      );
      setDateReport(result);
    } catch (error) {
      setMessage(`No se pudo cargar el reporte por fecha: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDateLoading(false);
    }
  }

  function exportDateReportCsv() {
    if (!dateReport?.courses.length) return;
    const rows = [
      [
        'fecha',
        'periodo',
        'nrc',
        'curso',
        'programa',
        'sede',
        'docente',
        'participantes',
        'presentes',
        'ausentes',
        'justificados',
        'attendance_rate',
        'student_name',
        'student_email',
        'student_id',
      ].join(','),
    ];

    for (const course of dateReport.courses) {
      const students = course.presentStudents.length ? course.presentStudents : [{ fullName: '', email: '', institutionalId: '' }];
      for (const student of students) {
        rows.push(
          [
            filters.sessionDay,
            course.periodCode,
            course.nrc,
            course.subjectName ?? '',
            course.programName ?? '',
            course.campusCode ?? '',
            course.teacherName ?? '',
            String(course.participantCount),
            String(course.presentCount),
            String(course.absentCount),
            String(course.justifiedCount),
            formatPercent(course.attendanceRate),
            student.fullName,
            student.email ?? '',
            student.institutionalId ?? '',
          ]
            .map((value) => escapeCsvCell(value))
            .join(','),
        );
      }
    }

    const blob = new Blob([`${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `reporte_asistencia_${filters.sessionDay}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportAlertsCsv() {
    if (!overview?.alerts.users.length) return;
    const rows = [
      [
        'tipo_alerta',
        'nrc',
        'curso',
        'programa',
        'sede',
        'docente',
        'usuario',
        'correo',
        'id_institucional',
        'categoria_actor',
        'rol_visible',
        'conteo',
        'detalle',
      ].join(','),
    ];

    for (const user of overview.alerts.users) {
      rows.push(
        [
          user.kindLabel,
          user.nrc,
          user.subjectName ?? '',
          user.programName ?? '',
          user.campusCode ?? '',
          user.teacherName ?? '',
          user.fullName,
          user.email ?? '',
          user.institutionalId ?? '',
          user.actorCategory ?? '',
          user.rolesLabel ?? '',
          String(user.count),
          user.detail,
        ]
          .map((value) => escapeCsvCell(value))
          .join(','),
      );
    }

    const blob = new Blob([`${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'seguimiento_alertas_moodle.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const attendanceDayBars = overview?.attendance.byDay.slice(-14).map((item) => ({
    day: item.day,
    count: item.present,
  })) ?? [];
  const activityDayBars = overview?.activity.byDay.slice(-14) ?? [];

  return (
    <div className="moodle-analytics-root">
      <section className="analytics-hero">
        <div>
          <p className="eyebrow">Moodle intelligence</p>
          <h2>Asistencia, inasistencia y actividad del aula en una sola capa analitica</h2>
          <p>
            Importa los exportes descargados por el sidecar, cruza los datos por curso, programa, sede y docente, y
            saca reportes puntuales por fecha para coordinacion o direccion academica.
          </p>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={() => void importLatest('attendance')} disabled={!!importingKind}>
            {importingKind === 'attendance' ? 'Importando asistencia...' : 'Importar ultima asistencia'}
          </button>
          <button type="button" onClick={() => void importLatest('participants')} disabled={!!importingKind}>
            {importingKind === 'participants' ? 'Importando participantes...' : 'Importar ultimos participantes'}
          </button>
          <button type="button" onClick={() => void importLatest('activity')} disabled={!!importingKind}>
            {importingKind === 'activity' ? 'Importando actividad...' : 'Importar ultima actividad'}
          </button>
          <button type="button" className="ghost" onClick={() => void loadOptionsAndOverview(filters)} disabled={loading}>
            {loading ? 'Actualizando...' : 'Actualizar analitica'}
          </button>
        </div>
      </section>

      {message ? <div className="message-strip">{message}</div> : null}

      <section className="analytics-panel banner-source-panel">
        <div className="analytics-panel-head">
          <h3>Matricula oficial Banner</h3>
          <small>Si este archivo existe, la analitica toma Banner como roster principal por NRC y periodo.</small>
        </div>
        <div className="banner-import-grid">
          <label className="filter-block filter-block-wide">
            <span>Ruta del archivo Banner</span>
            <input
              value={bannerImportPath}
              onChange={(event) => setBannerImportPath(event.target.value)}
              placeholder="storage/exports/banner_matricula_oficial.xlsx"
            />
          </label>
          <label className="filter-block">
            <span>Periodo por defecto</span>
            <input
              value={bannerImportPeriodCode}
              onChange={(event) => setBannerImportPeriodCode(event.target.value)}
              placeholder="202615"
            />
            <small>Usalo si el archivo no trae columna de periodo.</small>
          </label>
          <label className="filter-block">
            <span>NRC por defecto</span>
            <input value={bannerImportNrc} onChange={(event) => setBannerImportNrc(event.target.value)} placeholder="15-72305" />
            <small>Solo aplica si el export corresponde a un NRC puntual.</small>
          </label>
          <label className="filter-block filter-block-wide">
            <span>Etiqueta del corte</span>
            <input
              value={bannerImportSourceLabel}
              onChange={(event) => setBannerImportSourceLabel(event.target.value)}
              placeholder="matricula-banner-corte-marzo"
            />
            <small>Sirve para identificar la importacion en los snapshots internos.</small>
          </label>
          <div className="hero-actions" style={{ justifyContent: 'flex-start', alignSelf: 'end' }}>
            <button type="button" onClick={() => void importLatest('banner-enrollment')} disabled={!!importingKind}>
              {importingKind === 'banner-enrollment' ? 'Importando Banner...' : 'Importar matricula Banner'}
            </button>
          </div>
        </div>
      </section>

      <section className="analytics-panel filter-panel">
        <div className="analytics-panel-head">
          <h3>Filtros ejecutivos</h3>
          <small>Combina periodos, programas, sedes, docente y NRCs especificos.</small>
        </div>

        <div className="filter-grid">
          <div className="filter-block">
            <span>Periodos</span>
            <div className="chip-grid">
              {(options?.periods ?? []).map((period) => (
                <button
                  type="button"
                  key={period.code}
                  className={`chip-button${filters.periodCodes.includes(period.code) ? ' active' : ''}`}
                  onClick={() => setFilters((current) => ({ ...current, periodCodes: toggleSelection(current.periodCodes, period.code) }))}
                >
                  {period.code}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block">
            <span>Sedes</span>
            <div className="chip-grid">
              {(options?.campuses ?? []).map((campus) => (
                <button
                  type="button"
                  key={campus.code}
                  className={`chip-button${filters.campusCodes.includes(campus.code) ? ' active' : ''}`}
                  onClick={() => setFilters((current) => ({ ...current, campusCodes: toggleSelection(current.campusCodes, campus.code) }))}
                >
                  {campus.code}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-block filter-block-wide">
            <span>Programas</span>
            <div className="chip-grid chip-grid-tall">
              {(options?.programs ?? []).map((program) => (
                <button
                  type="button"
                  key={program.code}
                  className={`chip-button${filters.programCodes.includes(program.code) ? ' active' : ''}`}
                  onClick={() => setFilters((current) => ({ ...current, programCodes: toggleSelection(current.programCodes, program.code) }))}
                >
                  {program.label}
                </button>
              ))}
            </div>
          </div>

          <label className="filter-block">
            <span>Docente</span>
            <select
              multiple
              value={filters.teacherIds}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  teacherIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                }))
              }
            >
              {(options?.teachers ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-block filter-block-wide">
            <span>NRCs especificos</span>
            <textarea
              value={filters.nrcsText}
              onChange={(event) => setFilters((current) => ({ ...current, nrcsText: event.target.value }))}
              rows={3}
              placeholder="72305, 72308, 15-72314"
            />
            <small>{nrcCount ? `${nrcCount} NRC cargados para filtrar.` : 'Si lo dejas vacio, toma todos los cursos importados.'}</small>
          </label>

          <label className="filter-block">
            <span>Fecha puntual de asistencia</span>
            <select
              value={filters.sessionDay}
              onChange={(event) => setFilters((current) => ({ ...current, sessionDay: event.target.value }))}
            >
              <option value="">Selecciona una fecha</option>
              {(options?.sessionDays ?? []).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="hero-actions" style={{ marginTop: 18 }}>
          <button type="button" onClick={() => void loadOptionsAndOverview(filters)} disabled={loading}>
            {loading ? 'Aplicando...' : 'Aplicar filtros'}
          </button>
          <button type="button" className="ghost" onClick={() => void loadDateReport()} disabled={dateLoading}>
            {dateLoading ? 'Consultando fecha...' : 'Consultar reporte del dia'}
          </button>
          <button type="button" className="ghost" onClick={exportDateReportCsv} disabled={!dateReport?.courses.length}>
            Descargar CSV del reporte diario
          </button>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard
          label="Cursos con asistencia"
          value={overview?.attendance.courseCount ?? '-'}
          hint={`${overview?.attendance.studentCount ?? 0} estudiantes en snapshots`}
          tone="warm"
        />
        <MetricCard
          label="Asistencia global"
          value={formatPercent(overview?.attendance.attendanceRate)}
          hint={`${overview?.attendance.presentCount ?? 0} presentes registrados`}
          tone="cool"
        />
        <MetricCard
          label="Inasistencia global"
          value={formatPercent(overview?.attendance.inattendanceRate)}
          hint={`${overview?.attendance.absentCount ?? 0} ausencias`}
          tone="danger"
        />
        <MetricCard
          label="Eventos de actividad"
          value={overview?.activity.totalEvents ?? '-'}
          hint={`${overview?.activity.courseCount ?? 0} cursos con CSV importado`}
          tone="default"
        />
        <MetricCard
          label="Usuarios activos detectados"
          value={overview?.activity.summedUniqueUsers ?? '-'}
          hint="Suma de usuarios unicos por curso"
          tone="default"
        />
        <MetricCard
          label="Cursos con participantes"
          value={overview?.participants.courseCount ?? '-'}
          hint={`${overview?.participants.totalParticipants ?? 0} participantes visibles`}
          tone="default"
        />
        <MetricCard
          label="Cursos con matricula Banner"
          value={overview?.enrollment.courseCount ?? '-'}
          hint={`${overview?.enrollment.totalStudents ?? 0} estudiantes oficiales`}
          tone="cool"
        />
        <MetricCard
          label="Sesiones de asistencia"
          value={overview?.attendance.sessionCount ?? '-'}
          hint={`${overview?.attendance.trackedEntries ?? 0} registros trazables`}
          tone="warm"
        />
      </section>

      <section className="analytics-panel">
        <div className="analytics-panel-head">
          <h3>Alertas de consistencia y seguimiento</h3>
          <small>
            Cruce entre participantes, asistencia y logs para detectar roles raros, huecos de clasificacion e
            inactividad.
          </small>
        </div>

        <div className="metric-grid compact">
          <MetricCard
            label="Cursos con alertas"
            value={overview?.alerts.totals.courseCount ?? '-'}
            hint={`${overview?.alerts.totals.userCount ?? 0} usuarios a revisar`}
            tone="danger"
          />
          <MetricCard
            label="Cursos usando Banner"
            value={overview?.alerts.totals.bannerRosterCourses ?? '-'}
            hint="Cruce contra matricula oficial"
            tone="cool"
          />
          <MetricCard
            label="Fuera del listado"
            value={overview?.alerts.totals.activityActorsOutsideRoster ?? '-'}
            hint="Actores en logs que no cruzan contra el roster de referencia"
            tone="danger"
          />
          <MetricCard
            label="No clasificados"
            value={overview?.alerts.totals.activityUnclassified ?? '-'}
            hint="Actores en logs sin categoria final"
            tone="danger"
          />
          <MetricCard
            label="Roles no academicos"
            value={overview?.alerts.totals.participantUnusualRoles ?? '-'}
            hint="Participantes con perfil admin, auditor o no clasificado"
            tone="default"
          />
          <MetricCard
            label="Sin actividad"
            value={overview?.alerts.totals.studentsWithoutActivity ?? '-'}
            hint="Estudiantes matriculados que no aparecen en logs"
            tone="warm"
          />
          <MetricCard
            label="Sin asistencia"
            value={overview?.alerts.totals.studentsWithoutAttendance ?? '-'}
            hint="Estudiantes matriculados que no aparecen en el export de asistencia"
            tone="warm"
          />
        </div>

        <div className="analytics-grid" style={{ marginTop: 16 }}>
          <BarList
            title="Alertas por tipo"
            items={(overview?.alerts.byType ?? []).map((item) => ({
              label: item.label,
              value: item.count,
              meta: `${item.courseCount} cursos`,
            }))}
            accent="linear-gradient(90deg, #991b1b, #dc2626)"
          />
          <BarList
            title="Programas con mayor concentracion de alertas"
            items={(overview?.alerts.byProgram ?? []).map((item) => ({
              label: item.label,
              value: item.count,
              meta: `${item.courseCount} cursos`,
            }))}
            accent="linear-gradient(90deg, #7c2d12, #ea580c)"
          />
        </div>

        <div className="analytics-grid" style={{ marginTop: 16 }}>
          <section className="analytics-panel analytics-panel-subtle">
            <div className="analytics-panel-head">
              <h3>Cursos a revisar</h3>
              <small>Ordenados por riesgo para seguimiento operativo.</small>
            </div>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Curso</th>
                  <th>Programa</th>
                  <th>Riesgo</th>
                  <th>Fuente</th>
                  <th>Total</th>
                  <th>Fuera lista</th>
                  <th>No clasificados</th>
                  <th>Sin actividad</th>
                  <th>Sin asistencia</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.alerts.courses ?? []).length ? (
                  overview?.alerts.courses.map((course) => (
                    <tr key={`alert-course-${course.nrc}`}>
                      <td>{course.nrc}</td>
                      <td>{course.subjectName ?? '-'}</td>
                      <td>{course.programName ?? '-'}</td>
                      <td>
                        <span className={`risk-text risk-${course.riskLevel.toLowerCase()}`}>{course.riskLevel}</span>
                      </td>
                      <td>{course.rosterSource === 'BANNER' ? 'Banner' : course.rosterSource === 'MOODLE_PARTICIPANTS' ? 'Moodle' : '-'}</td>
                      <td>{course.totalAlerts}</td>
                      <td>{course.outsideRosterActors}</td>
                      <td>{course.unclassifiedActors}</td>
                      <td>{course.studentsWithoutActivity}</td>
                      <td>{course.studentsWithoutAttendance}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="empty-table-cell">
                      No hay cursos con alertas para los filtros actuales.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="analytics-panel analytics-panel-subtle">
            <div className="analytics-panel-head">
              <h3>Usuarios a revisar</h3>
              <small>Casos concretos para seguimiento manual y depuracion.</small>
            </div>
            <div className="hero-actions" style={{ marginBottom: 12, justifyContent: 'flex-start' }}>
              <button type="button" className="ghost" onClick={exportAlertsCsv} disabled={!overview?.alerts.users.length}>
                Descargar CSV de alertas
              </button>
            </div>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>NRC</th>
                  <th>Usuario</th>
                  <th>Categoria / rol</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.alerts.users ?? []).length ? (
                  overview?.alerts.users.map((user, index) => (
                    <tr key={`alert-user-${user.nrc}-${user.fullName}-${index}`}>
                      <td>{user.kindLabel}</td>
                      <td>{user.nrc}</td>
                      <td>
                        <strong>{user.fullName}</strong>
                        <div className="table-support">
                          {user.email ?? '-'}
                          {user.institutionalId ? ` · ${user.institutionalId}` : ''}
                        </div>
                      </td>
                      <td>{user.rolesLabel ?? user.actorCategory ?? '-'}</td>
                      <td>
                        {user.detail}
                        {user.count > 0 ? <div className="table-support">{user.count} eventos</div> : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="empty-table-cell">
                      No hay usuarios marcados para seguimiento con los filtros actuales.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      </section>

      <div className="analytics-grid">
        <DayBars title="Presencias por fecha" items={attendanceDayBars} tone="warm" />
        <DayBars title="Actividad por fecha" items={activityDayBars} tone="cool" />
        <BarList
          title="Programas con mayor inasistencia"
          items={(overview?.attendance.byProgram ?? []).map((item) => ({
            label: item.label,
            value: item.inattendanceRate ?? 0,
            meta: `${item.courseCount} cursos · ${item.studentCount} estudiantes`,
          }))}
          accent="linear-gradient(90deg, #c2410c, #f97316)"
          suffix="%"
        />
        <BarList
          title="Sedes con mayor inasistencia"
          items={(overview?.attendance.byCampus ?? []).map((item) => ({
            label: item.label,
            value: item.inattendanceRate ?? 0,
            meta: `${item.courseCount} cursos`,
          }))}
          accent="linear-gradient(90deg, #0f766e, #14b8a6)"
          suffix="%"
        />
      </div>

      <div className="analytics-grid">
        <section className="analytics-panel">
          <div className="analytics-panel-head">
            <h3>Cursos que mas concentran inasistencia</h3>
            <small>Usalo para escalar priorizacion y acompanamiento.</small>
          </div>
          <table className="analytics-table">
            <thead>
              <tr>
                <th>NRC</th>
                <th>Curso</th>
                <th>Programa</th>
                <th>Inasistencia</th>
                <th>Presentes</th>
                <th>Ausentes</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.attendance.worstCourses ?? []).map((course) => (
                <tr key={`worst-${course.nrc}`}>
                  <td>{course.nrc}</td>
                  <td>{course.subjectName ?? '-'}</td>
                  <td>{course.programName ?? '-'}</td>
                  <td>{formatPercent(course.inattendanceRate)}</td>
                  <td>{course.presentCount}</td>
                  <td>{course.absentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="analytics-panel">
          <div className="analytics-panel-head">
            <h3>Actividad dentro del aula</h3>
            <small>Lectura rapida para coordinacion academica y monitoreo de uso.</small>
          </div>
          <div className="stacked-lists">
            <BarList
              title="Participantes por categoria"
              items={(overview?.participants.byActorCategory ?? []).map((item) => ({ label: item.key, value: item.value }))}
              accent="linear-gradient(90deg, #57534e, #a8a29e)"
            />
            <BarList
              title="Componentes mas usados"
              items={(overview?.activity.byComponent ?? []).map((item) => ({ label: item.key, value: item.value }))}
              accent="linear-gradient(90deg, #1d4ed8, #38bdf8)"
            />
            <BarList
              title="Categorias de actor"
              items={(overview?.activity.byActorCategory ?? []).map((item) => ({ label: item.key, value: item.value }))}
              accent="linear-gradient(90deg, #4f46e5, #818cf8)"
            />
          </div>
        </section>
      </div>

      <section className="analytics-panel">
        <div className="analytics-panel-head">
          <h3>Reporte puntual por fecha de asistencia</h3>
          <small>
            Selecciona una fecha y el sistema te devuelve los NRC, los participantes del curso y los estudiantes que
            estuvieron presentes ese dia.
          </small>
        </div>

        <div className="metric-grid compact">
          <MetricCard label="Cursos ese dia" value={dateReport?.summary.courseCount ?? '-'} tone="warm" />
          <MetricCard label="Participantes" value={dateReport?.summary.participantCount ?? '-'} tone="default" />
          <MetricCard label="Presentes" value={dateReport?.summary.presentCount ?? '-'} tone="cool" />
          <MetricCard label="Ausentes" value={dateReport?.summary.absentCount ?? '-'} tone="danger" />
          <MetricCard label="Asistencia del dia" value={formatPercent(dateReport?.summary.attendanceRate)} tone="warm" />
          <MetricCard label="Inasistencia del dia" value={formatPercent(dateReport?.summary.inattendanceRate)} tone="danger" />
        </div>

        <div className="course-report-list">
          {(dateReport?.courses ?? []).length ? (
            dateReport?.courses.map((course) => (
              <details className="course-report-item" key={`date-course-${course.nrc}`}>
                <summary>
                  <div>
                    <strong>
                      {course.nrc} · {course.subjectName ?? 'Sin nombre'}
                    </strong>
                    <small>
                      {course.programName ?? 'Sin programa'} · {course.campusCode ?? 'Sin sede'} · {course.teacherName ?? 'Sin docente'}
                    </small>
                  </div>
                  <div className="summary-metrics">
                    <span>{course.participantCount} participantes</span>
                    <span>{course.presentCount} presentes</span>
                    <span>{formatPercent(course.attendanceRate)}</span>
                  </div>
                </summary>
                <div className="report-card-body">
                  <div className="badge-strip">
                    {course.sessionLabels.map((label) => (
                      <span className="mini-badge" key={`${course.nrc}-${label}`}>
                        {label}
                      </span>
                    ))}
                  </div>
                  <table className="analytics-table nested">
                    <thead>
                      <tr>
                        <th>Nombre completo</th>
                        <th>Correo</th>
                        <th>ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {course.presentStudents.map((student) => (
                        <tr key={`${course.nrc}-${student.fullName}-${student.institutionalId ?? 'sin-id'}`}>
                          <td>{student.fullName}</td>
                          <td>{student.email ?? '-'}</td>
                          <td>{student.institutionalId ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))
          ) : (
            <div className="empty-state">Todavia no hay un reporte puntual cargado para la fecha seleccionada.</div>
          )}
        </div>
      </section>

      <style jsx>{`
        .moodle-analytics-root {
          --accent: linear-gradient(90deg, #c2410c, #fb923c);
          display: grid;
          gap: 18px;
        }

        .analytics-hero,
        .analytics-panel,
        .analytics-card {
          border: 1px solid rgba(148, 163, 184, 0.2);
          background:
            radial-gradient(circle at top right, rgba(251, 146, 60, 0.12), transparent 34%),
            linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.92));
          box-shadow: 0 18px 50px rgba(2, 6, 23, 0.24);
        }

        .analytics-hero {
          display: grid;
          grid-template-columns: 1.4fr 0.9fr;
          gap: 20px;
          padding: 24px;
          border-radius: 26px;
        }

        .eyebrow {
          margin: 0 0 6px;
          color: #f59e0b;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          font-size: 0.74rem;
        }

        .analytics-hero h2 {
          margin: 0;
          font-size: clamp(1.7rem, 2vw, 2.4rem);
          line-height: 1.06;
        }

        .analytics-hero p {
          margin: 10px 0 0;
          max-width: 68ch;
          color: rgba(226, 232, 240, 0.84);
        }

        .hero-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-content: flex-start;
          justify-content: flex-end;
        }

        .hero-actions button,
        .chip-button {
          border: 1px solid rgba(251, 146, 60, 0.22);
          background: rgba(15, 23, 42, 0.72);
          color: #f8fafc;
          border-radius: 999px;
          padding: 10px 14px;
          cursor: pointer;
          transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
        }

        .hero-actions button:hover,
        .chip-button:hover {
          transform: translateY(-1px);
          border-color: rgba(251, 146, 60, 0.5);
        }

        .hero-actions .ghost {
          border-color: rgba(148, 163, 184, 0.25);
        }

        .message-strip {
          border-radius: 18px;
          padding: 12px 16px;
          background: rgba(15, 23, 42, 0.88);
          border: 1px solid rgba(251, 191, 36, 0.28);
          color: #fde68a;
        }

        .filter-panel {
          padding: 20px;
          border-radius: 24px;
        }

        .banner-source-panel {
          padding: 20px;
          border-radius: 24px;
        }

        .analytics-panel {
          padding: 18px;
          border-radius: 24px;
        }

        .analytics-panel-subtle {
          background: rgba(2, 6, 23, 0.28);
          border-color: rgba(148, 163, 184, 0.14);
          box-shadow: none;
        }

        .analytics-panel-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: baseline;
          margin-bottom: 14px;
        }

        .analytics-panel-head h3 {
          margin: 0;
          font-size: 1.05rem;
        }

        .analytics-panel-head small {
          color: rgba(226, 232, 240, 0.66);
        }

        .filter-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .banner-import-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) repeat(2, minmax(180px, 0.45fr)) auto;
          gap: 14px;
          align-items: end;
        }

        .filter-block {
          display: grid;
          gap: 8px;
        }

        .filter-block-wide {
          grid-column: span 2;
        }

        .filter-block span {
          font-size: 0.82rem;
          color: rgba(226, 232, 240, 0.72);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .chip-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .chip-grid-tall {
          max-height: 170px;
          overflow: auto;
          padding-right: 6px;
        }

        .chip-button.active {
          background: linear-gradient(90deg, rgba(194, 65, 12, 0.95), rgba(249, 115, 22, 0.84));
          border-color: transparent;
        }

        .filter-block input,
        .filter-block textarea,
        .filter-block select {
          width: 100%;
          border-radius: 16px;
          border: 1px solid rgba(148, 163, 184, 0.24);
          background: rgba(2, 6, 23, 0.4);
          color: #f8fafc;
          padding: 12px 14px;
        }

        .filter-block small {
          color: rgba(226, 232, 240, 0.56);
        }

        .metric-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 14px;
        }

        .metric-grid.compact {
          grid-template-columns: repeat(6, minmax(0, 1fr));
          margin-bottom: 16px;
        }

        .analytics-card {
          padding: 18px;
          border-radius: 22px;
          display: grid;
          gap: 6px;
        }

        .analytics-card span {
          color: rgba(226, 232, 240, 0.68);
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .analytics-card strong {
          font-size: clamp(1.3rem, 1.9vw, 2rem);
          line-height: 1;
        }

        .analytics-card small {
          color: rgba(226, 232, 240, 0.56);
        }

        .analytics-card-warm {
          border-color: rgba(251, 146, 60, 0.24);
        }

        .analytics-card-danger {
          border-color: rgba(248, 113, 113, 0.28);
        }

        .analytics-card-cool {
          border-color: rgba(56, 189, 248, 0.28);
        }

        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .day-bars {
          min-height: 220px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(18px, 1fr));
          gap: 8px;
          align-items: end;
        }

        .day-bar {
          display: grid;
          gap: 6px;
          align-items: end;
          justify-items: center;
        }

        .day-bar-fill {
          width: 100%;
          border-radius: 999px 999px 8px 8px;
          background: linear-gradient(180deg, rgba(251, 146, 60, 0.92), rgba(194, 65, 12, 0.82));
          min-height: 14px;
        }

        .day-bar-fill.cool {
          background: linear-gradient(180deg, rgba(56, 189, 248, 0.92), rgba(37, 99, 235, 0.8));
        }

        .day-bar span {
          font-size: 0.7rem;
          color: rgba(226, 232, 240, 0.65);
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }

        .bar-list {
          display: grid;
          gap: 12px;
        }

        .bar-row {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.1fr) auto;
          gap: 12px;
          align-items: center;
        }

        .bar-row strong {
          display: block;
        }

        .bar-row small {
          color: rgba(226, 232, 240, 0.56);
        }

        .bar-track {
          height: 10px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.14);
          overflow: hidden;
        }

        .bar-fill {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: var(--accent);
        }

        .bar-value {
          font-variant-numeric: tabular-nums;
          color: rgba(248, 250, 252, 0.9);
        }

        .stacked-lists {
          display: grid;
          gap: 16px;
        }

        .analytics-table {
          width: 100%;
          border-collapse: collapse;
        }

        .analytics-table th,
        .analytics-table td {
          padding: 10px 8px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.14);
          text-align: left;
          vertical-align: top;
        }

        .analytics-table th {
          color: rgba(226, 232, 240, 0.68);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .table-support {
          margin-top: 4px;
          color: rgba(226, 232, 240, 0.56);
          font-size: 0.78rem;
        }

        .empty-table-cell {
          color: rgba(226, 232, 240, 0.56);
          padding: 18px 8px;
        }

        .risk-text {
          font-weight: 700;
          letter-spacing: 0.03em;
        }

        .risk-alto {
          color: #fca5a5;
        }

        .risk-medio {
          color: #fdba74;
        }

        .risk-bajo {
          color: #fde68a;
        }

        .risk-sin_alertas {
          color: rgba(226, 232, 240, 0.56);
        }

        .course-report-list {
          display: grid;
          gap: 10px;
        }

        .course-report-item {
          border-radius: 18px;
          border: 1px solid rgba(148, 163, 184, 0.16);
          background: rgba(2, 6, 23, 0.28);
          overflow: hidden;
        }

        .course-report-item summary {
          list-style: none;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          padding: 14px 16px;
          cursor: pointer;
        }

        .course-report-item summary::-webkit-details-marker {
          display: none;
        }

        .course-report-item summary small {
          display: block;
          margin-top: 4px;
          color: rgba(226, 232, 240, 0.56);
        }

        .summary-metrics {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
          color: rgba(248, 250, 252, 0.88);
        }

        .report-card-body {
          padding: 0 16px 16px;
        }

        .badge-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }

        .mini-badge {
          border-radius: 999px;
          padding: 6px 10px;
          background: rgba(249, 115, 22, 0.16);
          color: #fdba74;
          font-size: 0.78rem;
        }

        .empty-state {
          padding: 14px 0;
          color: rgba(226, 232, 240, 0.56);
        }

        @media (max-width: 1200px) {
          .metric-grid,
          .metric-grid.compact {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .filter-grid,
          .analytics-grid,
          .analytics-hero,
          .banner-import-grid {
            grid-template-columns: 1fr;
          }

          .filter-block-wide {
            grid-column: span 1;
          }
        }

        @media (max-width: 780px) {
          .metric-grid,
          .metric-grid.compact {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .bar-row,
          .course-report-item summary {
            grid-template-columns: 1fr;
          }

          .summary-metrics,
          .hero-actions {
            justify-content: flex-start;
          }
        }
      `}</style>
    </div>
  );
}
