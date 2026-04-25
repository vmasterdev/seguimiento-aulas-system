'use client';

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ActionResponse, CourseRecord, OpsData } from './lib/types';

type ViewKey = 'overview' | 'courses' | 'integrations' | 'files';
type TeacherFilter = 'ALL' | 'WITH_TEACHER' | 'WITHOUT_TEACHER';
type StatusFilter = 'ALL' | 'OK' | 'PENDING' | 'ERROR';
type BannerMode = 'lookup' | 'batch' | 'retry-errors' | 'export' | 'enrollment';
type SidecarCommand = 'classify' | 'revalidate' | 'backup' | 'gui';

const ADVANCED_MODULES = [
  {
    title: 'Carga RPACA',
    href: '/rpaca',
    description: 'Importa periodos nuevos y crea cursos base para el siguiente semestre o ano.',
  },
  {
    title: 'Docentes',
    href: '/docentes',
    description: 'Corrige docentes, correos y relaciones antes de correr Banner o enviar reportes.',
  },
  {
    title: 'Automatizacion Banner',
    href: '/automatizacion-banner',
    description: 'Usa el flujo nuevo por periodos cargados desde RPACA y previsualiza el lote antes de ejecutar.',
  },
  {
    title: 'Automatizacion Moodle',
    href: '/automatizacion-moodle',
    description: 'Lanza clasificacion Moodle desde la base y revisa lotes por periodos y momentos.',
  },
  {
    title: 'Revision NRC',
    href: '/review',
    description: 'Abre el checklist manual cuando un caso no debe resolverse por automatizacion.',
  },
  {
    title: 'NRC Globales',
    href: '/nrc-globales',
    description: 'Busca cursos, filtra casos y prepara previews o reenvios por similitud.',
  },
  {
    title: 'Trazabilidad NRC',
    href: '/nrc-trazabilidad',
    description: 'Consulta replicacion, origen de evaluaciones y trazabilidad por NRC.',
  },
  {
    title: 'Correos',
    href: '/correos',
    description: 'Controla preview, generacion y envio de correos a docentes, coordinadores y jefes.',
  },
] as const;

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
    .replace(/[\u0300-\u036f]/g, '')
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

async function postAction(action: string, payload: Record<string, unknown>) {
  const response = await fetch('/api/actions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, payload }),
  });
  const data = (await response.json()) as ActionResponse;
  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? `Fallo la accion ${action}`);
  }
  return data;
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
  const [busyAction, setBusyAction] = useState('');
  const [message, setMessage] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialData?.courses.items[0]?.id ?? null);

  const [courseSearch, setCourseSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [teacherFilter, setTeacherFilter] = useState<TeacherFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const deferredCourseSearch = useDeferredValue(courseSearch);

  const [queuePeriodCode, setQueuePeriodCode] = useState('202615');
  const [queueLimit, setQueueLimit] = useState('300');

  const [sidecarCommand, setSidecarCommand] = useState<SidecarCommand>('classify');
  const [sidecarWorkers, setSidecarWorkers] = useState('3');
  const [sidecarBrowser, setSidecarBrowser] = useState('chrome');
  const [sidecarInputDir, setSidecarInputDir] = useState('storage/inputs/rpaca_csv');
  const [sidecarOutput, setSidecarOutput] = useState('storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE.xlsx');
  const [sidecarMode, setSidecarMode] = useState('ambos');
  const [sidecarImportPath, setSidecarImportPath] = useState('');
  const [sidecarImportDryRun, setSidecarImportDryRun] = useState(true);
  const [sidecarImportSource, setSidecarImportSource] = useState('ops-studio-v2');

  const [bannerMode, setBannerMode] = useState<BannerMode>('lookup');
  const [bannerNrc, setBannerNrc] = useState('72305');
  const [bannerPeriod, setBannerPeriod] = useState('202615');
  const [bannerQueryName, setBannerQueryName] = useState('ops-studio-v2');
  const [bannerInputPath, setBannerInputPath] = useState('storage/benchmarks/nrc_globales_todos_S1_momento_1_md1.csv');
  const [bannerWorkers, setBannerWorkers] = useState('1');
  const [bannerResume, setBannerResume] = useState(false);
  const [bannerQueryId, setBannerQueryId] = useState('');
  const [bannerExportFormat, setBannerExportFormat] = useState('csv,json');

  const [killingBrowsers, setKillingBrowsers] = useState(false);
  const [killBrowsersResult, setKillBrowsersResult] = useState<string>('');
  const [bannerLoginResult, setBannerLoginResult] = useState<string>('');

  async function killBrowsers() {
    setKillingBrowsers(true);
    setKillBrowsersResult('');
    try {
      const res = await fetch('/api/system/kill-browsers', { method: 'POST' });
      const data = await res.json() as { ok: boolean; message: string };
      setKillBrowsersResult(data.message);
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
      const data = await res.json() as { ok: boolean; message?: string; error?: string };
      if (!data.ok) {
        setBannerLoginResult(`Error: ${data.error ?? data.message ?? 'Falló el login Banner.'}`);
        return;
      }
      setBannerLoginResult('Edge abierto. Completa SSO/2FA en la ventana, luego presiona "Guardar sesión Banner".');
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
      const data = await res.json() as { ok: boolean; message?: string; error?: string };
      if (!data.ok) {
        setBannerLoginResult(`Error: ${data.error ?? data.message ?? 'No se pudo guardar la sesión.'}`);
        return;
      }
      setBannerLoginResult('Sesión Banner guardada. Ya puedes ir a /docentes y presionar "Solo docentes".');
    } catch (err) {
      setBannerLoginResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function refreshData(silent = false) {
    try {
      if (!silent) {
        setLoading(true);
      }
      const response = await fetch('/api/ops', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const next = (await response.json()) as OpsData & { error?: string };
      if (!response.ok) {
        throw new Error(next.error ?? 'No fue posible cargar Ops Studio.');
      }
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
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (hasInitialData) return;
    void refreshData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void refreshData(true);
    }, 15000);
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

  async function runAction(action: string, payload: Record<string, unknown>) {
    try {
      setBusyAction(action);
      setMessage('');
      const result = await postAction(action, payload);
      setMessage(`${action} ejecutada correctamente.`);
      await refreshData(true);
      return result;
    } catch (error) {
      setMessage(`Fallo ${action}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      setBusyAction('');
    }
  }

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
              API {data.apiReachable ? 'conectada' : 'sin conexion'}
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
          API en 3001 no responde. Acciones de cursos, cola y sidecar no disponibles.
        </div>
      ) : null}

      {/* ── Stats grid: max 6 cards ── */}
      <section className="stats-grid">
        <StatCard label="Cursos" value={data.stats?.courses ?? data.courses.total} tone="teal" hint={`${data.derived.withoutTeacher} sin docente`} />
        <StatCard label="Docentes" value={data.derived.withTeacher} hint="con asignacion" />
        <StatCard label="Moodle OK" value={data.derived.moodleOk} hint={`${data.derived.moodlePending} pendientes`} />
        <StatCard label="URLs Moodle" value={data.derived.withMoodleUrl} hint={`${data.sidecar.urlValidation.rowCount} validadas`} />
        <StatCard label="Banner" value={data.derived.bannerFound} hint={`${data.derived.bannerWithoutTeacher} sin docente`} tone={data.derived.bannerWithoutTeacher > 0 ? 'amber' : 'default'} />
        <StatCard label="Cola activa" value={data.queue?.queue.active ?? 0} hint={`${data.queue?.queue.waiting ?? 0} en espera`} tone={(data.queue?.queue.active ?? 0) > 0 ? 'teal' : 'default'} />
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

          {/* Columna izquierda: acciones operativas como disclosures */}
          <article className="panel">
            <div className="panel-heading">
              <h2>Herramientas del sistema</h2>
              <span className="panel-note">Procesos automáticos de verificación y consulta</span>
            </div>

            <details className="disclosure">
              <summary>Verificar aulas en Moodle</summary>
              <div className="disclosure-body">
                <p className="disclosure-desc">Detecta aulas con estado pendiente o con error en Moodle y las pone en cola de verificación automática.</p>
                <div className="form-row">
                  <label>
                    Periodo
                    <input value={queuePeriodCode} onChange={(event) => setQueuePeriodCode(event.target.value)} />
                  </label>
                  <label>
                    Límite de aulas
                    <input value={queueLimit} onChange={(event) => setQueueLimit(event.target.value)} />
                  </label>
                </div>
                <div className="toolbar">
                  <button
                    onClick={() =>
                      void runAction('queue.enqueue', {
                        periodCode: queuePeriodCode.trim() || undefined,
                        limit: Number(queueLimit) || 300,
                        statuses: ['PENDIENTE'],
                      })
                    }
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Encolar pendientes
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void runAction('queue.retry', {
                        periodCode: queuePeriodCode.trim() || undefined,
                        limit: Number(queueLimit) || 300,
                      })
                    }
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Reintentar errores
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      void runAction('sampling.generate', {
                        periodCode: queuePeriodCode.trim() || undefined,
                        seed: `${queuePeriodCode.trim() || '202615'}-OPS-STUDIO`,
                      })
                    }
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Generar muestreo
                  </button>
                </div>
              </div>
            </details>

            <details className="disclosure">
              <summary>Clasificar aulas Moodle</summary>
              <div className="disclosure-body">
                <p className="disclosure-desc">Abre el navegador automáticamente y revisa cada aula en Moodle para clasificarla por tipo y detectar participantes.</p>
                <div className="form-row">
                  <label>
                    Operación
                    <select value={sidecarCommand} onChange={(event) => setSidecarCommand(event.target.value as SidecarCommand)}>
                      <option value="classify">Clasificar aulas</option>
                      <option value="revalidate">Revalidar clasificaciones</option>
                      <option value="backup">Crear respaldo</option>
                      <option value="gui">Modo manual</option>
                    </select>
                  </label>
                  <label>
                    Navegadores paralelos
                    <input value={sidecarWorkers} onChange={(event) => setSidecarWorkers(event.target.value)} />
                  </label>
                  <label>
                    Navegador
                    <select value={sidecarBrowser} onChange={(event) => setSidecarBrowser(event.target.value)}>
                      <option value="chrome">Chrome</option>
                      <option value="edge">Edge</option>
                    </select>
                  </label>
                </div>
                <div className="toolbar">
                  <button
                    onClick={() =>
                      void runAction('sidecar.start', {
                        command: sidecarCommand,
                        workers: Number(sidecarWorkers) || 3,
                        browser: sidecarBrowser,
                        inputDir: sidecarInputDir,
                        output: sidecarOutput,
                        mode: sidecarMode,
                      })
                    }
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Iniciar clasificación
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void runAction('sidecar.import', {
                        inputPath: sidecarImportPath || undefined,
                        dryRun: sidecarImportDryRun,
                        sourceLabel: sidecarImportSource,
                      })
                    }
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Cargar resultados
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => void runAction('sidecar.cancel', {})}
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </details>

            <details className="disclosure">
              <summary>Consultar docente en Banner</summary>
              <div className="disclosure-body">
                <p className="disclosure-desc">Consulta el sistema Banner para obtener el nombre e información del docente asignado a un NRC específico.</p>
                <div className="form-row">
                  <label>
                    NRC
                    <input value={bannerNrc} onChange={(event) => setBannerNrc(event.target.value)} />
                  </label>
                  <label>
                    Período
                    <input value={bannerPeriod} onChange={(event) => setBannerPeriod(event.target.value)} />
                  </label>
                </div>
                <div className="toolbar">
                  <button
                    onClick={() =>
                      void runAction('banner.start', {
                        command: 'lookup',
                        nrc: bannerNrc,
                        period: bannerPeriod,
                        queryName: bannerQueryName,
                      })
                    }
                    disabled={busyAction !== ''}
                  >
                    Consultar NRC
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void runAction('banner.start', {
                        command: 'batch',
                        input: bannerInputPath,
                        period: bannerPeriod,
                        queryName: bannerQueryName,
                        workers: Number(bannerWorkers) || 1,
                        resume: bannerResume,
                      })
                    }
                    disabled={busyAction !== ''}
                  >
                    Consulta por lote
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => void runAction('banner.cancel', {})}
                    disabled={busyAction !== ''}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </details>

            <details className="disclosure">
              <summary>Mantenimiento de navegadores</summary>
              <div className="disclosure-body">
                <p className="disclosure-desc">
                  <strong>Paso A:</strong> Click <strong>Limpiar navegadores</strong> si Edge está bloqueado.
                  {' '}<strong>Paso B:</strong> Click <strong>1. Abrir login Banner</strong> → completa SSO/2FA en Edge.
                  {' '}<strong>Paso C:</strong> Click <strong>2. Guardar sesión Banner</strong> (MUY IMPORTANTE — sin esto la sesión no persiste).
                  {' '}Listo → ve a /docentes → Solo docentes.
                </p>
                <div className="toolbar">
                  <button
                    style={{ background: '#7f1d1d', color: '#fff' }}
                    disabled={killingBrowsers}
                    onClick={() => void killBrowsers()}
                  >
                    {killingBrowsers ? 'Limpiando...' : 'Limpiar navegadores colgados'}
                  </button>
                  <button
                    style={{ background: '#92400e', color: '#fff' }}
                    onClick={() => void startBannerLogin()}
                  >
                    1. Abrir login Banner
                  </button>
                  <button
                    style={{ background: '#15803d', color: '#fff' }}
                    onClick={() => void confirmBannerLogin()}
                  >
                    2. Guardar sesión Banner
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

            <details className="disclosure" open>
              <summary>Ir a otras secciones</summary>
              <div className="disclosure-body">
                <div className="module-cards">
                  {ADVANCED_MODULES.map((item) => (
                    <a key={item.href} className="module-card" href={item.href}>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </a>
                  ))}
                </div>
              </div>
            </details>
          </article>

          {/* Columna derecha: atencion prioritaria + metricas sidecar */}
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

          {/* Fila inferior: sidecar preview + outbox */}
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
              <span className="panel-note">{data.outbox.total} mensajes por enviar</span>
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
              <span className="panel-note">{filteredCourses.length} resultados encontrados</span>
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
                    <th>Estado Moodle</th>
                    <th>Tipo de aula</th>
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

          <aside className="panel course-detail">
            <div className="panel-heading">
              <h2>Detalle del curso</h2>
              <span className="panel-note">Moodle · Banner · Revisión</span>
            </div>
            {selectedCourse ? (
              <div className="detail-stack">
                <div className="detail-header">
                  <h3>{selectedCourse.nrc}</h3>
                  <span className="chip">{selectedCourse.period.code}</span>
                </div>
                <p className="detail-title">{selectedCourse.subjectName ?? 'Sin asignatura'}</p>

                <div className="kv-grid">
                  <div>
                    <span>Docente</span>
                    <strong>{selectedCourse.teacher?.fullName ?? 'Sin docente'}</strong>
                  </div>
                  <div>
                    <span>Banner</span>
                    <strong>{selectedCourse.bannerReviewStatus ?? selectedCourse.integrations.bannerExport?.status ?? '-'}</strong>
                  </div>
                  <div>
                    <span>Moodle API</span>
                    <strong>{selectedCourse.moodleCheck?.status ?? '-'}</strong>
                  </div>
                  <div>
                    <span>Tipo de aula</span>
                    <strong>{selectedCourse.integrations.moodleSidecar?.type ?? '-'}</strong>
                  </div>
                  <div>
                    <span>Estudiantes Moodle</span>
                    <strong>{selectedCourse.integrations.moodleSidecar?.participants ?? '-'}</strong>
                  </div>
                  <div>
                    <span>Nombre en Moodle</span>
                    <strong>{selectedCourse.integrations.moodleSidecar?.moodleCourseName ?? '-'}</strong>
                  </div>
                </div>

                <div className="detail-group">
                  <h4>Estado en Moodle</h4>
                  <div className="detail-lines">
                    <div>Plantilla detectada: {selectedCourse.moodleCheck?.detectedTemplate ?? '-'}</div>
                    <div>Modalidad: {selectedCourse.moodleCheck?.resolvedModality ?? selectedCourse.integrations.urlValidation?.modality ?? '-'}</div>
                    <div>ID del aula Moodle: {selectedCourse.integrations.moodleSidecar?.moodleCourseId ?? selectedCourse.moodleCheck?.moodleCourseId ?? '-'}</div>
                    <div>Estudiantes detectados: {selectedCourse.integrations.moodleSidecar?.participantsDetected ?? '-'}</div>
                  </div>
                  {selectedMoodleUrl ? (
                    <a href={selectedMoodleUrl} target="_blank" rel="noreferrer" className="inline-link">
                      Abrir URL Moodle
                    </a>
                  ) : (
                    <span className="inline-muted">Sin URL final resuelta</span>
                  )}
                </div>

                <div className="detail-group">
                  <h4>Datos de Banner</h4>
                  <div className="detail-lines">
                    <div>ID del docente: {selectedCourse.integrations.bannerExport?.teacherId ?? selectedCourse.teacherId ?? '-'}</div>
                    <div>Nombre del docente: {selectedCourse.integrations.bannerExport?.teacherName ?? selectedCourse.teacher?.fullName ?? '-'}</div>
                    <div>Última verificación: {formatDate(selectedCourse.integrations.bannerExport?.checkedAt)}</div>
                    <div>Mensaje de error: {selectedCourse.integrations.bannerExport?.errorMessage ?? '-'}</div>
                  </div>
                </div>

                <div className="detail-group">
                  <h4>Estado de revisión</h4>
                  <div className="detail-lines">
                    <div>Excluido de revisión: {selectedCourse.reviewExcluded ? 'Sí' : 'No'}</div>
                    <div>Razón de exclusión: {selectedCourse.reviewExcludedReason ?? '-'}</div>
                    <div>Checklist activo: {selectedCourse.checklistTemporal?.active ? 'Sí' : 'No'}</div>
                    <div>Calificación alistamiento: {formatScore(selectedCourse.evaluationSummary?.alistamientoScore)}</div>
                    <div>Calificación ejecución: {formatScore(selectedCourse.evaluationSummary?.ejecucionScore)}</div>
                    <div>Última fase evaluada: {selectedCourse.evaluationSummary?.latestPhase ?? '-'}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">Selecciona un curso para ver su ficha integrada.</div>
            )}
          </aside>
        </section>
      ) : null}

      {/* ════════════════════════════════
          INTEGRATIONS
      ════════════════════════════════ */}
      {activeView === 'integrations' ? (
        <section className="dashboard-grid">

          {/* Estado de integraciones: chips de estado */}
          <article className="panel">
            <div className="panel-heading">
              <h2>Estado de conexiones</h2>
              <span className="panel-note">Servicios activos y su último estado</span>
            </div>
            <div className="integration-status-list">
              <div className="integration-row">
                <span className="integration-name">Servicio principal (API)</span>
                <span className={`chip ${data.apiReachable ? 'chip-ok' : 'chip-alert'}`}>
                  {data.apiReachable ? 'Conectada' : 'Sin conexion'}
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Conector Banner</span>
                <span className={`chip ${data.banner.runner.running ? 'chip-warn' : 'chip-ok'}`}>
                  {data.banner.runner.running ? 'En ejecucion' : 'Inactivo'}
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Clasificador Moodle</span>
                <span className={`chip ${(data.sidecar.runner as { running?: boolean } | null)?.running ? 'chip-warn' : 'chip-ok'}`}>
                  {(data.sidecar.runner as { running?: boolean } | null)?.running ? 'En ejecucion' : 'Inactivo'}
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Datos exportados Banner</span>
                <span className={`chip ${data.banner.exportSummary.rowCount > 0 ? 'chip-ok' : 'chip-alert'}`}>
                  {data.banner.exportSummary.rowCount} filas
                </span>
              </div>
              <div className="integration-row">
                <span className="integration-name">Archivo de clasificación</span>
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
                <span className="integration-name">Cola de procesamiento</span>
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
            </div>
            <div className="badge-wall">
              {topBannerStatuses.map(([label, value]) => (
                <span className="badge" key={label}>
                  {label}: {value}
                </span>
              ))}
            </div>
          </article>

          {/* Control Sidecar */}
          <article className="panel">
            <div className="panel-heading">
              <h2>Clasificador de aulas Moodle</h2>
              <span className="panel-note">Inicia el proceso automático que revisa cada aula y la clasifica</span>
            </div>

            <details className="disclosure" open>
              <summary>Iniciar clasificación</summary>
              <div className="disclosure-body">
                <div className="form-grid">
                  <label>
                    Operación
                    <select value={sidecarCommand} onChange={(event) => setSidecarCommand(event.target.value as SidecarCommand)}>
                      <option value="classify">Clasificar aulas</option>
                      <option value="revalidate">Revalidar clasificaciones</option>
                      <option value="backup">Crear respaldo</option>
                      <option value="gui">Modo manual</option>
                    </select>
                  </label>
                  <label>
                    Navegadores paralelos
                    <input value={sidecarWorkers} onChange={(event) => setSidecarWorkers(event.target.value)} />
                  </label>
                  <label>
                    Navegador
                    <select value={sidecarBrowser} onChange={(event) => setSidecarBrowser(event.target.value)}>
                      <option value="chrome">Chrome</option>
                      <option value="edge">Edge</option>
                    </select>
                  </label>
                  <label>
                    Modo de revalidación
                    <select value={sidecarMode} onChange={(event) => setSidecarMode(event.target.value)}>
                      <option value="ambos">Todos</option>
                      <option value="sin_matricula">Sin matrícula</option>
                      <option value="aulas_vacias">Aulas vacías</option>
                    </select>
                  </label>
                  <label className="wide">
                    Carpeta de entrada
                    <input value={sidecarInputDir} onChange={(event) => setSidecarInputDir(event.target.value)} />
                  </label>
                  <label className="wide">
                    Archivo de salida
                    <input value={sidecarOutput} onChange={(event) => setSidecarOutput(event.target.value)} />
                  </label>
                </div>
                <div className="toolbar">
                  <button
                    onClick={() =>
                      void runAction('sidecar.start', {
                        command: sidecarCommand,
                        workers: Number(sidecarWorkers) || 3,
                        browser: sidecarBrowser,
                        inputDir: sidecarInputDir || undefined,
                        output: sidecarOutput || undefined,
                        mode: sidecarMode,
                      })
                    }
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Iniciar clasificación
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void runAction('sidecar.cancel', {})}
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Cancelar
                  </button>
                  <button className="ghost-button" onClick={() => void refreshData()} disabled={loading}>
                    Refrescar estado
                  </button>
                </div>
              </div>
            </details>

            <details className="disclosure">
              <summary>Cargar resultados a la base</summary>
              <div className="disclosure-body">
                <div className="form-grid">
                  <label className="wide">
                    Archivo de resultados (opcional)
                    <input value={sidecarImportPath} onChange={(event) => setSidecarImportPath(event.target.value)} placeholder="Dejar vacío para usar el último detectado" />
                  </label>
                  <label>
                    Etiqueta de importación
                    <input value={sidecarImportSource} onChange={(event) => setSidecarImportSource(event.target.value)} />
                  </label>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={sidecarImportDryRun}
                      onChange={(event) => setSidecarImportDryRun(event.target.checked)}
                    />
                    <span>Solo simular (sin guardar)</span>
                  </label>
                </div>
                <div className="toolbar">
                  <button
                    onClick={() =>
                      void runAction('sidecar.import', {
                        inputPath: sidecarImportPath || undefined,
                        dryRun: sidecarImportDryRun,
                        sourceLabel: sidecarImportSource,
                      })
                    }
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Cargar a la base de datos
                  </button>
                </div>
              </div>
            </details>
          </article>

          {/* Control Banner */}
          <article className="panel">
            <div className="panel-heading">
              <h2>Consultas a Banner</h2>
              <span className="panel-note">Busca y actualiza datos de docentes directamente desde Banner</span>
            </div>

            <details className="disclosure" open>
              <summary>Ejecutar consulta</summary>
              <div className="disclosure-body">
                <div className="form-grid">
                  <label>
                    Tipo de consulta
                    <select value={bannerMode} onChange={(event) => setBannerMode(event.target.value as BannerMode)}>
                      <option value="lookup">NRC individual</option>
                      <option value="batch">Lote desde CSV</option>
                      <option value="retry-errors">Reintentar fallidos</option>
                      <option value="export">Exportar resultados</option>
                    </select>
                  </label>
                  <label>
                    NRC
                    <input value={bannerNrc} onChange={(event) => setBannerNrc(event.target.value)} />
                  </label>
                  <label>
                    Período
                    <input value={bannerPeriod} onChange={(event) => setBannerPeriod(event.target.value)} />
                  </label>
                  <label>
                    Referencia de consulta
                    <input value={bannerQueryName} onChange={(event) => setBannerQueryName(event.target.value)} />
                  </label>
                  <label className="wide">
                    Archivo CSV de entrada
                    <input value={bannerInputPath} onChange={(event) => setBannerInputPath(event.target.value)} />
                  </label>
                  <label>
                    Hilos paralelos
                    <input value={bannerWorkers} onChange={(event) => setBannerWorkers(event.target.value)} />
                  </label>
                  <label>
                    ID de consulta
                    <input value={bannerQueryId} onChange={(event) => setBannerQueryId(event.target.value)} />
                  </label>
                  <label>
                    Formato de exportación
                    <input value={bannerExportFormat} onChange={(event) => setBannerExportFormat(event.target.value)} />
                  </label>
                  <label className="checkbox-line">
                    <input type="checkbox" checked={bannerResume} onChange={(event) => setBannerResume(event.target.checked)} />
                    <span>Continuar desde donde quedó</span>
                  </label>
                </div>
                <div className="toolbar">
                  <button
                    onClick={() => {
                      if (bannerMode === 'lookup') {
                        void runAction('banner.start', { command: 'lookup', nrc: bannerNrc, period: bannerPeriod, queryName: bannerQueryName });
                        return;
                      }
                      if (bannerMode === 'batch') {
                        void runAction('banner.start', { command: 'batch', input: bannerInputPath, period: bannerPeriod, queryName: bannerQueryName, queryId: bannerQueryId || undefined, workers: Number(bannerWorkers) || 1, resume: bannerResume });
                        return;
                      }
                      if (bannerMode === 'retry-errors') {
                        void runAction('banner.start', { command: 'retry-errors', queryId: bannerQueryId, workers: Number(bannerWorkers) || 1 });
                        return;
                      }
                      void runAction('banner.start', { command: 'export', queryId: bannerQueryId, format: bannerExportFormat });
                    }}
                    disabled={busyAction !== ''}
                  >
                    Ejecutar
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void runAction('banner.cancel', {})}
                    disabled={busyAction !== ''}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </details>

            <details className="disclosure">
              <summary>Registro de ejecución Banner</summary>
              <div className="disclosure-body">
                <pre className="log-block">{data.banner.runner.logTail || 'Sin log de Banner aun.'}</pre>
              </div>
            </details>
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
                    <th>Categoria</th>
                    <th>Tamano</th>
                    <th>Modificado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.files.map((file) => (
                    <tr key={file.path}>
                      <td>{file.name}</td>
                      <td>{file.source}</td>
                      <td>{file.category}</td>
                      <td>{file.sizeLabel}</td>
                      <td>{formatDate(file.modifiedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Resultados de Banner</h2>
              <span className="panel-note">{data.banner.exportSummary.rowCount} registros consultados</span>
            </div>
            <div className="badge-wall">
              {topBannerStatuses.map(([label, value]) => (
                <span className="badge" key={label}>
                  {label}: {value}
                </span>
              ))}
            </div>
            <div className="table-wrap">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Docente</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.banner.exportSummary.preview.map((item) => (
                    <tr key={`${item.nrc}-${item.teacherId ?? item.status ?? 'x'}`}>
                      <td>{item.nrc}</td>
                      <td>{item.teacherName ?? '-'}</td>
                      <td>
                        <span className={`chip ${item.status === 'ENCONTRADO' ? 'chip-ok' : item.status ? 'chip-warn' : 'chip-alert'}`}>
                          {item.status ?? '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>URLs de aulas Moodle</h2>
              <span className="panel-note">{data.sidecar.urlValidation.withUrlCount} URLs resueltas</span>
            </div>
            <div className="table-wrap">
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Docente</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sidecar.urlValidation.preview.map((item) => (
                    <tr key={`${item.nrc}-${item.moodleUrl ?? 'x'}`}>
                      <td>{item.nrc}</td>
                      <td>{item.teacherName ?? '-'}</td>
                      <td>
                        {item.moodleUrl ? (
                          <a href={item.moodleUrl} target="_blank" rel="noreferrer" className="inline-link">
                            Abrir
                          </a>
                        ) : (
                          <span className="chip chip-alert">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}
    </div>
  );
}
