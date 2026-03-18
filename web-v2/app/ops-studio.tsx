'use client';

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ActionResponse, CourseRecord, OpsData } from './lib/types';

type ViewKey = 'overview' | 'courses' | 'integrations' | 'files';
type TeacherFilter = 'ALL' | 'WITH_TEACHER' | 'WITHOUT_TEACHER';
type StatusFilter = 'ALL' | 'OK' | 'PENDING' | 'ERROR';
type BannerMode = 'lookup' | 'batch' | 'retry-errors' | 'export';
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

  const topTypeCounts = formatListMap(data.sidecar.summary.typeCounts).slice(0, 6);
  const topBannerStatuses = formatListMap(data.banner.exportSummary.statusCounts).slice(0, 6);
  const selectedMoodleUrl =
    selectedCourse?.integrations.urlValidation?.moodleUrl ?? selectedCourse?.moodleCheck?.moodleCourseUrl ?? null;

  return (
    <div className="shell">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Nueva version paralela</span>
          <h1>Ops Studio V2</h1>
          <p>
            Centro operativo visual para monitorear cursos, trazabilidad, Banner docente y el sidecar de Moodle desde
            una sola interfaz.
          </p>
          <div className="hero-meta">
            <span className={`chip ${data.apiReachable ? 'chip-ok' : 'chip-alert'}`}>
              API {data.apiReachable ? 'conectada' : 'sin conexion'}
            </span>
            <span className="chip">Actualizado: {formatDate(data.generatedAt)}</span>
            <span className="chip">API base: {data.apiBase}</span>
          </div>
        </div>

        <div className="hero-actions">
          <button className="primary-button" onClick={() => void refreshData()} disabled={loading}>
            {loading ? 'Actualizando...' : 'Refrescar tablero'}
          </button>
          <div className="button-row">
            <a className="secondary-button" href="/correos">
              Abrir Correos
            </a>
            <a className="ghost-button" href="/automatizacion-banner">
              Banner avanzado
            </a>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span>Auto refresh 15s</span>
          </label>
          <div className="path-stack">
            <span>{data.projectRoot}</span>
            <span>{data.bannerProjectRoot}</span>
          </div>
        </div>
      </section>

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

      {loading && !data.generatedAt ? <div className="flash">Cargando tablero operativo...</div> : null}
      {message ? <div className="flash">{message}</div> : null}
      {!data.apiReachable ? (
        <div className="flash flash-warning">
          La API en `3001` no esta respondiendo. El dashboard sigue mostrando archivos, Banner y estado local, pero las
          acciones contra cursos/cola/sidecar no podran ejecutarse hasta levantar la API.
        </div>
      ) : null}

      <section className="stats-grid">
        <StatCard label="Cursos" value={data.stats?.courses ?? data.courses.total} tone="teal" />
        <StatCard label="Docentes enlazados" value={data.derived.withTeacher} hint={`${data.derived.withoutTeacher} sin docente`} />
        <StatCard label="Moodle OK" value={data.derived.moodleOk} hint={`${data.derived.moodlePending} pendientes`} />
        <StatCard label="URLs Moodle" value={data.derived.withMoodleUrl} hint={`${data.sidecar.urlValidation.rowCount} filas validadas`} />
        <StatCard label="Banner encontrados" value={data.derived.bannerFound} hint={`${data.derived.bannerWithoutTeacher} sin docente`} />
        <StatCard label="Outbox draft" value={data.outbox.total} tone="amber" />
        <StatCard label="Aulas vacias" value={data.sidecar.summary.emptyClassrooms} tone="red" />
        <StatCard label="Workers cola" value={data.queue?.queue.active ?? 0} hint={`waiting ${data.queue?.queue.waiting ?? 0}`} />
      </section>

      {activeView === 'overview' ? (
        <section className="dashboard-grid">
          <article className="panel panel-span-2">
            <div className="panel-heading">
              <h2>Ruta operativa</h2>
              <span className="panel-note">Acciones rapidas sobre la plataforma actual</span>
            </div>
            <div className="action-grid">
              <div className="action-card">
                <h3>Cola Moodle</h3>
                <label>
                  Periodo
                  <input value={queuePeriodCode} onChange={(event) => setQueuePeriodCode(event.target.value)} />
                </label>
                <label>
                  Limite
                  <input value={queueLimit} onChange={(event) => setQueueLimit(event.target.value)} />
                </label>
                <div className="button-row">
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
                    Encolar
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
                    Reintentar
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
                    Muestreo
                  </button>
                </div>
              </div>

              <div className="action-card">
                <h3>Sidecar Moodle</h3>
                <div className="stacked-metrics">
                  <span className="chip">Ultimo archivo: {data.sidecar.summary.rowCount} filas</span>
                  <span className="chip">Promedio participantes: {data.sidecar.summary.participantAverage ?? '-'}</span>
                  <span className="chip">Con URL: {data.sidecar.urlValidation.withUrlCount}</span>
                </div>
                <div className="button-row">
                  <button
                    onClick={() =>
                      void runAction('sidecar.start', {
                        command: 'classify',
                        workers: Number(sidecarWorkers) || 3,
                        browser: sidecarBrowser,
                        inputDir: sidecarInputDir,
                        output: sidecarOutput,
                      })
                    }
                    disabled={busyAction !== '' || !data.apiReachable}
                  >
                    Clasificar ahora
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
                    Importar al sistema
                  </button>
                </div>
              </div>

              <div className="action-card">
                <h3>Banner docente</h3>
                <div className="stacked-metrics">
                  <span className="chip">Export actual: {data.banner.exportSummary.rowCount} filas</span>
                  {topBannerStatuses.map(([label, value]) => (
                    <span className="chip" key={label}>
                      {label}: {value}
                    </span>
                  ))}
                </div>
                <div className="button-row">
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
                    Lookup Banner
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
                    Lote Banner
                  </button>
                </div>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Atencion prioritaria</h2>
              <span className="panel-note">Cruzado entre cursos, Banner y sidecar</span>
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
                <div className="empty-state">No hay alertas destacadas en este corte.</div>
              )}
            </div>
          </article>

          <article className="panel panel-span-2">
            <div className="panel-heading">
              <h2>Modulos avanzados</h2>
              <span className="panel-note">Acceso directo a los modulos completos de esta misma version</span>
            </div>
            <div className="action-grid">
              {ADVANCED_MODULES.map((item) => (
                <div className="action-card" key={item.href}>
                  <h3>{item.title}</h3>
                  <p className="panel-note">{item.description}</p>
                  <div className="button-row">
                    <a className="secondary-button" href={item.href}>
                      Abrir modulo
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Moodle sidecar</h2>
              <span className="panel-note">Tipos detectados y rendimiento</span>
            </div>
            <div className="badge-wall">
              {topTypeCounts.map(([label, value]) => (
                <span className="badge" key={label}>
                  {label}: {value}
                </span>
              ))}
            </div>
            <table className="compact-table">
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Tipo</th>
                  <th>Participantes</th>
                  <th>Curso</th>
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
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Outbox borrador</h2>
              <span className="panel-note">Mensajes listos para revision</span>
            </div>
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
          </article>
        </section>
      ) : null}

      {activeView === 'courses' ? (
        <section className="courses-layout">
          <article className="panel">
            <div className="panel-heading">
              <h2>Explorador de cursos</h2>
              <span className="panel-note">{filteredCourses.length} resultados visibles</span>
            </div>
            <div className="filters">
              <label>
                Buscar
                <input
                  value={courseSearch}
                  onChange={(event) => setCourseSearch(event.target.value)}
                  placeholder="NRC, docente, URL, tipo, asignatura..."
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
                  <option value="PENDING">Pendiente / revisar</option>
                  <option value="ERROR">Error / descarte</option>
                </select>
              </label>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Asignatura</th>
                    <th>Docente</th>
                    <th>Moodle</th>
                    <th>Sidecar</th>
                    <th>URL</th>
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
                      <td>{course.teacher?.fullName ?? 'Sin docente'}</td>
                      <td>
                        {course.moodleCheck?.status ?? 'SIN_CHECK'}
                        <div className="mini">{course.moodleCheck?.detectedTemplate ?? '-'}</div>
                      </td>
                      <td>
                        {course.integrations.moodleSidecar?.type ?? '-'}
                        <div className="mini">
                          {course.integrations.moodleSidecar?.participants != null
                            ? `${course.integrations.moodleSidecar.participants} usuarios`
                            : 'sin dato'}
                        </div>
                      </td>
                      <td>{course.integrations.urlValidation?.moodleUrl ? 'Disponible' : 'Pendiente'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <aside className="panel course-detail">
            <div className="panel-heading">
              <h2>Ficha integrada</h2>
              <span className="panel-note">API + Banner + sidecar + archivos</span>
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
                    <span>Tipo sidecar</span>
                    <strong>{selectedCourse.integrations.moodleSidecar?.type ?? '-'}</strong>
                  </div>
                  <div>
                    <span>Participantes</span>
                    <strong>{selectedCourse.integrations.moodleSidecar?.participants ?? '-'}</strong>
                  </div>
                  <div>
                    <span>Curso Moodle</span>
                    <strong>{selectedCourse.integrations.moodleSidecar?.moodleCourseName ?? '-'}</strong>
                  </div>
                </div>

                <div className="detail-group">
                  <h4>Integracion Moodle</h4>
                  <div className="detail-lines">
                    <div>Template: {selectedCourse.moodleCheck?.detectedTemplate ?? '-'}</div>
                    <div>Mod. resuelta: {selectedCourse.moodleCheck?.resolvedModality ?? selectedCourse.integrations.urlValidation?.modality ?? '-'}</div>
                    <div>Query usada: {selectedCourse.integrations.moodleSidecar?.queryUsed ?? selectedCourse.moodleCheck?.searchQuery ?? '-'}</div>
                    <div>Course ID: {selectedCourse.integrations.moodleSidecar?.moodleCourseId ?? selectedCourse.moodleCheck?.moodleCourseId ?? '-'}</div>
                    <div>Usuarios detectados: {selectedCourse.integrations.moodleSidecar?.participantsDetected ?? '-'}</div>
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
                  <h4>Integracion Banner</h4>
                  <div className="detail-lines">
                    <div>Teacher ID: {selectedCourse.integrations.bannerExport?.teacherId ?? selectedCourse.teacherId ?? '-'}</div>
                    <div>Teacher name: {selectedCourse.integrations.bannerExport?.teacherName ?? selectedCourse.teacher?.fullName ?? '-'}</div>
                    <div>Checked at: {formatDate(selectedCourse.integrations.bannerExport?.checkedAt)}</div>
                    <div>Error: {selectedCourse.integrations.bannerExport?.errorMessage ?? '-'}</div>
                  </div>
                </div>

                <div className="detail-group">
                  <h4>Revision y muestreo</h4>
                  <div className="detail-lines">
                    <div>Excluido: {selectedCourse.reviewExcluded ? 'Si' : 'No'}</div>
                    <div>Razon: {selectedCourse.reviewExcludedReason ?? '-'}</div>
                    <div>Checklist temporal: {selectedCourse.checklistTemporal?.active ? 'Activo' : 'No'}</div>
                    <div>Alistamiento: {formatScore(selectedCourse.evaluationSummary?.alistamientoScore)}</div>
                    <div>Ejecucion: {formatScore(selectedCourse.evaluationSummary?.ejecucionScore)}</div>
                    <div>Ultima fase: {selectedCourse.evaluationSummary?.latestPhase ?? '-'}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">Selecciona un curso para ver su ficha integrada.</div>
            )}
          </aside>
        </section>
      ) : null}

      {activeView === 'integrations' ? (
        <section className="dashboard-grid">
          <article className="panel panel-span-2">
            <div className="panel-heading">
              <h2>Control Sidecar Moodle</h2>
              <span className="panel-note">Ejecucion, importacion y log en vivo</span>
            </div>

            <div className="form-grid">
              <label>
                Comando
                <select value={sidecarCommand} onChange={(event) => setSidecarCommand(event.target.value as SidecarCommand)}>
                  <option value="classify">classify</option>
                  <option value="revalidate">revalidate</option>
                  <option value="backup">backup</option>
                  <option value="gui">gui</option>
                </select>
              </label>
              <label>
                Workers
                <input value={sidecarWorkers} onChange={(event) => setSidecarWorkers(event.target.value)} />
              </label>
              <label>
                Browser
                <select value={sidecarBrowser} onChange={(event) => setSidecarBrowser(event.target.value)}>
                  <option value="edge">edge</option>
                  <option value="chrome">chrome</option>
                </select>
              </label>
              <label>
                Modo revalidate
                <select value={sidecarMode} onChange={(event) => setSidecarMode(event.target.value)}>
                  <option value="ambos">ambos</option>
                  <option value="sin_matricula">sin_matricula</option>
                  <option value="aulas_vacias">aulas_vacias</option>
                </select>
              </label>
              <label className="wide">
                input-dir
                <input value={sidecarInputDir} onChange={(event) => setSidecarInputDir(event.target.value)} />
              </label>
              <label className="wide">
                output
                <input value={sidecarOutput} onChange={(event) => setSidecarOutput(event.target.value)} />
              </label>
            </div>

            <div className="button-row">
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
                Iniciar sidecar
              </button>
              <button
                className="secondary-button"
                onClick={() => void runAction('sidecar.cancel', {})}
                disabled={busyAction !== '' || !data.apiReachable}
              >
                Cancelar sidecar
              </button>
              <button className="ghost-button" onClick={() => void refreshData()} disabled={loading}>
                Leer estado
              </button>
            </div>

            <div className="subpanel">
              <div className="subpanel-header">
                <strong>Importar resultados sidecar</strong>
                <span>{data.sidecar.urlValidation.latestFile ?? 'Sin archivo detectado'}</span>
              </div>
              <div className="form-grid">
                <label className="wide">
                  inputPath
                  <input value={sidecarImportPath} onChange={(event) => setSidecarImportPath(event.target.value)} />
                </label>
                <label>
                  sourceLabel
                  <input value={sidecarImportSource} onChange={(event) => setSidecarImportSource(event.target.value)} />
                </label>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={sidecarImportDryRun}
                    onChange={(event) => setSidecarImportDryRun(event.target.checked)}
                  />
                  <span>dry run</span>
                </label>
              </div>
              <div className="button-row">
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
                  Importar a la base actual
                </button>
              </div>
            </div>

            <pre className="log-block">{JSON.stringify(data.sidecar.runner ?? {}, null, 2)}</pre>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Banner desde la web</h2>
              <span className="panel-note">Lookup, batch, retry y export</span>
            </div>
            <div className="form-grid">
              <label>
                Accion
                <select value={bannerMode} onChange={(event) => setBannerMode(event.target.value as BannerMode)}>
                  <option value="lookup">lookup</option>
                  <option value="batch">batch</option>
                  <option value="retry-errors">retry-errors</option>
                  <option value="export">export</option>
                </select>
              </label>
              <label>
                NRC
                <input value={bannerNrc} onChange={(event) => setBannerNrc(event.target.value)} />
              </label>
              <label>
                Periodo
                <input value={bannerPeriod} onChange={(event) => setBannerPeriod(event.target.value)} />
              </label>
              <label>
                Query name
                <input value={bannerQueryName} onChange={(event) => setBannerQueryName(event.target.value)} />
              </label>
              <label className="wide">
                Input batch
                <input value={bannerInputPath} onChange={(event) => setBannerInputPath(event.target.value)} />
              </label>
              <label>
                Workers
                <input value={bannerWorkers} onChange={(event) => setBannerWorkers(event.target.value)} />
              </label>
              <label>
                Query ID
                <input value={bannerQueryId} onChange={(event) => setBannerQueryId(event.target.value)} />
              </label>
              <label>
                Export format
                <input value={bannerExportFormat} onChange={(event) => setBannerExportFormat(event.target.value)} />
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={bannerResume} onChange={(event) => setBannerResume(event.target.checked)} />
                <span>resume</span>
              </label>
            </div>
            <div className="button-row">
              <button
                onClick={() => {
                  if (bannerMode === 'lookup') {
                    void runAction('banner.start', {
                      command: 'lookup',
                      nrc: bannerNrc,
                      period: bannerPeriod,
                      queryName: bannerQueryName,
                    });
                    return;
                  }
                  if (bannerMode === 'batch') {
                    void runAction('banner.start', {
                      command: 'batch',
                      input: bannerInputPath,
                      period: bannerPeriod,
                      queryName: bannerQueryName,
                      queryId: bannerQueryId || undefined,
                      workers: Number(bannerWorkers) || 1,
                      resume: bannerResume,
                    });
                    return;
                  }
                  if (bannerMode === 'retry-errors') {
                    void runAction('banner.start', {
                      command: 'retry-errors',
                      queryId: bannerQueryId,
                      workers: Number(bannerWorkers) || 1,
                    });
                    return;
                  }
                  void runAction('banner.start', {
                    command: 'export',
                    queryId: bannerQueryId,
                    format: bannerExportFormat,
                  });
                }}
                disabled={busyAction !== ''}
              >
                Ejecutar Banner
              </button>
              <button className="secondary-button" onClick={() => void runAction('banner.cancel', {})} disabled={busyAction !== ''}>
                Cancelar Banner
              </button>
            </div>
            <pre className="log-block">{data.banner.runner.logTail || 'Sin log de Banner aun.'}</pre>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Estado de ejecucion</h2>
              <span className="panel-note">Procesos largos y ultimas salidas</span>
            </div>
            <div className="badge-wall">
              <span className="badge">Banner running: {data.banner.runner.running ? 'SI' : 'NO'}</span>
              <span className="badge">
                Sidecar running: {String((data.sidecar.runner as { running?: boolean } | null)?.running ? 'SI' : 'NO')}
              </span>
              <span className="badge">Export Banner: {data.banner.exportSummary.rowCount} filas</span>
              <span className="badge">CSV sidecar: {data.sidecar.summary.rowCount} filas</span>
            </div>
            <div className="stacked-metrics">
              <span className="chip">Ultimo Banner: {formatDate(data.banner.runner.lastRun?.endedAt ?? data.banner.runner.current?.startedAt)}</span>
              <span className="chip">Ultimo sidecar: {formatDate((data.sidecar.runner as { current?: { startedAt?: string }; lastRun?: { endedAt?: string } } | null)?.lastRun?.endedAt ?? (data.sidecar.runner as { current?: { startedAt?: string } } | null)?.current?.startedAt)}</span>
            </div>
            <pre className="log-block">{JSON.stringify(data.banner.runner.current ?? data.banner.runner.lastRun ?? {}, null, 2)}</pre>
          </article>
        </section>
      ) : null}

      {activeView === 'files' ? (
        <section className="dashboard-grid">
          <article className="panel panel-span-2">
            <div className="panel-heading">
              <h2>Centro de archivos</h2>
              <span className="panel-note">Ultimas salidas del sistema y de Banner</span>
            </div>
            <table className="data-table">
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
                    <td>
                      {file.name}
                      <div className="mini">{file.path}</div>
                    </td>
                    <td>{file.source}</td>
                    <td>{file.category}</td>
                    <td>{file.sizeLabel}</td>
                    <td>{formatDate(file.modifiedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Resumen Banner</h2>
              <span className="panel-note">{data.banner.exportSummary.latestFile ?? 'Sin export detectado'}</span>
            </div>
            <div className="badge-wall">
              {topBannerStatuses.map(([label, value]) => (
                <span className="badge" key={label}>
                  {label}: {value}
                </span>
              ))}
            </div>
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
                    <td>{item.status ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <h2>Resumen URL Moodle</h2>
              <span className="panel-note">{data.sidecar.urlValidation.latestFile ?? 'Sin archivo validado'}</span>
            </div>
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
                    <td className="mini">{item.moodleUrl ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      ) : null}
    </div>
  );
}
