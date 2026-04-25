'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type BannerMode = 'lookup' | 'batch' | 'retry-errors' | 'export';
type BannerAction = 'start' | 'cancel' | 'import' | 'auth-start' | 'auth-confirm';
type BatchInputMode = 'DATABASE' | 'MANUAL_INPUT';
type BannerBatchSource = 'ALL' | 'MISSING_TEACHER' | 'PENDING_BANNER';

type BannerRunnerRun = {
  id: string;
  command: BannerMode | 'auth' | 'enrollment';
  args: string[];
  startedAt: string;
  endedAt?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  exitCode?: number | null;
  pid?: number;
  logPath: string;
  awaitingInput?: boolean;
};

type BannerStatusResponse = {
  ok: boolean;
  projectRoot: string;
  projectRootExists: boolean;
  runner: {
    running: boolean;
    current: BannerRunnerRun | null;
    lastRun: BannerRunnerRun | null;
    logTail: string;
    liveActivity: {
      queryId: string | null;
      totalRequested: number | null;
      workers: number | null;
      processed: number;
      pending: number | null;
      recentEvents: Array<{
        at: string;
        stage: 'PREPARING' | 'LOOKUP' | 'DONE' | 'WARN';
        message: string;
        worker: number | null;
        queryId: string | null;
        nrc: string | null;
        period: string | null;
        status: string | null;
      }>;
      workerStates: Array<{
        worker: number;
        at: string;
        stage: 'PREPARING' | 'LOOKUP' | 'DONE' | 'WARN';
        nrc: string | null;
        period: string | null;
        status: string | null;
      }>;
    } | null;
  };
  exportSummary: {
    latestFile: string | null;
    modifiedAt: string | null;
    rowCount: number;
    statusCounts: Record<string, number>;
    preview: Array<{
      queryId: string | null;
      nrc: string;
      period: string | null;
      teacherName: string | null;
      teacherId: string | null;
      programName: string | null;
      status: string | null;
      checkedAt: string | null;
      errorMessage: string | null;
      startDate: string | null;
      endDate: string | null;
    }>;
  };
};

type BannerActionResponse = {
  ok: boolean;
  action: string;
  result?: unknown;
};

type BannerConfigResponse = {
  ok: boolean;
  configFile?: string | null;
  configuredProjectRoot?: string | null;
  projectRoot: string;
  projectRootExists: boolean;
};

type BannerBatchOptions = {
  sources: Array<{
    code: BannerBatchSource;
    label: string;
    description: string;
  }>;
  years: Array<{
    year: string;
    periodCodes: string[];
    courseCount: number;
  }>;
  periods: Array<{
    code: string;
    label: string;
    modality: string;
    year: string;
    courseCount: number;
  }>;
  moments: Array<{
    code: string;
    courseCount: number;
  }>;
  defaults: {
    source: BannerBatchSource;
    selectedPeriodCodes: string[];
    latestYear: string | null;
  };
};

type BannerBatchPreview = {
  filters: {
    source: BannerBatchSource;
    periodCodes: string[];
    moments: string[] | null;
    limit: number | null;
  };
  total: number;
  byPeriod: Record<string, number>;
  byYear: Record<string, number>;
  byMoment: Record<string, number>;
  byBannerStatus: Record<string, number>;
  sample: Array<{
    courseId: string;
    nrc: string;
    periodCode: string;
    periodLabel: string;
    year: string;
    moment: string | null;
    subjectName: string | null;
    teacherName: string | null;
    teacherId: string | null;
    bannerReviewStatus: string | null;
    sourceFile: string | null;
  }>;
};

const MODE_LABELS: Record<BannerMode, string> = {
  lookup: 'Consultar un NRC en Banner',
  batch: 'Procesar un lote completo',
  'retry-errors': 'Reintentar solo los errores',
  export: 'Exportar resultados de una consulta',
};

const MODE_HELP: Record<BannerMode, string> = {
  lookup: 'Busca un NRC puntual en Banner para identificar el docente principal asociado.',
  batch:
    'Arma y ejecuta un lote de NRC. La recomendacion es usar los periodos ya cargados por RPACA en la base actual.',
  'retry-errors': 'Toma un Query ID anterior y vuelve a intentar solo los NRC que fallaron.',
  export: 'Genera el CSV o JSON final de una consulta ya ejecutada en Banner.',
};

const START_BUTTON_LABELS: Record<BannerMode, string> = {
  lookup: 'Consultar NRC en Banner',
  batch: 'Iniciar lote Banner',
  'retry-errors': 'Reintentar errores',
  export: 'Exportar resultados',
};

const LIVE_STAGE_LABELS: Record<'PREPARING' | 'LOOKUP' | 'DONE' | 'WARN', string> = {
  PREPARING: 'Preparando',
  LOOKUP: 'Consultando',
  DONE: 'Finalizado',
  WARN: 'Reintentando',
};

const BANNER_STABLE_WORKERS = 1;

function basename(filePath: string | null | undefined) {
  if (!filePath) return 'Sin archivo';
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function toggleSelection(current: string[], value: string) {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function parseStartMessage(data: unknown) {
  if (!data || typeof data !== 'object') return 'Proceso Banner iniciado.';
  const payload = data as Record<string, unknown>;
  const result = payload.result as Record<string, unknown> | undefined;
  const batch = result?.batch as Record<string, unknown> | undefined;
  if (batch && typeof batch.total === 'number') {
    return `Lote Banner iniciado con ${batch.total} NRC generados desde la base.`;
  }
  return 'Proceso Banner iniciado.';
}

function parseAutoImportMessage(data: unknown) {
  if (!data || typeof data !== 'object') {
    return 'Lote Banner iniciado. Al terminar se importara automaticamente a la base.';
  }
  const payload = data as Record<string, unknown>;
  const result = payload.result as Record<string, unknown> | undefined;
  const batch = result?.batch as Record<string, unknown> | undefined;
  if (batch && typeof batch.total === 'number') {
    return `Lote Banner iniciado con ${batch.total} NRC. Al terminar se importara automaticamente a la base.`;
  }
  return 'Lote Banner iniciado. Al terminar se importara automaticamente a la base.';
}

function extractQueryIdFromLog(logTail: string | undefined) {
  if (!logTail) return null;
  const match = logTail.match(/queryId:\s*'([^']+)'|"queryId"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? match?.[2] ?? null;
}

export default function BannerIntegrationPanel() {
  const [status, setStatus] = useState<BannerStatusResponse | null>(null);
  const [batchOptions, setBatchOptions] = useState<BannerBatchOptions | null>(null);
  const [batchPreview, setBatchPreview] = useState<BannerBatchPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [importResult, setImportResult] = useState<unknown>(null);

  const [fullResults, setFullResults] = useState<BannerStatusResponse['exportSummary']['preview'] | null>(null);
  const [fullResultsLoading, setFullResultsLoading] = useState(false);

  const [mode, setMode] = useState<BannerMode>('batch');
  const [batchInputMode, setBatchInputMode] = useState<BatchInputMode>('DATABASE');
  const [batchSource, setBatchSource] = useState<BannerBatchSource>('ALL');
  const [selectedPeriodCodes, setSelectedPeriodCodes] = useState<string[]>([]);
  const [selectedMoments, setSelectedMoments] = useState<string[]>([]);

  const [nrc, setNrc] = useState('72305');
  const [period, setPeriod] = useState('202615');
  const [queryName, setQueryName] = useState('banner-rpaca');
  const [batchLimit, setBatchLimit] = useState('');
  const [inputPath, setInputPath] = useState('');
  const [resume, setResume] = useState(false);
  const [queryId, setQueryId] = useState('');
  const [exportFormat, setExportFormat] = useState('csv,json');
  const [importPath, setImportPath] = useState('');
  const [projectRootInput, setProjectRootInput] = useState('');

  // Pagination state for results table
  const [resultsPage, setResultsPage] = useState(0);
  const RESULTS_PAGE_SIZE = 10;

  const canStart = useMemo(() => !status?.runner.running && !actionLoading, [status?.runner.running, actionLoading]);
  const latestPreviewQueryId = status?.exportSummary.preview[0]?.queryId ?? '';
  const currentModeHelp = MODE_HELP[mode];
  const latestYear = batchOptions?.defaults.latestYear ?? null;
  const latestRunQueryId = extractQueryIdFromLog(status?.runner.logTail);
  const liveActivity = status?.runner.liveActivity ?? null;
  const bannerRootPreview = projectRootInput.trim() || (status?.projectRoot ?? '');
  const projectRootLooksMounted = bannerRootPreview.startsWith('/mnt/');
  const projectRootLooksLinux = bannerRootPreview.startsWith('/home/');

  async function loadAll() {
    try {
      setLoading(true);
      setMessage('');
      const [statusData, batchOptionsData] = await Promise.all([
        fetchJson<BannerStatusResponse>('/api/banner/status'),
        fetchJson<BannerBatchOptions>('/api/banner/batch/options'),
      ]);
      setStatus(statusData);
      setBatchOptions(batchOptionsData);
      setProjectRootInput(statusData.projectRoot);

      if (!selectedPeriodCodes.length && batchOptionsData.defaults.selectedPeriodCodes.length) {
        setSelectedPeriodCodes(batchOptionsData.defaults.selectedPeriodCodes);
      }
      if (batchSource !== batchOptionsData.defaults.source && batchOptionsData.sources.some((item) => item.code === batchSource) === false) {
        setBatchSource(batchOptionsData.defaults.source);
      }
    } catch (error) {
      setMessage(`No fue posible cargar Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadFullResults() {
    try {
      setFullResultsLoading(true);
      const data = await fetchJson<{ ok: boolean; records: BannerStatusResponse['exportSummary']['preview'] }>(
        '/api/banner/export/results',
      );
      setFullResults(data.records ?? []);
      setResultsPage(0);
    } catch (error) {
      setMessage(`No fue posible cargar los resultados completos: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFullResultsLoading(false);
    }
  }

  async function saveProjectRoot() {
    if (!projectRootInput.trim()) {
      setMessage('Escribe la ruta del proyecto Banner antes de guardarla.');
      return;
    }

    try {
      setActionLoading(true);
      setMessage('');
      const response = await fetchJson<BannerConfigResponse>('/api/banner/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: projectRootInput.trim() }),
      });
      const statusData = await fetchJson<BannerStatusResponse>('/api/banner/status');
      setStatus(statusData);
      setProjectRootInput(statusData.projectRoot);
      setMessage(
        response.projectRootExists
          ? 'Ruta del proyecto Banner guardada. La interfaz ya usara ese runner.'
          : 'La ruta se guardo, pero no existe en disco. Revisa el path antes de correr Banner.',
      );
    } catch (error) {
      setMessage(`No fue posible guardar la ruta de Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // Carga inicial de estado, exportes y periodos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!status?.runner.running) return;
    const intervalId = setInterval(() => {
      void fetchJson<BannerStatusResponse>('/api/banner/status')
        .then(setStatus)
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(intervalId);
  }, [status?.runner.running]);

  useEffect(() => {
    if ((mode === 'retry-errors' || mode === 'export') && !queryId.trim() && latestPreviewQueryId) {
      setQueryId(latestPreviewQueryId);
    }
  }, [latestPreviewQueryId, mode, queryId]);

  useEffect(() => {
    setBatchPreview(null);
  }, [selectedPeriodCodes, selectedMoments, batchSource, batchInputMode]);

  async function runAction(action: BannerAction, payload?: Record<string, unknown>) {
    return fetchJson<BannerActionResponse>('/api/banner/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload: payload ?? {} }),
    });
  }

  async function startBannerAuth() {
    try {
      setActionLoading(true);
      setMessage('');
      await runAction('auth-start');
      const statusData = await fetchJson<BannerStatusResponse>('/api/banner/status');
      setStatus(statusData);
      setMessage('Se abrio el login de Banner. Completa SSO/2FA en Edge y luego pulsa "Guardar sesion Banner".');
    } catch (error) {
      setMessage(`No fue posible iniciar autenticacion Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmBannerAuth() {
    try {
      setActionLoading(true);
      setMessage('');
      await runAction('auth-confirm');
      const statusData = await fetchJson<BannerStatusResponse>('/api/banner/status');
      setStatus(statusData);
      setMessage('Guardando sesion Banner. Espera a que el proceso termine y luego vuelve a ejecutar la consulta.');
    } catch (error) {
      setMessage(`No fue posible guardar la sesion Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function previewDatabaseBatch() {
    if (!selectedPeriodCodes.length) {
      setMessage('Selecciona al menos un periodo para previsualizar el lote Banner.');
      return;
    }

    try {
      setActionLoading(true);
      setMessage('');
      const response = await fetchJson<BannerBatchPreview>('/api/banner/batch/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: batchSource,
          periodCodes: selectedPeriodCodes,
          moments: selectedMoments.length ? selectedMoments : undefined,
          limit: batchLimit.trim() ? Number(batchLimit) || undefined : undefined,
        }),
      });
      setBatchPreview(response);
      setMessage(`Preview listo: ${response.total} NRC entrarian en el lote.`);
    } catch (error) {
      setMessage(`No fue posible previsualizar el lote: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function startDatabaseBatch(autoImportToSystem = false) {
    if (!selectedPeriodCodes.length) {
      setMessage('Selecciona al menos un periodo para ejecutar el lote Banner.');
      return;
    }

    const response = await fetchJson<BannerActionResponse>('/api/banner/batch/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: batchSource,
        periodCodes: selectedPeriodCodes,
        moments: selectedMoments.length ? selectedMoments : undefined,
        queryName: queryName.trim() || undefined,
        queryId: queryId.trim() || undefined,
        limit: batchLimit.trim() ? Number(batchLimit) || undefined : undefined,
        workers: BANNER_STABLE_WORKERS,
        resume,
        autoImportToSystem,
      }),
    });

    setMessage(autoImportToSystem ? parseAutoImportMessage(response) : parseStartMessage(response));
  }

  async function startBanner() {
    try {
      setActionLoading(true);
      setMessage('');
      setImportResult(null);

      if (mode === 'batch' && batchInputMode === 'DATABASE') {
        await startDatabaseBatch(false);
      } else if (mode === 'lookup') {
        await runAction('start', {
          command: 'lookup',
          nrc,
          period,
          queryName,
        });
        setMessage(`${MODE_LABELS.lookup} en ejecucion.`);
      } else if (mode === 'batch') {
        await runAction('start', {
          command: 'batch',
          input: inputPath,
          period,
          queryName,
          queryId: queryId.trim() || undefined,
          workers: BANNER_STABLE_WORKERS,
          resume,
        });
        setMessage('Lote Banner manual en ejecucion.');
      } else if (mode === 'retry-errors') {
        await runAction('start', {
          command: 'retry-errors',
          queryId,
          workers: BANNER_STABLE_WORKERS,
        });
        setMessage('Reintento de errores en ejecucion.');
      } else {
        await runAction('start', {
          command: 'export',
          queryId,
          format: exportFormat,
        });
        setMessage('Exportacion Banner en ejecucion.');
      }

      const statusData = await fetchJson<BannerStatusResponse>('/api/banner/status');
      setStatus(statusData);
    } catch (error) {
      setMessage(`No fue posible iniciar Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function startBannerAndImport() {
    if (!(mode === 'batch' && batchInputMode === 'DATABASE')) {
      setMessage('Este atajo solo funciona con lotes armados desde los periodos cargados por RPACA.');
      return;
    }

    try {
      setActionLoading(true);
      setMessage('');
      setImportResult(null);
      await startDatabaseBatch(true);
      const statusData = await fetchJson<BannerStatusResponse>('/api/banner/status');
      setStatus(statusData);
    } catch (error) {
      setMessage(
        `No fue posible iniciar la busqueda con importacion automatica: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelBanner() {
    try {
      setActionLoading(true);
      setMessage('');
      await runAction('cancel');
      setMessage('Solicitud de cancelacion enviada.');
      const statusData = await fetchJson<BannerStatusResponse>('/api/banner/status');
      setStatus(statusData);
    } catch (error) {
      setMessage(`No fue posible cancelar Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function importBannerResult() {
    try {
      setActionLoading(true);
      setMessage('');
      const response = await runAction('import', {
        inputPath: importPath.trim() || undefined,
      });
      setImportResult(response.result ?? null);
      setMessage('Resultado de Banner importado a la base del sistema.');
      await loadAll();
    } catch (error) {
      setMessage(`No fue posible importar el resultado Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  function selectPeriods(periodCodes: string[]) {
    setSelectedPeriodCodes(unique(periodCodes));
  }

  function toggleYear(year: string) {
    const yearPeriods = batchOptions?.years.find((item) => item.year === year)?.periodCodes ?? [];
    if (!yearPeriods.length) return;

    const allSelected = yearPeriods.every((periodCode) => selectedPeriodCodes.includes(periodCode));
    if (allSelected) {
      setSelectedPeriodCodes((current) => current.filter((periodCode) => !yearPeriods.includes(periodCode)));
      return;
    }

    setSelectedPeriodCodes((current) => unique([...current, ...yearPeriods]));
  }

  const authNeedsAttention =
    status?.runner.current?.command === 'auth' ||
    /Fallback a fetch del navegador por respuesta SSO\/HTML|No se detecto la pantalla SSASECT|No se detecto la pantalla de inicio de sesion|Sign in to your account|commonauth|Service Invocation Failed|La sesion Banner expiro|SSASECT no esta disponible/i.test(
      status?.runner.logTail ?? '',
    );

  // Derived display values
  const runnerStatusChipClass =
    status?.runner.running
      ? 'chip chip-warn'
      : status?.runner.lastRun?.status === 'FAILED'
        ? 'chip chip-alert'
        : status?.runner.lastRun?.status === 'COMPLETED'
          ? 'chip chip-ok'
          : 'chip';

  const runnerStatusLabel =
    status?.runner.running
      ? 'Corriendo'
      : status?.runner.lastRun?.status === 'FAILED'
        ? 'Fallo'
        : status?.runner.lastRun?.status === 'COMPLETED'
          ? 'Completado'
          : status?.runner.lastRun?.status === 'CANCELLED'
            ? 'Cancelado'
            : 'Sin corridas';

  const progressTotal = liveActivity?.totalRequested ?? 0;
  const progressDone = liveActivity?.processed ?? 0;
  const progressPct = progressTotal > 0 ? Math.min(100, Math.round((progressDone / progressTotal) * 100)) : 0;

  // Paged results
  const activeResults = fullResults ?? status?.exportSummary.preview ?? [];
  const totalResultPages = Math.ceil(activeResults.length / RESULTS_PAGE_SIZE);
  const pagedResults = activeResults.slice(resultsPage * RESULTS_PAGE_SIZE, (resultsPage + 1) * RESULTS_PAGE_SIZE);

  // Tab definitions
  const TABS: Array<{ id: BannerMode; label: string }> = [
    { id: 'batch', label: 'Lote' },
    { id: 'lookup', label: 'Lookup' },
    { id: 'retry-errors', label: 'Reintentar' },
    { id: 'export', label: 'Exportar' },
  ];

  return (
    <article className="panel">
      {/* Header */}
      <div className="panel-heading">
        <h2>Automatizacion Banner</h2>
        <div className="toolbar">
          <span className={runnerStatusChipClass}>{runnerStatusLabel}</span>
          <span className="chip">{status?.projectRootExists ? 'Runner OK' : 'Runner no encontrado'}</span>
          <span className="badge">Export: {status?.exportSummary.rowCount ?? 0} filas</span>
          <button className="primary" onClick={loadAll} disabled={loading || actionLoading}>
            {loading ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {/* Monitor de ejecucion — solo cuando hay proceso activo */}
      {status?.runner.running && liveActivity ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="chip chip-warn">En curso</span>
            {liveActivity.queryId ? <span className="badge">Query: {liveActivity.queryId}</span> : null}
            {liveActivity.workers !== null ? (
              <span className="badge">Workers: {liveActivity.workers}</span>
            ) : null}
            <span className="badge">
              {progressDone}{progressTotal > 0 ? ` / ${progressTotal}` : ''} NRC
            </span>
            <button className="danger" onClick={cancelBanner} disabled={actionLoading}>
              Cancelar
            </button>
          </div>
          {progressTotal > 0 ? (
            <div className="progress-bar" style={{ marginTop: 8 }}>
              <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
            </div>
          ) : null}
          <details className="disclosure" style={{ marginTop: 8 }}>
            <summary>Log del proceso</summary>
            <div className="log-block">{status.runner.logTail}</div>
          </details>
        </div>
      ) : status?.runner.running ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="toolbar">
            <span className="chip chip-warn">En curso</span>
            <button className="danger" onClick={cancelBanner} disabled={actionLoading}>
              Cancelar
            </button>
          </div>
          {status.runner.logTail ? (
            <details className="disclosure" style={{ marginTop: 8 }}>
              <summary>Log del proceso</summary>
              <div className="log-block">{status.runner.logTail}</div>
            </details>
          ) : null}
        </div>
      ) : null}

      {/* Alerta de autenticacion */}
      {authNeedsAttention ? (
        <div className="message" style={{ marginBottom: 10 }}>
          Si Banner abre Ellucian pero no carga SSASECT, primero usa el login manual. Completa SSO/2FA en Edge y luego
          pulsa guardar sesion.
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="primary" onClick={startBannerAuth} disabled={loading || actionLoading || !!status?.runner.running}>
              Abrir login Banner
            </button>
            <button
              className="primary"
              onClick={confirmBannerAuth}
              disabled={
                loading ||
                actionLoading ||
                status?.runner.current?.command !== 'auth' ||
                !status.runner.current?.awaitingInput
              }
            >
              Guardar sesion Banner
            </button>
          </div>
        </div>
      ) : null}

      {/* Mensaje de estado */}
      {message ? <div className="message" style={{ marginBottom: 10 }}>{message}</div> : null}

      {/* Selector de modo — tabs pill */}
      <div className="view-switcher" style={{ marginBottom: 12 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`switch-button${mode === tab.id ? ' active' : ''}`}
            onClick={() => setMode(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="actions" style={{ marginBottom: 10 }}>
        <strong>{MODE_LABELS[mode]}:</strong> {currentModeHelp}
      </div>

      {/* Formulario por modo */}
      {mode === 'lookup' ? (
        <div className="form-grid">
          <label>
            NRC a consultar
            <input value={nrc} onChange={(event) => setNrc(event.target.value)} placeholder="72305" />
          </label>
          <label>
            Periodo del NRC
            <input value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="202615" />
          </label>
          <label>
            Nombre de consulta
            <input value={queryName} onChange={(event) => setQueryName(event.target.value)} placeholder="banner-rpaca" />
          </label>
        </div>
      ) : null}

      {mode === 'batch' ? (
        <>
          <div className="form-grid">
            <label>
              Fuente de los NRC
              <select
                value={batchInputMode}
                onChange={(event) => setBatchInputMode(event.target.value as BatchInputMode)}
              >
                <option value="DATABASE">Periodos RPACA (recomendado)</option>
                <option value="MANUAL_INPUT">Archivo CSV manual</option>
              </select>
            </label>
            <label>
              Nombre de consulta
              <input value={queryName} onChange={(event) => setQueryName(event.target.value)} placeholder="banner-rpaca" />
            </label>
            <label>
              Query ID opcional
              <input
                value={queryId}
                onChange={(event) => setQueryId(event.target.value)}
                placeholder="Solo si quieres reutilizar una consulta"
              />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={resume} onChange={(event) => setResume(event.target.checked)} />
              <span>Reanudar lote anterior</span>
            </label>
          </div>

          {batchInputMode === 'DATABASE' ? (
            <>
              <div className="form-grid" style={{ marginTop: 10 }}>
                <label>
                  Tipo de lote
                  <select
                    value={batchSource}
                    onChange={(event) => setBatchSource(event.target.value as BannerBatchSource)}
                  >
                    {(batchOptions?.sources ?? []).map((source) => (
                      <option key={source.code} value={source.code}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Limite opcional de NRC
                  <input
                    value={batchLimit}
                    onChange={(event) => setBatchLimit(event.target.value)}
                    placeholder="Ejemplo: 20"
                  />
                </label>
              </div>
              <div className="actions" style={{ marginTop: 4, marginBottom: 8 }}>
                {(batchOptions?.sources ?? []).find((item) => item.code === batchSource)?.description ??
                  'Define que NRC quieres pasar por Banner.'}
              </div>

              {/* Atajos de seleccion de periodos */}
              <div className="toolbar" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                <button
                  type="button"
                  style={{ background: '#f3f4f6', color: '#111827' }}
                  onClick={() => selectPeriods((batchOptions?.periods ?? []).map((periodItem) => periodItem.code))}
                  disabled={actionLoading}
                >
                  Todos los periodos
                </button>
                {latestYear ? (
                  <button
                    type="button"
                    style={{ background: '#f3f4f6', color: '#111827' }}
                    onClick={() =>
                      selectPeriods(batchOptions?.years.find((item) => item.year === latestYear)?.periodCodes ?? [])
                    }
                    disabled={actionLoading}
                  >
                    Solo {latestYear}
                  </button>
                ) : null}
                {(batchOptions?.years ?? []).map((yearItem) => (
                  <button
                    type="button"
                    key={yearItem.year}
                    style={{ background: '#f3f4f6', color: '#111827' }}
                    onClick={() => toggleYear(yearItem.year)}
                    disabled={actionLoading}
                  >
                    {yearItem.year} ({yearItem.courseCount})
                  </button>
                ))}
                <button type="button" style={{ background: '#f3f4f6', color: '#111827' }} onClick={() => setSelectedPeriodCodes([])} disabled={actionLoading}>
                  Limpiar
                </button>
              </div>

              {/* Checkboxes de periodos */}
              <div className="badges" style={{ marginTop: 8 }}>
                {(batchOptions?.periods ?? []).map((periodItem) => (
                  <label className="badge badge-selector" key={periodItem.code}>
                    <input
                      type="checkbox"
                      checked={selectedPeriodCodes.includes(periodItem.code)}
                      onChange={() =>
                        setSelectedPeriodCodes((current) => toggleSelection(current, periodItem.code))
                      }
                    />
                    <span>
                      {periodItem.code} | {periodItem.label} ({periodItem.courseCount})
                    </span>
                  </label>
                ))}
              </div>

              {/* Filtro por momento */}
              {(batchOptions?.moments ?? []).length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                    Filtrar por momento{' '}
                    <button
                      type="button"
                      style={{ fontSize: '0.75rem', marginLeft: 6 }}
                      onClick={() => setSelectedMoments([])}
                      disabled={actionLoading}
                    >
                      Todos
                    </button>
                  </div>
                  <div className="badges">
                    {(batchOptions?.moments ?? []).map((momentItem) => (
                      <label className="badge badge-selector" key={momentItem.code}>
                        <input
                          type="checkbox"
                          checked={selectedMoments.includes(momentItem.code)}
                          onChange={() =>
                            setSelectedMoments((current) => toggleSelection(current, momentItem.code))
                          }
                        />
                        <span>{momentItem.code} ({momentItem.courseCount})</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Boton de preview */}
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={previewDatabaseBatch}
                  disabled={actionLoading || !selectedPeriodCodes.length || !!status?.runner.running}
                >
                  {actionLoading ? 'Procesando...' : 'Previsualizar lote'}
                </button>
              </div>

              {/* Resultado del preview */}
              {batchPreview ? (
                <>
                  <div className="badges" style={{ marginTop: 8 }}>
                    <span className="badge">Total: {batchPreview.total}</span>
                    <span className="badge">Periodos: {batchPreview.filters.periodCodes.length}</span>
                    <span className="badge">Tipo: {batchSource}</span>
                    {batchPreview.filters.moments?.length ? (
                      <span className="badge badge-amber">Momento: {batchPreview.filters.moments.join(', ')}</span>
                    ) : null}
                    {batchPreview.filters.limit ? <span className="badge">Limite: {batchPreview.filters.limit}</span> : null}
                    {Object.entries(batchPreview.byYear).map(([key, value]) => (
                      <span className="badge" key={key}>{key}: {value}</span>
                    ))}
                    {Object.entries(batchPreview.byMoment ?? {}).map(([key, value]) => (
                      <span className="badge" key={key}>Momento {key}: {value}</span>
                    ))}
                    {Object.entries(batchPreview.byBannerStatus).map(([key, value]) => (
                      <span className="badge" key={key}>{key}: {value}</span>
                    ))}
                  </div>
                  <div className="table-wrap" style={{ marginTop: 8 }}>
                    <table className="compact-table">
                      <thead>
                        <tr>
                          <th>NRC</th>
                          <th>Periodo</th>
                          <th>Asignatura</th>
                          <th>Docente actual</th>
                          <th>Estado Banner</th>
                          <th>Archivo RPACA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchPreview.sample.map((item) => (
                          <tr key={`${item.courseId}-${item.nrc}`}>
                            <td>{item.nrc}</td>
                            <td>{item.periodCode} | {item.periodLabel}</td>
                            <td>{item.subjectName ?? '-'}</td>
                            <td>
                              {item.teacherName || item.teacherId
                                ? `${item.teacherName ?? '-'} (${item.teacherId ?? '-'})`
                                : 'Sin docente'}
                            </td>
                            <td>{item.bannerReviewStatus ?? 'SIN_DATO'}</td>
                            <td>{basename(item.sourceFile)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <div className="form-grid" style={{ marginTop: 10 }}>
              <label style={{ gridColumn: '1 / 3' }}>
                Archivo CSV del lote
                <input
                  value={inputPath}
                  onChange={(event) => setInputPath(event.target.value)}
                  placeholder="Ruta del CSV con los NRC a consultar"
                />
              </label>
              <label>
                Periodo por defecto
                <input value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="202615" />
              </label>
            </div>
          )}
        </>
      ) : null}

      {mode === 'retry-errors' ? (
        <div className="form-grid">
          <label>
            Query ID a reintentar
            <input value={queryId} onChange={(event) => setQueryId(event.target.value)} placeholder="Pega aqui el Query ID" />
          </label>
          <label>
            Workers efectivos
            <input value={String(BANNER_STABLE_WORKERS)} readOnly />
          </label>
        </div>
      ) : null}

      {mode === 'export' ? (
        <div className="form-grid">
          <label>
            Query ID a exportar
            <input value={queryId} onChange={(event) => setQueryId(event.target.value)} placeholder="Pega aqui el Query ID" />
          </label>
          <label>
            Formato de salida
            <input value={exportFormat} onChange={(event) => setExportFormat(event.target.value)} placeholder="csv,json" />
          </label>
        </div>
      ) : null}

      {/* Boton principal de accion */}
      <hr className="divider" />
      <div className="toolbar">
        {mode === 'batch' && batchInputMode === 'DATABASE' ? (
          <button
            className="btn-next-action"
            onClick={startBannerAndImport}
            disabled={!canStart || !selectedPeriodCodes.length}
          >
            {actionLoading ? 'Procesando...' : 'Buscar docentes y actualizar base'}
          </button>
        ) : null}
        <button className="primary" onClick={startBanner} disabled={!canStart}>
          {actionLoading
            ? 'Procesando...'
            : mode === 'batch' && batchInputMode === 'DATABASE'
              ? 'Solo buscar en Banner'
              : START_BUTTON_LABELS[mode]}
        </button>
        {!status?.runner.running ? null : (
          <button className="danger" onClick={cancelBanner} disabled={actionLoading}>
            Cancelar proceso Banner
          </button>
        )}
      </div>
      {mode === 'batch' && batchInputMode === 'DATABASE' ? (
        <div className="actions" style={{ marginTop: 6 }}>
          El boton <span className="code">Buscar docentes y actualizar base</span> hace el flujo completo en un clic.
          El otro solo consulta Banner sin importar.
        </div>
      ) : null}

      {/* Paso 3: Ultimo export disponible */}
      <hr className="divider" />
      <div className="panel-heading">
        <strong>Ultimo export Banner</strong>
        <div className="toolbar">
          <span className="badge">{status?.exportSummary.rowCount ?? 0} filas</span>
          {Object.entries(status?.exportSummary.statusCounts ?? {}).map(([key, value]) => (
            <span className="badge" key={key}>{key}: {value}</span>
          ))}
          <button
            type="button"
            className="primary"
            onClick={loadFullResults}
            disabled={fullResultsLoading || !!status?.runner.running}
          >
            {fullResultsLoading ? 'Cargando...' : 'Cargar todos'}
          </button>
          {fullResults !== null ? (
            <button type="button" style={{ background: '#f3f4f6', color: '#111827' }} onClick={() => { setFullResults(null); setResultsPage(0); }}>
              Mostrar preview
            </button>
          ) : null}
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="compact-table">
          <thead>
            <tr>
              <th>NRC</th>
              <th>Periodo</th>
              <th>Docente</th>
              <th>ID docente</th>
              <th>Estado</th>
              <th>Inicio NRC</th>
              <th>Cierre NRC</th>
              <th>Revisado</th>
            </tr>
          </thead>
          <tbody>
            {pagedResults.map((item) => (
              <tr key={`${item.queryId ?? 'sin-query'}-${item.nrc}`}>
                <td>{item.nrc}</td>
                <td>{item.period ?? '-'}</td>
                <td>{item.teacherName ?? '-'}</td>
                <td>{item.teacherId ?? '-'}</td>
                <td>{item.status ?? '-'}</td>
                <td>{item.startDate ?? '-'}</td>
                <td>{item.endDate ?? '-'}</td>
                <td>{item.checkedAt ?? '-'}</td>
              </tr>
            ))}
            {!pagedResults.length ? (
              <tr>
                <td colSpan={8}>
                  {fullResults !== null
                    ? 'Sin filas en el ultimo export Banner.'
                    : 'Aun no hay una exportacion Banner disponible.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {totalResultPages > 1 ? (
        <div className="toolbar" style={{ marginTop: 6 }}>
          <button type="button" style={{ background: '#f3f4f6', color: '#111827' }} onClick={() => setResultsPage((p) => Math.max(0, p - 1))} disabled={resultsPage === 0}>
            Anterior
          </button>
          <span className="badge">
            {resultsPage + 1} / {totalResultPages}
          </span>
          <button
            type="button"
            style={{ background: '#f3f4f6', color: '#111827' }}
            onClick={() => setResultsPage((p) => Math.min(totalResultPages - 1, p + 1))}
            disabled={resultsPage >= totalResultPages - 1}
          >
            Siguiente
          </button>
        </div>
      ) : null}

      {/* Paso 4: Importar resultado */}
      <hr className="divider" />
      <div className="form-grid">
        <label style={{ gridColumn: '1 / 3' }}>
          Archivo a importar (opcional — si esta vacio se usa el ultimo export Banner)
          <input
            value={importPath}
            onChange={(event) => setImportPath(event.target.value)}
            placeholder="Si lo dejas vacio, se usa el ultimo export Banner"
          />
        </label>
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="primary" onClick={importBannerResult} disabled={actionLoading || !!status?.runner.running}>
          {actionLoading ? 'Procesando...' : 'Importar resultado Banner a la base'}
        </button>
      </div>

      {/* Resultado de la importacion */}
      {importResult ? (
        <details className="disclosure" style={{ marginTop: 10 }}>
          <summary>Resultado de la importacion</summary>
          <div className="log-block">{JSON.stringify(importResult, null, 2)}</div>
        </details>
      ) : null}

      {/* Log del ultimo proceso (cuando no hay proceso activo) */}
      {!status?.runner.running && status?.runner.logTail ? (
        <details className="disclosure" style={{ marginTop: 10 }}>
          <summary>Log de la ultima corrida</summary>
          <div className="log-block">{status.runner.logTail}</div>
        </details>
      ) : null}

      {/* Configuracion avanzada al fondo */}
      <hr className="divider" />
      <details className="disclosure">
        <summary>Configuracion del runner Banner</summary>
        <div className="form-grid" style={{ marginTop: 10 }}>
          <label style={{ gridColumn: '1 / 3' }}>
            Ruta del proyecto Banner
            <input
              value={projectRootInput}
              onChange={(event) => setProjectRootInput(event.target.value)}
              placeholder="/ruta/al/proyecto-banner"
            />
          </label>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button className="primary" onClick={saveProjectRoot} disabled={loading || actionLoading || !!status?.runner.running}>
            Guardar ruta Banner
          </button>
          <button className="primary" onClick={startBannerAuth} disabled={loading || actionLoading || !!status?.runner.running}>
            Abrir login Banner
          </button>
          <button
            className="primary"
            onClick={confirmBannerAuth}
            disabled={
              loading ||
              actionLoading ||
              status?.runner.current?.command !== 'auth' ||
              !status.runner.current?.awaitingInput
            }
          >
            Guardar sesion Banner
          </button>
        </div>
        <div className="actions" style={{ marginTop: 8 }}>
          {projectRootLooksLinux ? (
            <span>Ruta Linux: <span className="code">{bannerRootPreview}</span></span>
          ) : projectRootLooksMounted ? (
            <span>
              Ruta en <span className="code">/mnt</span>: <span className="code">{bannerRootPreview}</span>.
              Se recomienda moverla a una copia Linux del runner.
            </span>
          ) : (
            <span>Ruta actual: <span className="code">{bannerRootPreview || 'Sin configurar'}</span></span>
          )}
        </div>
        <div className="actions" style={{ marginTop: 6 }}>
          <span className="code">Ultimo archivo exportado: {basename(status?.exportSummary.latestFile)}</span>
          {latestRunQueryId ? (
            <><br /><span className="code">Ultimo Query ID detectado: {latestRunQueryId}</span></>
          ) : null}
          {status?.runner.lastRun ? (
            <><br />
              <span className="code">
                Ultima corrida: {status.runner.lastRun.command} | {status.runner.lastRun.status}
                {status.runner.lastRun.startedAt ? ` | inicio ${status.runner.lastRun.startedAt}` : ''}
                {status.runner.lastRun.endedAt ? ` | fin ${status.runner.lastRun.endedAt}` : ''}
              </span>
            </>
          ) : null}
        </div>
      </details>
    </article>
  );
}
