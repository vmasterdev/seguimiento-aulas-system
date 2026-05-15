'use client';

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { CourseRecord, OpsData } from './lib/types';
import { Button, AlertBox, StatusPill, StatsGrid } from './_components/ui';

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
  courses: { total: 0, items: [] },
  outbox: { total: 0, items: [] },
  sidecar: {
    config: null,
    runner: null,
    summary: {
      latestFile: null, modifiedAt: null, rowCount: 0, okCount: 0,
      errorCount: 0, emptyClassrooms: 0, typeCounts: {}, statusCounts: {},
      participantAverage: null, preview: [], sampleByNrc: {},
    },
    urlValidation: {
      latestFile: null, modifiedAt: null, rowCount: 0,
      withUrlCount: 0, preview: [], sampleByNrc: {},
    },
  },
  banner: {
    runner: { running: false, current: null, lastRun: null, logTail: '', liveActivity: null },
    exportSummary: { latestFile: null, modifiedAt: null, rowCount: 0, statusCounts: {}, preview: [], sampleByNrc: {} },
  },
  files: [],
  derived: {
    withTeacher: 0, withoutTeacher: 0, moodleOk: 0, moodlePending: 0,
    moodleErrors: 0, withMoodleUrl: 0, withSidecarData: 0, bannerFound: 0,
    bannerWithoutTeacher: 0, outboxDrafts: 0, reviewExcluded: 0, attention: [],
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
  return Object.entries(values).sort((l, r) => r[1] - l[1]);
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getCourseStatusBucket(course: CourseRecord): StatusFilter {
  const status = course.moodleCheck?.status ?? '';
  if (status === 'OK') return 'OK';
  if (['PENDIENTE', 'ERROR_REINTENTABLE', 'REVISAR_MANUAL'].includes(status)) return 'PENDING';
  if (status) return 'ERROR';
  return 'PENDING';
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
      setBannerLoginResult('Sesión guardada. Ve a /docentes → "Solo docentes".');
    } catch (err) {
      setBannerLoginResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function refreshData(silent = false) {
    try {
      if (!silent) setLoading(true);
      const response = await fetch('/api/ops', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const next = (await response.json()) as OpsData & { error?: string };
      if (!response.ok) throw new Error(next.error ?? 'No fue posible cargar Ops Studio.');
      startTransition(() => {
        setData(next);
        setMessage('');
        if (!selectedCourseId && next.courses.items[0]?.id) setSelectedCourseId(next.courses.items[0].id);
      });
    } catch (error) {
      if (!silent) setMessage(`No se pudo actualizar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { if (hasInitialData) return; void refreshData(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refreshData(true), 15000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, selectedCourseId]);

  const periods = useMemo(
    () => ['ALL', ...Array.from(new Set(data.courses.items.map((c) => c.period.code))).sort()],
    [data.courses.items],
  );

  const filteredCourses = useMemo(() => {
    const q = normalizeText(deferredCourseSearch);
    return data.courses.items
      .filter((course) => {
        if (periodFilter !== 'ALL' && course.period.code !== periodFilter) return false;
        if (teacherFilter === 'WITH_TEACHER' && !course.teacherId) return false;
        if (teacherFilter === 'WITHOUT_TEACHER' && course.teacherId) return false;
        if (statusFilter !== 'ALL' && getCourseStatusBucket(course) !== statusFilter) return false;
        if (!q) return true;
        const hay = normalizeText([
          course.nrc, course.subjectName ?? '', course.programName ?? '',
          course.teacher?.fullName ?? '', course.teacher?.id ?? '', course.teacher?.documentId ?? '',
          course.moodleCheck?.status ?? '', course.moodleCheck?.detectedTemplate ?? '',
          course.integrations.moodleSidecar?.type ?? '', course.integrations.moodleSidecar?.moodleCourseName ?? '',
          course.integrations.urlValidation?.moodleUrl ?? '', course.integrations.bannerExport?.teacherName ?? '',
          course.bannerReviewStatus ?? '', course.reviewExcludedReason ?? '',
        ].join(' '));
        return hay.includes(q);
      })
      .sort((l, r) => {
        const issues = (c: CourseRecord) =>
          Number(!c.teacherId) + Number(c.moodleCheck?.status !== 'OK') +
          Number(c.integrations.moodleSidecar?.empty) + Number(!c.integrations.urlValidation?.moodleUrl);
        const diff = issues(r) - issues(l);
        return diff !== 0 ? diff : l.nrc.localeCompare(r.nrc, 'es');
      });
  }, [data.courses.items, deferredCourseSearch, periodFilter, teacherFilter, statusFilter]);

  const selectedCourse =
    filteredCourses.find((c) => c.id === selectedCourseId) ??
    data.courses.items.find((c) => c.id === selectedCourseId) ??
    filteredCourses[0] ?? data.courses.items[0] ?? null;

  const topBannerStatuses = formatListMap(data.banner.exportSummary.statusCounts).slice(0, 6);
  const selectedMoodleUrl =
    selectedCourse?.integrations.urlValidation?.moodleUrl ?? selectedCourse?.moodleCheck?.moodleCourseUrl ?? null;
  const today = new Date().toLocaleDateString('es-CO', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="shell">

      {/* ── Hero ── */}
      <header className="hero-banner">
        <div className="hero-banner-body">
          <div>
            <h1 className="hero-banner-title">Panel operativo</h1>
            <div className="hero-banner-meta">
              <StatusPill tone={data.apiReachable ? 'ok' : 'danger'} dot>
                API {data.apiReachable ? 'conectada' : 'sin conexión'}
              </StatusPill>
              <span className="chip">{today}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button variant="primary" size="sm" loading={loading} onClick={() => void refreshData()}>
              {loading ? 'Actualizando...' : 'Refrescar'}
            </Button>
            <label className="toggle">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              <span>Auto 15s</span>
            </label>
          </div>
        </div>
      </header>

      {/* ── Mensajes ── */}
      {loading && !data.generatedAt && (
        <div style={{ padding: '0 32px 14px' }}>
          <AlertBox tone="info">Cargando tablero operativo...</AlertBox>
        </div>
      )}
      {message && (
        <div style={{ padding: '0 32px 14px' }}>
          <AlertBox tone="error">{message}</AlertBox>
        </div>
      )}
      {!data.apiReachable && (
        <div style={{ padding: '0 32px 14px' }}>
          <AlertBox tone="warn">API en 3001 no responde. Métricas y acciones no disponibles.</AlertBox>
        </div>
      )}

      {/* ── Stats ── */}
      <StatsGrid items={[
        { label: 'Cursos', value: data.stats?.courses ?? data.courses.total, help: `${data.derived.withoutTeacher} sin docente`, tone: 'ok' },
        { label: 'Docentes', value: data.derived.withTeacher, help: 'con asignación' },
        { label: 'Moodle OK', value: data.derived.moodleOk, help: `${data.derived.moodlePending} pendientes` },
        { label: 'URLs Moodle', value: data.derived.withMoodleUrl, help: `${data.sidecar.urlValidation.rowCount} validadas` },
        { label: 'Banner', value: data.derived.bannerFound, help: `${data.derived.bannerWithoutTeacher} sin docente`, tone: data.derived.bannerWithoutTeacher > 0 ? 'warn' : undefined },
        { label: 'Cola activa', value: data.queue?.queue.active ?? 0, help: `${data.queue?.queue.waiting ?? 0} en espera`, tone: (data.queue?.queue.active ?? 0) > 0 ? 'ok' : undefined },
        { label: 'Virtuales', value: data.stats?.virtualCount ?? 0, help: 'con encuentros Teams' },
        { label: '100% virtuales', value: data.stats?.virtual100Count ?? 0, help: 'sin encuentros sincrónicos' },
      ]} columns={4} />

      {/* ── View switcher ── */}
      <div style={{ padding: '0 32px' }}>
        <div className="view-switcher">
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
        </div>
      </div>

      {/* ════════════════════════════════
          OVERVIEW
      ════════════════════════════════ */}
      {activeView === 'overview' && (
        <div className="dashboard-grid" style={{ padding: '0 32px 32px' }}>

          {/* Acciones rápidas */}
          <article className="premium-card">
            <div style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                Acciones rápidas
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                Mantenimiento del entorno de automatización
              </p>
            </div>

            <details className="disclosure" open>
              <summary>Sesión Banner y navegadores</summary>
              <div className="disclosure-body">
                <p className="disclosure-desc">
                  Usa estos controles cuando Edge esté bloqueado o necesites renovar la sesión de Banner antes de correr consultas en{' '}
                  <a href="/docentes" className="inline-link">/docentes</a> o{' '}
                  <a href="/automatizacion-banner" className="inline-link">/automatizacion-banner</a>.
                </p>
                <p className="disclosure-desc" style={{ marginTop: 6, color: 'var(--muted)', fontSize: '0.75rem' }}>
                  Flujo: <strong>1. Limpiar</strong> si Edge está bloqueado → <strong>2. Abrir login</strong> → completar SSO/2FA → <strong>3. Guardar sesión</strong>.
                </p>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <Button variant="danger" size="sm" loading={killingBrowsers} onClick={() => void killBrowsers()}>
                    {killingBrowsers ? 'Limpiando...' : '1. Limpiar Edge bloqueado'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void startBannerLogin()}>
                    2. Abrir login Banner
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => void confirmBannerLogin()}>
                    3. Guardar sesión Banner
                  </Button>
                </div>
                {killBrowsersResult && (
                  <div style={{ marginTop: 8 }}>
                    <AlertBox tone="info">{killBrowsersResult}</AlertBox>
                  </div>
                )}
                {bannerLoginResult && (
                  <div style={{ marginTop: 8 }}>
                    <AlertBox tone="warn">{bannerLoginResult}</AlertBox>
                  </div>
                )}
              </div>
            </details>
          </article>

          {/* Avisos de atención */}
          <article className="premium-card">
            <div style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                Avisos de atención
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                {data.derived.attention.length} avisos activos
              </p>
            </div>
            <div className="issue-list">
              {data.derived.attention.length ? (
                data.derived.attention.map((item) => (
                  <button
                    key={`${item.id}-${item.reason}`}
                    className="issue-item"
                    onClick={() => { setSelectedCourseId(item.id); setActiveView('courses'); }}
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

          {/* Últimas aulas clasificadas */}
          <article className="premium-card">
            <div style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                Últimas aulas clasificadas
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                {data.sidecar.summary.rowCount} aulas · prom. {data.sidecar.summary.participantAverage ?? '-'} estudiantes
              </p>
            </div>
            <div className="table-wrap">
              <table className="fast-table">
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

          {/* Correos pendientes */}
          <article className="premium-card">
            <div style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                Correos pendientes
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                {data.outbox.total} mensajes · <a href="/correos" className="inline-link">Gestionar en /correos</a>
              </p>
            </div>
            <div className="table-wrap">
              <table className="fast-table">
                <thead>
                  <tr>
                    <th>Destinatario</th>
                    <th>Asunto</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outbox.items.length ? (
                    data.outbox.items.slice(0, 8).map((item, idx) => (
                      <tr key={`${item.subject}-${idx}`}>
                        <td>{item.teacher?.fullName ?? item.coordinator?.fullName ?? item.recipientName ?? '-'}</td>
                        <td>{item.subject}</td>
                        <td>{item.status}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={3}>Sin registros.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}

      {/* ════════════════════════════════
          COURSES
      ════════════════════════════════ */}
      {activeView === 'courses' && (
        <div className="courses-layout" style={{ padding: '0 32px 32px' }}>
          <article className="premium-card" style={{ padding: 0 }}>
            <div style={{ padding: '18px 20px 12px' }}>
              <h2 style={{ margin: '0 0 2px', fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                Listado de cursos
              </h2>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted)' }}>{filteredCourses.length} resultados</p>
            </div>
            <div style={{ padding: '0 20px 12px' }}>
              <div className="filters">
                <label>
                  Buscar
                  <input value={courseSearch} onChange={(e) => setCourseSearch(e.target.value)} placeholder="NRC, docente, URL, tipo..." />
                </label>
                <label>
                  Periodo
                  <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
                    {periods.map((p) => <option key={p} value={p}>{p === 'ALL' ? 'Todos' : p}</option>)}
                  </select>
                </label>
                <label>
                  Docente
                  <select value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value as TeacherFilter)}>
                    <option value="ALL">Todos</option>
                    <option value="WITH_TEACHER">Con docente</option>
                    <option value="WITHOUT_TEACHER">Sin docente</option>
                  </select>
                </label>
                <label>
                  Moodle
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                    <option value="ALL">Todos</option>
                    <option value="OK">OK</option>
                    <option value="PENDING">Pendiente</option>
                    <option value="ERROR">Error</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="table-wrap" style={{ borderRadius: '0 0 var(--radius-md) var(--radius-md)', border: 'none', borderTop: '1px solid var(--line)' }}>
              <table className="fast-table">
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
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <strong>{course.nrc}</strong>
                        <div className="mini">{course.period.code}</div>
                      </td>
                      <td>
                        {course.subjectName ?? '-'}
                        <div className="mini">{course.programName ?? course.programCode ?? '-'}</div>
                      </td>
                      <td>
                        {course.teacher?.fullName ?? (
                          <StatusPill tone="warn">Sin docente</StatusPill>
                        )}
                      </td>
                      <td>
                        <StatusPill tone={course.moodleCheck?.status === 'OK' ? 'ok' : course.moodleCheck?.status ? 'warn' : 'danger'}>
                          {course.moodleCheck?.status ?? 'SIN_CHECK'}
                        </StatusPill>
                      </td>
                      <td>{course.integrations.moodleSidecar?.type ?? '-'}</td>
                      <td>
                        <StatusPill tone={course.integrations.urlValidation?.moodleUrl ? 'ok' : 'danger'}>
                          {course.integrations.urlValidation?.moodleUrl ? 'OK' : 'Pendiente'}
                        </StatusPill>
                      </td>
                      <td>
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedCourseId(course.id); }}>
                          Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          {/* Ficha del curso seleccionado */}
          <aside className="premium-card course-detail" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
            {selectedCourse ? (
              <>
                <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                        {selectedCourse.nrc}
                      </h2>
                      <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--n-600)' }}>
                        {selectedCourse.subjectName ?? 'Sin asignatura'}
                      </p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        <span className="chip">{selectedCourse.period.code}</span>
                        {selectedCourse.moodleCheck?.status && (
                          <StatusPill tone={selectedCourse.moodleCheck.status === 'OK' ? 'ok' : 'warn'}>
                            Moodle: {selectedCourse.moodleCheck.status}
                          </StatusPill>
                        )}
                        {!selectedCourse.teacher?.fullName && (
                          <StatusPill tone="warn">Sin docente</StatusPill>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ficha-body">
                  {[
                    {
                      title: 'Información general',
                      fields: [
                        { label: 'Docente', value: selectedCourse.teacher?.fullName },
                        { label: 'Banner', value: selectedCourse.bannerReviewStatus ?? selectedCourse.integrations.bannerExport?.status },
                        { label: 'Moodle API', value: selectedCourse.moodleCheck?.status },
                        { label: 'Tipo de aula', value: selectedCourse.integrations.moodleSidecar?.type },
                        { label: 'Estudiantes Moodle', value: selectedCourse.integrations.moodleSidecar?.participants?.toString() },
                        { label: 'Nombre en Moodle', value: selectedCourse.integrations.moodleSidecar?.moodleCourseName },
                      ],
                    },
                    {
                      title: 'Estado en Moodle',
                      fields: [
                        { label: 'Plantilla detectada', value: selectedCourse.moodleCheck?.detectedTemplate },
                        { label: 'Modalidad', value: selectedCourse.moodleCheck?.resolvedModality ?? selectedCourse.integrations.urlValidation?.modality },
                        { label: 'ID del aula', value: selectedCourse.integrations.moodleSidecar?.moodleCourseId ?? selectedCourse.moodleCheck?.moodleCourseId },
                        { label: 'Estudiantes detectados', value: selectedCourse.integrations.moodleSidecar?.participantsDetected?.toString() },
                      ],
                    },
                    {
                      title: 'Datos de Banner',
                      fields: [
                        { label: 'ID del docente', value: selectedCourse.integrations.bannerExport?.teacherId ?? selectedCourse.teacherId },
                        { label: 'Nombre', value: selectedCourse.integrations.bannerExport?.teacherName ?? selectedCourse.teacher?.fullName },
                        { label: 'Última verificación', value: formatDate(selectedCourse.integrations.bannerExport?.checkedAt) },
                        { label: 'Error', value: selectedCourse.integrations.bannerExport?.errorMessage },
                      ],
                    },
                    {
                      title: 'Estado de revisión',
                      fields: [
                        { label: 'Excluido', value: selectedCourse.reviewExcluded ? 'Sí' : 'No' },
                        { label: 'Razón', value: selectedCourse.reviewExcludedReason },
                        { label: 'Checklist activo', value: selectedCourse.checklistTemporal?.active ? 'Sí' : 'No' },
                        { label: 'Última fase', value: selectedCourse.evaluationSummary?.latestPhase },
                        { label: 'Puntaje alistamiento', value: formatScore(selectedCourse.evaluationSummary?.alistamientoScore) },
                        { label: 'Puntaje ejecución', value: formatScore(selectedCourse.evaluationSummary?.ejecucionScore) },
                      ],
                    },
                  ].map(({ title, fields }) => (
                    <div key={title} style={{ marginBottom: 16 }}>
                      <h3 style={{ margin: '0 0 8px', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
                        {title}
                      </h3>
                      <div className="kv-grid">
                        {fields.map((f) => (
                          <div key={f.label}>
                            <span>{f.label}</span>
                            <strong className={f.value ? '' : 'mini'}>{f.value || 'Sin información'}</strong>
                          </div>
                        ))}
                      </div>
                      {title === 'Estado en Moodle' && (
                        <div style={{ marginTop: 6 }}>
                          {selectedMoodleUrl ? (
                            <a href={selectedMoodleUrl} target="_blank" rel="noreferrer" className="inline-link">
                              Abrir URL Moodle →
                            </a>
                          ) : (
                            <span className="inline-muted">Sin URL final resuelta</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">Selecciona un curso para ver su ficha.</div>
            )}
          </aside>
        </div>
      )}

      {/* ════════════════════════════════
          INTEGRATIONS
      ════════════════════════════════ */}
      {activeView === 'integrations' && (
        <div style={{ padding: '0 32px 32px' }}>
          <article className="premium-card">
            <div style={{ marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                Estado de conexiones
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                Servicios y procesos activos en este momento
              </p>
            </div>

            <div className="integration-status-list">
              {[
                { name: 'Servicio principal (API)', pill: <StatusPill tone={data.apiReachable ? 'ok' : 'danger'}>{data.apiReachable ? 'Conectada' : 'Sin conexión'}</StatusPill> },
                { name: 'Conector Banner', pill: <StatusPill tone={data.banner.runner.running ? 'warn' : 'ok'}>{data.banner.runner.running ? 'En ejecución' : 'Inactivo'}</StatusPill> },
                { name: 'Clasificador Moodle', pill: <StatusPill tone={(data.sidecar.runner as { running?: boolean } | null)?.running ? 'warn' : 'ok'}>{(data.sidecar.runner as { running?: boolean } | null)?.running ? 'En ejecución' : 'Inactivo'}</StatusPill> },
                { name: 'Datos exportados Banner', pill: <StatusPill tone={data.banner.exportSummary.rowCount > 0 ? 'ok' : 'danger'}>{data.banner.exportSummary.rowCount} filas</StatusPill> },
                { name: 'Archivo de clasificación Moodle', pill: <StatusPill tone={data.sidecar.summary.rowCount > 0 ? 'ok' : 'danger'}>{data.sidecar.summary.rowCount} filas</StatusPill> },
                { name: 'Aulas sin estudiantes', pill: <StatusPill tone={data.sidecar.summary.emptyClassrooms > 0 ? 'danger' : 'ok'}>{data.sidecar.summary.emptyClassrooms}</StatusPill> },
                { name: 'Cola de procesamiento Moodle', pill: <StatusPill tone={(data.queue?.queue.active ?? 0) > 0 ? 'warn' : 'ok'}>{data.queue?.queue.active ?? 0} activos / {data.queue?.queue.waiting ?? 0} en espera</StatusPill> },
                { name: 'Última consulta Banner', pill: <span className="chip">{formatDate(data.banner.runner.lastRun?.endedAt ?? data.banner.runner.current?.startedAt)}</span> },
                { name: 'Última clasificación Moodle', pill: <span className="chip">{formatDate((data.sidecar.runner as { lastRun?: { endedAt?: string }; current?: { startedAt?: string } } | null)?.lastRun?.endedAt ?? (data.sidecar.runner as { current?: { startedAt?: string } } | null)?.current?.startedAt)}</span> },
              ].map(({ name, pill }) => (
                <div key={name} className="integration-row">
                  <span className="integration-name">{name}</span>
                  {pill}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '0.82rem', fontWeight: 600 }}>
                Resultados Banner por categoría
                <span className="panel-note" style={{ marginLeft: 8 }}>
                  Para ejecutar nuevas consultas, ve a <a href="/automatizacion-banner" className="inline-link">/automatizacion-banner</a>
                </span>
              </h3>
              <div className="badge-wall">
                {topBannerStatuses.map(([label, value]) => (
                  <span className="badge" key={label}>{label}: {value}</span>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 600 }}>Log reciente de Banner</h3>
              <pre className="log-block">{data.banner.runner.logTail || 'Sin actividad reciente.'}</pre>
            </div>
          </article>
        </div>
      )}

      {/* ════════════════════════════════
          FILES
      ════════════════════════════════ */}
      {activeView === 'files' && (
        <div style={{ padding: '0 32px 32px' }}>
          <article className="premium-card" style={{ padding: 0 }}>
            <div style={{ padding: '18px 20px 12px' }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
                Archivos del sistema
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                Archivos generados o importados automáticamente
              </p>
            </div>
            <div className="table-wrap" style={{ borderRadius: '0 0 var(--radius-md) var(--radius-md)', border: 'none', borderTop: '1px solid var(--line)' }}>
              <table className="fast-table">
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
                    <tr><td colSpan={5}>Sin archivos detectados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}
    </div>
  );
}
