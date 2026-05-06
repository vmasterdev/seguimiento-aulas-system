'use client';

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { CourseRecord, OpsData } from './lib/types';

type ViewKey = 'overview' | 'courses' | 'integrations' | 'files';
type TeacherFilter = 'ALL' | 'WITH_TEACHER' | 'WITHOUT_TEACHER';
type StatusFilter = 'ALL' | 'OK' | 'PENDING' | 'ERROR';

const EMPTY_OPS_DATA: OpsData = {
  generatedAt: '',
  projectRoot: 'Pendiente de carga',
  bannerProjectRoot: 'Pendiente de carga',
  apiBase: 'http://127.0.0.1:3001',
  apiReachable: false,
  health: null,
  stats: null,
  queue: null,
  courses: {
    total: 0,
    items: [],
  },
  outbox: {
    total: 0,
    items: [],
  },
  sidecar: {
    config: null,
    runner: null,
    summary: {
      latestFile: null,
      modifiedAt: null,
      rowCount: 0,
      okCount: 0,
      errorCount: 0,
      emptyClassrooms: 0,
      typeCounts: {},
      statusCounts: {},
      participantAverage: null,
      preview: [],
      sampleByNrc: {},
    },
    urlValidation: {
      latestFile: null,
      modifiedAt: null,
      rowCount: 0,
      withUrlCount: 0,
      preview: [],
      sampleByNrc: {},
    },
  },
  banner: {
    runner: {
      running: false,
      current: null,
      lastRun: null,
      logTail: '',
      liveActivity: null,
    },
    exportSummary: {
      latestFile: null,
      modifiedAt: null,
      rowCount: 0,
      statusCounts: {},
      preview: [],
      sampleByNrc: {},
    },
  },
  files: [],
  derived: {
    withTeacher: 0,
    withoutTeacher: 0,
    moodleOk: 0,
    moodlePending: 0,
    moodleErrors: 0,
    withMoodleUrl: 0,
    withSidecarData: 0,
    bannerFound: 0,
    bannerWithoutTeacher: 0,
    outboxDrafts: 0,
    reviewExcluded: 0,
    attention: [],
  },
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es-CO');
}

function formatScore(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '-';
  return Number(value).toFixed(1).replace(/\.0$/, '');
}

function formatListMap(values: Record<string, number>) {
  return Object.entries(values).sort((left, right) => right[1] - left[1]);
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getCourseStatusBucket(course: CourseRecord): StatusFilter {
  const status = course.moodleCheck?.status ?? '';
  if (status === 'OK') return 'OK';
  if (['PENDIENTE', 'ERROR_REINTENTABLE', 'REVISAR_MANUAL'].includes(status)) return 'PENDING';
  if (status) return 'ERROR';
  return 'PENDING';
}

function StatCard({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'teal' | 'amber' | 'red';
  hint?: string;
}) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </article>
  );
}

export function OpsStudio({ initialData = null }: { initialData?: OpsData | null }) {
  const hasInitialData = initialData !== null;
  const [data, setData] = useState<OpsData>(initialData ?? EMPTY_OPS_DATA);
  const [activeView, setActiveView] = useState<ViewKey>('overview');
  const [loading, setLoading] = useState(!hasInitialData);
  const [message, setMessage] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialData?.courses.items[0]?.id ?? null);

  const [courseSearch, setCourseSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [teacherFilter, setTeacherFilter] = useState<TeacherFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const deferredCourseSearch = useDeferredValue(courseSearch);

  const [killingBrowsers, setKillingBrowsers] = useState(false);
  const [killBrowsersResult, setKillBrowsersResult] = useState<string>('');
  const [bannerLoginResult, setBannerLoginResult] = useState<string>('');

  async function killBrowsers() {
    setKillingBrowsers(true);
    setKillBrowsersResult('');
    try {
      const res = await fetch('/api/system/kill-browsers', { method: 'POST' });
      const json = await res.json() as { ok: boolean; message: string };
      setKillBrowsersResult(json.message);
    } catch (err) {
      setKillBrowsersResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKillingBrowsers(false);
    }
  }

  async function startBannerLogin() {
    setBannerLoginResult('Abriendo Edge para login Banner...');
    try {
      const res = await fetch('/api/banner/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auth-start', payload: {} }),
      });
      const json = await res.json() as { ok: boolean; message?: string; error?: string };
      if (!json.ok) {
        setBannerLoginResult(`Error: ${json.error ?? json.message ?? 'Falló el login Banner.'}`);
        return;
      }
      setBannerLoginResult('Edge abierto. Completa SSO/2FA en la ventana, luego presiona "Guardar sesión".');
    } catch (err) {
      setBannerLoginResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function confirmBannerLogin() {
    setBannerLoginResult('Guardando sesión Banner...');
    try {
      const res = await fetch('/api/banner/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auth-confirm', payload: {} }),
      });
      const json = await res.json() as { ok: boolean; message?: string; error?: string };
      if (!json.ok) {
        setBannerLoginResult(`Error: ${json.error ?? json.message ?? 'No se pudo guardar la sesión.'}`);
        return;
      }
      setBannerLoginResult('Sesión guardada. Ahora ve a /docentes → "Solo docentes".');
    } catch (err) {
      setBannerLoginResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function refreshData(silent = false) {
    try {
      if (!silent) setLoading(true);
      const response = await fetch('/api/ops', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const next = (await response.json()) as OpsData & { error?: string };
      if (!response.ok) throw new Error(next.error ?? 'No fue posible cargar Ops Studio.');
      startTransition(() => {
        setData(next);
        setMessage('');
        if (!selectedCourseId && next.courses.items[0]?.id) {
          setSelectedCourseId(next.courses.items[0].id);
        }
      });
    } catch (error) {
      if (!silent) {
        setMessage(`No se pudo actualizar: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (hasInitialData) return;
    void refreshData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refreshData(true), 15000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, selectedCourseId]);

  const periods = useMemo(
    () => ['ALL', ...Array.from(new Set(data.courses.items.map((course) => course.period.code))).sort()],
    [data.courses.items],
  );

  const filteredCourses = useMemo(() => {
    const normalizedQuery = normalizeText(deferredCourseSearch);
    return data.courses.items
      .filter((course) => {
        if (periodFilter !== 'ALL' && course.period.code !== periodFilter) return false;
        if (teacherFilter === 'WITH_TEACHER' && !course.teacherId) return false;
        if (teacherFilter === 'WITHOUT_TEACHER' && course.teacherId) return false;
        if (statusFilter !== 'ALL' && getCourseStatusBucket(course) !== statusFilter) return false;
        if (!normalizedQuery) return true;
        const haystack = normalizeText(
          [
            course.nrc,
            course.subjectName ?? '',
            course.programName ?? '',
            course.teacher?.fullName ?? '',
            course.teacher?.id ?? '',
            course.teacher?.documentId ?? '',
            course.moodleCheck?.status ?? '',
            course.moodleCheck?.detectedTemplate ?? '',
            course.integrations.moodleSidecar?.type ?? '',
            course.integrations.moodleSidecar?.moodleCourseName ?? '',
            course.integrations.urlValidation?.moodleUrl ?? '',
            course.integrations.bannerExport?.teacherName ?? '',
            course.bannerReviewStatus ?? '',
            course.reviewExcludedReason ?? '',
          ].join(' '),
        );
        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) => {
        const leftIssues =
          Number(!left.teacherId) +
          Number(left.moodleCheck?.status !== 'OK') +
          Number(left.integrations.moodleSidecar?.empty) +
          Number(!left.integrations.urlValidation?.moodleUrl);
        const rightIssues =
          Number(!right.teacherId) +
          Number(right.moodleCheck?.status !== 'OK') +
          Number(right.integrations.moodleSidecar?.empty) +
          Number(!right.integrations.urlValidation?.moodleUrl);
        if (rightIssues !== leftIssues) return rightIssues - leftIssues;
        return left.nrc.localeCompare(right.nrc, 'es');
      });
  }, [data.courses.items, deferredCourseSearch, periodFilter, teacherFilter, statusFilter]);

  const selectedCourse =
    filteredCourses.find((course) => course.id === selectedCourseId) ??
    data.courses.items.find((course) => course.id === selectedCourseId) ??
    filteredCourses[0] ??
    data.courses.items[0] ??
    null;

  const topBannerStatuses = formatListMap(data.banner.exportSummary.statusCounts).slice(0, 6);
  const selectedMoodleUrl =
    selectedCourse?.integrations.urlValidation?.moodleUrl ?? selectedCourse?.moodleCheck?.moodleCourseUrl ?? null;

  const today = new Date().toLocaleDateString('es-CO', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="shell">
      {/* ── Hero compacto ── */}
      <section className="hero hero-compact">
        <div className="hero-copy">
          <h1>Panel operativo</h1>
          <div className="hero-meta">
            <span className={`chip ${data.apiReachable ? 'chip-ok' : 'chip-alert'}`}>
              <span className={`status-dot ${data.apiReachable ? 'dot-ok' : 'dot-error'}`} />
              API {data.apiReachable ? 'conectada' : 'sin conexión'}
            </span>
            <span className="chip">{today}</span>
          </div>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => void refreshData()} disabled={loading}>
            {loading ? 'Actualizando...' : 'Refrescar'}
          </button>
          <label className="toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span>Auto 15s</span>
          </label>
        </div>
      </section>

      {/* ── Flashes ── */}
      {loading && !data.generatedAt ? <div className="flash">Cargando tablero operativo...</div> : null}
      {message ? <div className="flash">{message}</div> : null}
      {!data.apiReachable ? (
        <div className="flash flash-warning">
          API en 3001 no responde. Métricas y acciones no disponibles.
        </div>
      ) : null}

      {/* ── Stats grid ── */}
      <section className="stats-grid">
        <StatCard label="Cursos" value={data.stats?.courses ?? data.courses.total} tone="teal" hint={`${data.derived.withoutTeacher} sin docente`} />
        <StatCard label="Docentes" value={data.derived.withTeacher} hint="con asignación" />
        <StatCard label="Moodle OK" value={data.derived.moodleOk} hint={`${data.derived.moodlePending} pendientes`} />
        <StatCard label="URLs Moodle" value={data.derived.withMoodleUrl} hint={`${data.sidecar.urlValidation.rowCount} validadas`} />
        <StatCard label="Banner" value={data.derived.bannerFound} hint={`${data.derived.bannerWithoutTeacher} sin docente`} tone={data.derived.bannerWithoutTeacher > 0 ? 'amber' : 'default'} />
        <StatCard label="Cola activa" value={data.queue?.queue.active ?? 0} hint={`${data.queue?.queue.waiting ?? 0} en espera`} tone={(data.queue?.queue.active ?? 0) > 0 ? 'teal' : 'default'} />
        <StatCard label="Cursos virtuales" value={data.stats?.virtualCount ?? 0} hint="con encuentros Teams" />
        <StatCard label="100% virtuales" value={data.stats?.virtual100Count ?? 0} hint="sin encuentros sincrónicos" />
      </section>

      {/* ── View switcher pills ── */}
      <section className="view-switcher">
        {([
          ['overview', 'Resumen'],
          ['courses', 'Cursos'],
          ['integrations', 'Integraciones'],
          ['files', 'Archivos'],
        ] as Array<[ViewKey, string]>).map(([key, label]) => (
          <button
            key={key}
            className={`switch-button${activeView === key ? ' active' : ''}`}
            onClick={() => setActiveView(key)}
          >
            {label}
          </button>
        ))}
      </section>

      {/* ════════════════════════════════
          OVERVIEW
      ════════════════════════════════ */}
      {activeView === 'overview' ? (
        <section className="dashboard-grid">

          {/* Columna izquierda */}
          <article className="panel">
            <div className="panel-heading">
              <h2>Acciones rápidas</h2>
              <span className="panel-note">Mantenimiento del entorno de automatización</span>
            </div>

            <details className="disclosure" open>
              <summary>Sesión Banner y navegadores</summary>
              <div className="disclosure-body">
                <p className="disclosure-desc">
                  Usa estos controles cuando Edge esté bloqueado o necesites renovar la sesión de Banner antes de correr consultas en <a href="/docentes" className="inline-link">/docentes</a> o <a href="/automatizacion-banner" className="inline-link">/automatizacion-banner</a>.
                </p>
                <p className="disclosure-desc" style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
                  Flujo: <strong>1. Limpiar</strong> si Edge está bloqueado → <strong>2. Abrir login</strong> → completar SSO/2FA en la ventana que se abre → <strong>3. Guardar sesión</strong>.
                </p>
                <div className="toolbar">
                  <button
                    style={{ background: '#7f1d1d', color: '#fff' }}
                    disabled={killingBrowsers}
                    onClick={() => void killBrowsers()}
                  >
                    {killingBrowsers ? 'Limpiando...' : '1. Limpiar Edge bloqueado'}
                  </button>
                  <button
                    style={{ background: '#92400e', color: '#fff' }}
                    onClick={() => void startBannerLogin()}
                  >
                    2. Abrir login Banner
                  </button>
                  <button
                    style={{ background: '#15803d', color: '#fff' }}
                    onClick={() => void confirmBannerLogin()}
                  >
                    3. Guardar sesión Banner
                  </button>
                </div>
                {killBrowsersResult && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, color: '#374151' }}>
                    {killBrowsersResult}
                  </div>
                )}
                {bannerLoginResult && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#fefce8', border: '1px solid #fde68a', borderRadius: 6, fontSize: 13, color: '#92400e' }}>
                    {bannerLoginResult}
                  </div>
                )}
              </div>
            </details>

          </article>

          {/* Columna derecha: alertas */}
          <article className="panel">
            <div className="panel-heading">
              <h2>Avisos de atención</h2>
              <span className="panel-note">{data.derived.attention.length} avisos activos</span>
            </div>
            <div className="issue-list">
              {data.derived.attention.length ? (
                data.derived.attention.map((item) => (
                  <button
                    key={`${item.id}-${item.reason}`}
                    className="issue-item"
                    onClick={() => {
                      setSelectedCourseId(item.id);
                      setActiveView('courses');
                    }}
                  >
                    <strong>{item.nrc}</strong>
                    <span>{item.subjectName ?? 'Sin asignatura'}</span>
                    <small>{item.reason}</small>
                  </button>
                ))
              ) : (
                <div className="empty-state">Sin alertas en este corte.</div>
              )}
            </div>
          </article>

          {/* Fila inferior: preview sidecar + correos */}
          <article className="panel">
            <div className="panel-heading">
              <h2>Últimas aulas clasificadas</h2>
              <span className="panel-note">{data.sidecar.summary.rowCount} aulas · prom. {data.sidecar.summary.participantAverage ?? '-'} estudiantes</span>
            </div>
            <div className="table-wrap">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Tipo de aula</th>
                    <th>Estudiantes</th>
                    <th>Nombre en Moodle</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sidecar.summary.preview.slice(0, 8).map((item) => (
                    <tr key={`${item.nrc}-${item.moodleCourseId ?? item.moodleCourseName ?? 'x'}`}>
                      <td>{item.nrc}</td>
                      <td>{item.type ?? '-'}</td>
                      <td>{item.participants ?? '-'}</td>
                      <td>{item.moodleCourseName ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Correos pendientes</h2>
              <span className="panel-note">{data.outbox.total} mensajes · <a href="/correos" className="inline-link">Gestionar en /correos</a></span>
            </div>
            <div className="table-wrap">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>Destinatario</th>
                    <th>Asunto</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outbox.items.length ? (
                    data.outbox.items.slice(0, 8).map((item, index) => (
                      <tr key={`${item.subject}-${index}`}>
                        <td>{item.teacher?.fullName ?? item.coordinator?.fullName ?? item.recipientName ?? '-'}</td>
                        <td>{item.subject}</td>
                        <td>{item.status}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>Sin registros.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

        </section>
      ) : null}

      {/* ════════════════════════════════
          COURSES
      ════════════════════════════════ */}
      {activeView === 'courses' ? (
        <section className="courses-layout">
          <article className="panel">
            <div className="panel-heading">
              <h2>Listado de cursos</h2>
              <span className="panel-note">{filteredCourses.length} resultados</span>
            </div>
            <div className="filters">
              <label>
                Buscar
                <input
                  value={courseSearch}
                  onChange={(event) => setCourseSearch(event.target.value)}
                  placeholder="NRC, docente, URL, tipo..."
                />
              </label>
              <label>
                Periodo
                <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
                  {periods.map((period) => (
                    <option key={period} value={period}>
                      {period === 'ALL' ? 'Todos' : period}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Docente
                <select value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value as TeacherFilter)}>
                  <option value="ALL">Todos</option>
                  <option value="WITH_TEACHER">Con docente</option>
                  <option value="WITHOUT_TEACHER">Sin docente</option>
                </select>
              </label>
              <label>
                Moodle
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                  <option value="ALL">Todos</option>
                  <option value="OK">OK</option>
                  <option value="PENDING">Pendiente</option>
                  <option value="ERROR">Error</option>
                </select>
              </label>
            </div>

            <div className="table-wrap">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Asignatura</th>
                    <th>Docente</th>
                    <th>Moodle</th>
                    <th>Tipo aula</th>
                    <th>URL</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCourses.slice(0, 120).map((course) => (
                    <tr
                      key={course.id}
                      className={selectedCourseId === course.id ? 'selected-row' : ''}
                      onClick={() => setSelectedCourseId(course.id)}
                    >
                      <td>
                        <strong>{course.nrc}</strong>
                        <div className="mini">{course.period.code}</div>
                      </td>
                      <td>
                        {course.subjectName ?? '-'}
                        <div className="mini">{course.programName ?? course.programCode ?? '-'}</div>
                      </td>
                      <td>{course.teacher?.fullName ?? <span className="chip chip-warn">Sin docente</span>}</td>
                      <td>
                        <span className={`chip ${course.moodleCheck?.status === 'OK' ? 'chip-ok' : course.moodleCheck?.status ? 'chip-warn' : 'chip-alert'}`}>
                          {course.moodleCheck?.status ?? 'SIN_CHECK'}
                        </span>
                      </td>
                      <td>{course.integrations.moodleSidecar?.type ?? '-'}</td>
                      <td>
                        <span className={`chip ${course.integrations.urlValidation?.moodleUrl ? 'chip-ok' : 'chip-alert'}`}>
                          {course.integrations.urlValidation?.moodleUrl ? 'OK' : 'Pendiente'}
                        </span>
                      </td>
                      <td>
                        <button
                          className="ghost-button"
                          onClick={(e) => { e.stopPropagation(); setSelectedCourseId(course.id); }}
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <aside className="ficha-card course-detail">
            {selectedCourse ? (
              <>
                <div className="ficha-header">
                  <div className="ficha-header-row">
                    <div>
                      <h2>{selectedCourse.nrc}</h2>
                      <div className="ficha-subtitle">{selectedCourse.subjectName ?? 'Sin asignatura'}</div>
                      <div className="ficha-chip-row">
                        <span className="ficha-chip">{selectedCourse.period.code}</span>
                        {selectedCourse.moodleCheck?.status ? (
                          <span className={`ficha-chip ${selectedCourse.moodleCheck.status === 'OK' ? 'ficha-chip-success' : 'ficha-chip-warn'}`}>
                            Moodle: {selectedCourse.moodleCheck.status}
                          </span>
                        ) : null}
                        {selectedCourse.teacher?.fullName ? null : (
                          <span className="ficha-chip ficha-chip-warn">Sin docente</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ficha-body">
                  <h3 className="ficha-section-title">Información general</h3>
                  <div className="ficha-grid">
                    {[
                      { label: 'Docente', value: selectedCourse.teacher?.fullName },
                      { label: 'Banner', value: selectedCourse.bannerReviewStatus ?? selectedCourse.integrations.bannerExport?.status },
                      { label: 'Moodle API', value: selectedCourse.moodleCheck?.status },
                      { label: 'Tipo de aula', value: selectedCourse.integrations.moodleSidecar?.type },
                      { label: 'Estudiantes Moodle', value: selectedCourse.integrations.moodleSidecar?.participants?.toString() },
                      { label: 'Nombre en Moodle', value: selectedCourse.integrations.moodleSidecar?.moodleCourseName },
                    ].map((f) => (
                      <div className="ficha-field" key={f.label}>
                        <div className="ficha-field-label">{f.label}</div>
                        <div className={`ficha-field-value${f.value ? '' : ' empty'}`}>{f.value || 'Sin información'}</div>
                      </div>
                    ))}
                  </div>

                  <h3 className="ficha-section-title">Estado en Moodle</h3>
                  <div className="ficha-grid">
                    {[
                      { label: 'Plantilla detectada', value: selectedCourse.moodleCheck?.detectedTemplate },
                      { label: 'Modalidad', value: selectedCourse.moodleCheck?.resolvedModality ?? selectedCourse.integrations.urlValidation?.modality },
                      { label: 'ID del aula', value: selectedCourse.integrations.moodleSidecar?.moodleCourseId ?? selectedCourse.moodleCheck?.moodleCourseId },
                      { label: 'Estudiantes detectados', value: selectedCourse.integrations.moodleSidecar?.participantsDetected?.toString() },
                    ].map((f) => (
                      <div className="ficha-field" key={f.label}>
                        <div className="ficha-field-label">{f.label}</div>
                        <div className={`ficha-field-value${f.value ? '' : ' empty'}`}>{f.value || 'Sin información'}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: -12, marginBottom: 16 }}>
                    {selectedMoodleUrl ? (
                      <a href={selectedMoodleUrl} target="_blank" rel="noreferrer" className="inline-link">
                        Abrir URL Moodle
                      </a>
                    ) : (
                      <span className="inline-muted">Sin URL final resuelta</span>
                    )}
                  </div>

                  <h3 className="ficha-section-title">Datos de Banner</h3>
                  <div className="ficha-grid">
                    {[
                      { label: 'ID del docente', value: selectedCourse.integrations.bannerExport?.teacherId ?? selectedCourse.teacherId },
                      { label: 'Nombre', value: selectedCourse.integrations.bannerExport?.teacherName ?? selectedCourse.teacher?.fullName },
                      { label: 'Última verificación', value: formatDate(selectedCourse.integrations.bannerExport?.checkedAt) },
                      { label: 'Error', value: selectedCourse.integrations.bannerExport?.errorMessage },
                    ].map((f) => (
                      <div className="ficha-field" key={f.label}>
                        <div className="ficha-field-label">{f.label}</div>
                        <div className={`ficha-field-value${f.value && f.value !== '-' ? '' : ' empty'}`}>{f.value && f.value !== '-' ? f.value : 'Sin información'}</div>
                      </div>
                    ))}
                  </div>

                  <h3 className="ficha-section-title">Estado de revisión</h3>
                  <div className="ficha-grid">
                    {[
                      { label: 'Excluido', value: selectedCourse.reviewExcluded ? 'Sí' : 'No' },
                      { label: 'Razón', value: selectedCourse.reviewExcludedReason },
                      { label: 'Checklist activo', value: selectedCourse.checklistTemporal?.active ? 'Sí' : 'No' },
                      { label: 'Última fase', value: selectedCourse.evaluationSummary?.latestPhase },
                      { label: 'Puntaje alistamiento', value: formatScore(selectedCourse.evaluationSummary?.alistamientoScore) },
                      { label: 'Puntaje ejecución', value: formatScore(selectedCourse.evaluationSummary?.ejecucionScore) },
                    ].map((f) => (
                      <div className="ficha-field" key={f.label}>
                        <div className="ficha-field-label">{f.label}</div>
                        <div className={`ficha-field-value${f.value && f.value !== '-' ? '' : ' empty'}`}>{f.value && f.value !== '-' ? f.value : 'Sin información'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="ficha-body">
                <div className="empty-state">Selecciona un curso para ver su ficha.</div>
              </div>
            )}
          </aside>
        </section>
      ) : null}

      {/* ════════════════════════════════
          INTEGRATIONS
      ════════════════════════════════ */}
      {activeView === 'integrations' ? (
        <section className="dashboard-grid">

          <article className="panel panel-span-2">
            <div className="panel-heading">
              <h2>Estado de conexiones</h2>
              <span className="panel-note">Servicios y procesos activos en este momento</span>
            </div>
            <div className="integration-status-list">
              <div className="integration-row">
                <span className="integration-name">Servicio principal (API)</span>
                <span className={`chip ${data.apiReachable ? 'chip-ok' : 'chip-alert'}`}>
                  {data.apiReachable ? 'Conectada' : 'Sin conexión'}
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Conector Banner</span>
                <span className={`chip ${data.banner.runner.running ? 'chip-warn' : 'chip-ok'}`}>
                  {data.banner.runner.running ? 'En ejecución' : 'Inactivo'}
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Clasificador Moodle</span>
                <span className={`chip ${(data.sidecar.runner as { running?: boolean } | null)?.running ? 'chip-warn' : 'chip-ok'}`}>
                  {(data.sidecar.runner as { running?: boolean } | null)?.running ? 'En ejecución' : 'Inactivo'}
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Datos exportados Banner</span>
                <span className={`chip ${data.banner.exportSummary.rowCount > 0 ? 'chip-ok' : 'chip-alert'}`}>
                  {data.banner.exportSummary.rowCount} filas
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Archivo de clasificación Moodle</span>
                <span className={`chip ${data.sidecar.summary.rowCount > 0 ? 'chip-ok' : 'chip-alert'}`}>
                  {data.sidecar.summary.rowCount} filas
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Aulas sin estudiantes</span>
                <span className={`chip ${data.sidecar.summary.emptyClassrooms > 0 ? 'chip-alert' : 'chip-ok'}`}>
                  {data.sidecar.summary.emptyClassrooms}
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Cola de procesamiento Moodle</span>
                <span className={`chip ${(data.queue?.queue.active ?? 0) > 0 ? 'chip-warn' : 'chip-ok'}`}>
                  {data.queue?.queue.active ?? 0} activos / {data.queue?.queue.waiting ?? 0} en espera
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Última consulta Banner</span>
                <span className="chip">{formatDate(data.banner.runner.lastRun?.endedAt ?? data.banner.runner.current?.startedAt)}</span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Última clasificación Moodle</span>
                <span className="chip">
                  {formatDate(
                    (data.sidecar.runner as { lastRun?: { endedAt?: string }; current?: { startedAt?: string } } | null)?.lastRun?.endedAt ??
                    (data.sidecar.runner as { current?: { startedAt?: string } } | null)?.current?.startedAt
                  )}
                </span>
              </div>
            </div>

            <div className="panel-heading" style={{ marginTop: '1.25rem' }}>
              <h3>Resultados Banner por categoría</h3>
              <span className="panel-note">Para ejecutar nuevas consultas, ve a <a href="/automatizacion-banner" className="inline-link">/automatizacion-banner</a></span>
            </div>
            <div className="badge-wall">
              {topBannerStatuses.map(([label, value]) => (
                <span className="badge" key={label}>
                  {label}: {value}
                </span>
              ))}
            </div>

            <div className="panel-heading" style={{ marginTop: '1.25rem' }}>
              <h3>Log reciente de Banner</h3>
            </div>
            <pre className="log-block">{data.banner.runner.logTail || 'Sin actividad reciente.'}</pre>
          </article>

        </section>
      ) : null}

      {/* ════════════════════════════════
          FILES
      ════════════════════════════════ */}
      {activeView === 'files' ? (
        <section className="dashboard-grid">
          <article className="panel panel-span-2">
            <div className="panel-heading">
              <h2>Archivos del sistema</h2>
              <span className="panel-note">Archivos generados o importados automáticamente</span>
            </div>
            <div className="table-wrap">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>Archivo</th>
                    <th>Origen</th>
                    <th>Categoría</th>
                    <th>Tamaño</th>
                    <th>Modificado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.files.length ? (
                    data.files.map((file) => (
                      <tr key={file.path}>
                        <td>{file.name}</td>
                        <td>{file.source}</td>
                        <td>{file.category}</td>
                        <td>{file.sizeLabel}</td>
                        <td>{formatDate(file.modifiedAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>Sin archivos detectados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}
    </div>
  );
}
