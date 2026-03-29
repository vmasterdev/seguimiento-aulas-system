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
    limit: number | null;
  };
  total: number;
  byPeriod: Record<string, number>;
  byYear: Record<string, number>;
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
  }, [selectedPeriodCodes, batchSource, batchInputMode]);

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

  return (
    <article className="panel">
      <h2>Automatizacion Banner</h2>
      <div className="actions">
        Esta pantalla sirve para buscar docentes en Banner por NRC, exportar el resultado e importarlo luego a la base
        del sistema.
        <br />
        La ruta recomendada es usar <span className="code">Procesar un lote completo</span> con{' '}
        <span className="code">periodos cargados por RPACA</span>. Asi no dependes de archivos manuales y los periodos
        nuevos aparecen solos cuando importas otro RPACA.
      </div>

      <div className="controls" style={{ marginTop: 8 }}>
        <button onClick={loadAll} disabled={loading || actionLoading}>
          {loading ? 'Actualizando...' : 'Actualizar estado de Banner'}
        </button>
      </div>

      <div className="badges" style={{ marginTop: 10 }}>
        <span className="badge">Proceso en curso: {status?.runner.running ? 'SI' : 'NO'}</span>
        <span className="badge">Proyecto Banner: {status?.projectRootExists ? 'Disponible' : 'No encontrado'}</span>
        <span className="badge">Ultimo export: {status?.exportSummary.rowCount ?? 0} filas</span>
      </div>

      {status?.runner.lastRun ? (
        <div className="actions" style={{ marginTop: 8 }}>
          <strong>Ultima corrida:</strong> {status.runner.lastRun.command} | {status.runner.lastRun.status}
          {latestRunQueryId ? ` | queryId ${latestRunQueryId}` : ''}
          {status.runner.lastRun.startedAt ? ` | inicio ${status.runner.lastRun.startedAt}` : ''}
          {status.runner.lastRun.endedAt ? ` | fin ${status.runner.lastRun.endedAt}` : ''}
        </div>
      ) : null}

      <div className="actions" style={{ marginTop: 8 }}>
        <span className="code">Proyecto externo: {status?.projectRoot ?? 'N/A'}</span>
        <br />
        <span className="code">Ultimo archivo exportado: {basename(status?.exportSummary.latestFile)}</span>
      </div>

      <div className="subtitle" style={{ marginTop: 12 }}>
        Configuracion del runner Banner
      </div>
      <div className="controls">
        <label style={{ minWidth: 460 }}>
          Ruta del proyecto Banner
          <input
            value={projectRootInput}
            onChange={(event) => setProjectRootInput(event.target.value)}
            placeholder="/ruta/al/proyecto-banner"
          />
        </label>
        <button onClick={saveProjectRoot} disabled={loading || actionLoading || !!status?.runner.running}>
          Guardar ruta Banner
        </button>
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        Esta interfaz puede trabajar con cualquier copia del proyecto Banner, pero en WSL conviene usar una ruta Linux
        para evitar bloqueos por <span className="code">/mnt/c</span>.
        <br />
        {projectRootLooksLinux ? (
          <span>
            Ruta actual en Linux: <span className="code">{bannerRootPreview}</span>
          </span>
        ) : projectRootLooksMounted ? (
          <span>
            Ruta actual en <span className="code">/mnt</span>: <span className="code">{bannerRootPreview}</span>. Se
            recomienda moverla a una copia Linux del runner.
          </span>
        ) : (
          <span>Ruta actual: <span className="code">{bannerRootPreview || 'Sin configurar'}</span></span>
        )}
      </div>

      {authNeedsAttention ? (
        <div className="message" style={{ marginTop: 10 }}>
          Si Banner abre Ellucian pero no carga SSASECT, primero usa el login manual. Completa SSO/2FA en Edge y luego
          pulsa guardar sesion.
        </div>
      ) : null}

      <div className="controls" style={{ marginTop: 10 }}>
        <button onClick={startBannerAuth} disabled={loading || actionLoading || !!status?.runner.running}>
          Abrir login Banner
        </button>
        <button
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

      <div className="subtitle">Paso 1. Elegir la tarea</div>
      <div className="controls">
        <label>
          Tarea a ejecutar
          <select value={mode} onChange={(event) => setMode(event.target.value as BannerMode)}>
            <option value="batch">{MODE_LABELS.batch}</option>
            <option value="lookup">{MODE_LABELS.lookup}</option>
            <option value="retry-errors">{MODE_LABELS['retry-errors']}</option>
            <option value="export">{MODE_LABELS.export}</option>
          </select>
        </label>
        {(mode === 'batch' || mode === 'retry-errors') ? (
          <label>
            Workers efectivos
            <input value={String(BANNER_STABLE_WORKERS)} readOnly />
          </label>
        ) : null}
        {(mode === 'lookup' || mode === 'batch') ? (
          <label>
            Nombre de consulta
            <input value={queryName} onChange={(event) => setQueryName(event.target.value)} placeholder="banner-rpaca" />
          </label>
        ) : null}
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <strong>{MODE_LABELS[mode]}:</strong> {currentModeHelp}
      </div>
      {(mode === 'batch' || mode === 'retry-errors') ? (
        <div className="actions" style={{ marginTop: 8 }}>
          Modo estable activo: Banner corre con <span className="code">1 worker</span> para evitar errores del
          backend paralelo y mantener la actualizacion del sistema consistente.
        </div>
      ) : null}

      {mode === 'lookup' ? (
        <div className="controls" style={{ marginTop: 10 }}>
          <label>
            NRC a consultar
            <input value={nrc} onChange={(event) => setNrc(event.target.value)} placeholder="72305" />
          </label>
          <label>
            Periodo del NRC
            <input value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="202615" />
          </label>
        </div>
      ) : null}

      {mode === 'batch' ? (
        <>
          <div className="controls" style={{ marginTop: 10 }}>
            <label>
              Fuente de los NRC
              <select
                value={batchInputMode}
                onChange={(event) => setBatchInputMode(event.target.value as BatchInputMode)}
              >
                <option value="DATABASE">Periodos ya cargados por RPACA (recomendado)</option>
                <option value="MANUAL_INPUT">Archivo CSV manual</option>
              </select>
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
              <span>Reanudar un lote anterior</span>
            </label>
          </div>

          {batchInputMode === 'DATABASE' ? (
            <>
              <div className="subtitle" style={{ marginTop: 12 }}>
                Paso 2. Seleccionar periodos cargados por RPACA
              </div>
              <div className="actions">
                Los periodos de esta lista salen directamente de la base del sistema y se alimentan cuando importas
                archivos RPACA.
                <br />
                Si el siguiente semestre viene como <span className="code">202765</span>, aparecera aqui como un periodo
                nuevo y el sistema seguira manejando NRC tipo <span className="code">65-xxxxx</span> de forma automatica.
              </div>

              <div className="controls" style={{ marginTop: 10 }}>
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
              <div className="actions" style={{ marginTop: 8 }}>
                {(batchOptions?.sources ?? []).find((item) => item.code === batchSource)?.description ??
                  'Define que NRC quieres pasar por Banner.'}
              </div>

              <div className="subtitle" style={{ marginTop: 10 }}>
                Atajos por ano
              </div>
              <div className="controls">
                <button
                  type="button"
                  onClick={() => selectPeriods((batchOptions?.periods ?? []).map((periodItem) => periodItem.code))}
                  disabled={actionLoading}
                >
                  Marcar todos los periodos cargados
                </button>
                {latestYear ? (
                  <button
                    type="button"
                    onClick={() =>
                      selectPeriods(batchOptions?.years.find((item) => item.year === latestYear)?.periodCodes ?? [])
                    }
                    disabled={actionLoading}
                  >
                    Marcar solo {latestYear}
                  </button>
                ) : null}
                <button type="button" onClick={() => setSelectedPeriodCodes([])} disabled={actionLoading}>
                  Limpiar seleccion
                </button>
              </div>
              <div className="controls" style={{ marginTop: 8 }}>
                {(batchOptions?.years ?? []).map((yearItem) => (
                  <button
                    type="button"
                    key={yearItem.year}
                    onClick={() => toggleYear(yearItem.year)}
                    disabled={actionLoading}
                  >
                    Alternar {yearItem.year} ({yearItem.courseCount})
                  </button>
                ))}
              </div>

              <div className="subtitle" style={{ marginTop: 10 }}>
                Periodos a revisar
              </div>
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

              <div className="controls" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={previewDatabaseBatch}
                  disabled={actionLoading || !selectedPeriodCodes.length || !!status?.runner.running}
                >
                  {actionLoading ? 'Procesando...' : 'Previsualizar lote Banner'}
                </button>
              </div>

              {batchPreview ? (
                <>
                  <div className="subtitle" style={{ marginTop: 10 }}>
                    Resumen del lote
                  </div>
                  <div className="badges" style={{ marginTop: 8 }}>
                    <span className="badge">Total lote: {batchPreview.total}</span>
                    <span className="badge">Periodos: {batchPreview.filters.periodCodes.length}</span>
                    <span className="badge">Tipo: {batchSource}</span>
                    {batchPreview.filters.limit ? <span className="badge">Limite: {batchPreview.filters.limit}</span> : null}
                  </div>
                  <div className="badges" style={{ marginTop: 8 }}>
                    {Object.entries(batchPreview.byYear).map(([key, value]) => (
                      <span className="badge" key={key}>
                        Ano {key}: {value}
                      </span>
                    ))}
                  </div>
                  <div className="badges" style={{ marginTop: 8 }}>
                    {Object.entries(batchPreview.byBannerStatus).map(([key, value]) => (
                      <span className="badge" key={key}>
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                  <div className="actions" style={{ marginTop: 8 }}>
                    Muestra de los NRC que entrarian en el lote. Si el proximo semestre o el proximo ano ya fueron
                    cargados por RPACA, apareceran aqui sin que tengas que cambiar codigo ni reglas fijas.
                  </div>
                  <table style={{ marginTop: 8 }}>
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
                          <td>
                            {item.periodCode} | {item.periodLabel}
                          </td>
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
                </>
              ) : null}
            </>
          ) : (
            <>
              <div className="subtitle" style={{ marginTop: 12 }}>
                Paso 2. Indicar el archivo manual
              </div>
              <div className="controls">
                <label style={{ minWidth: 360 }}>
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
              <div className="actions" style={{ marginTop: 8 }}>
                Usa esta opcion solo si realmente necesitas trabajar con un archivo externo. Si los NRC ya estan en la
                base por RPACA, es mejor usar la opcion recomendada.
              </div>
            </>
          )}
        </>
      ) : null}

      {mode === 'retry-errors' ? (
        <div className="controls" style={{ marginTop: 10 }}>
          <label>
            Query ID a reintentar
            <input value={queryId} onChange={(event) => setQueryId(event.target.value)} placeholder="Pega aqui el Query ID" />
          </label>
        </div>
      ) : null}

      {mode === 'export' ? (
        <div className="controls" style={{ marginTop: 10 }}>
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

      <div className="controls" style={{ marginTop: 10 }}>
        {mode === 'batch' && batchInputMode === 'DATABASE' ? (
          <button
            className="btn-next-action"
            onClick={startBannerAndImport}
            disabled={!canStart || !selectedPeriodCodes.length}
          >
            {actionLoading ? 'Procesando...' : 'Buscar docentes y actualizar base'}
          </button>
        ) : null}
        <button onClick={startBanner} disabled={!canStart}>
          {actionLoading
            ? 'Procesando...'
            : mode === 'batch' && batchInputMode === 'DATABASE'
              ? 'Solo buscar en Banner'
              : START_BUTTON_LABELS[mode]}
        </button>
        <button onClick={cancelBanner} disabled={!status?.runner.running || actionLoading}>
          Cancelar proceso Banner
        </button>
      </div>
      {mode === 'batch' && batchInputMode === 'DATABASE' ? (
        <div className="actions" style={{ marginTop: 8 }}>
          El boton verde <span className="code">Buscar docentes y actualizar base</span> hace el flujo completo en un
          clic. El otro boton solo consulta Banner y deja el resultado sin importar.
        </div>
      ) : null}

      {liveActivity ? (
        <>
          <div className="subtitle">Seguimiento en vivo del lote</div>
          <div className="badges" style={{ marginTop: 8 }}>
            {liveActivity.queryId ? <span className="badge">Query ID: {liveActivity.queryId}</span> : null}
            {liveActivity.totalRequested !== null ? (
              <span className="badge">Total: {liveActivity.totalRequested}</span>
            ) : null}
            <span className="badge">Procesados: {liveActivity.processed}</span>
            {liveActivity.pending !== null ? <span className="badge">Pendientes: {liveActivity.pending}</span> : null}
            {liveActivity.workers !== null ? <span className="badge">Workers: {liveActivity.workers}</span> : null}
          </div>

          {liveActivity.workerStates.length ? (
            <>
              <div className="actions" style={{ marginTop: 8 }}>
                Ultimo movimiento reportado por cada worker.
              </div>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Etapa</th>
                    <th>NRC</th>
                    <th>Periodo</th>
                    <th>Estado</th>
                    <th>Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {liveActivity.workerStates.map((item) => (
                    <tr key={`${item.worker}-${item.at}`}>
                      <td>{item.worker}</td>
                      <td>{LIVE_STAGE_LABELS[item.stage]}</td>
                      <td>{item.nrc ?? '-'}</td>
                      <td>{item.period ?? '-'}</td>
                      <td>{item.status ?? '-'}</td>
                      <td>{item.at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}

          <div className="actions" style={{ marginTop: 8 }}>
            Ultimos NRC detectados en el seguimiento del proceso. Esta tabla se alimenta del log en curso y cambia
            mientras el lote avanza.
          </div>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Worker</th>
                <th>Etapa</th>
                <th>NRC</th>
                <th>Periodo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {liveActivity.recentEvents.map((item) => (
                <tr key={`${item.at}-${item.worker ?? 'na'}-${item.nrc ?? 'na'}-${item.stage}`}>
                  <td>{item.at}</td>
                  <td>{item.worker ?? '-'}</td>
                  <td>{LIVE_STAGE_LABELS[item.stage]}</td>
                  <td>{item.nrc ?? '-'}</td>
                  <td>{item.period ?? '-'}</td>
                  <td>{item.status ?? '-'}</td>
                </tr>
              ))}
              {!liveActivity.recentEvents.length ? (
                <tr>
                  <td colSpan={6}>Aun no hay NRC visibles en el log del proceso.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </>
      ) : null}

      <div className="subtitle">Paso 3. Revisar el ultimo export disponible</div>
      <div className="badges">
        {Object.entries(status?.exportSummary.statusCounts ?? {}).map(([key, value]) => (
          <span className="badge" key={key}>
            {key}: {value}
          </span>
        ))}
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        Este bloque muestra el export mas reciente. Cuando una corrida termina bien, la interfaz intenta exportarla de forma automatica para que aqui veas ese mismo resultado.
        <br />
        No es seguimiento en vivo: mientras Banner corre, revisa el bloque <span className="code">Seguimiento del proceso Banner</span>. La tabla de abajo cambia cuando la corrida termina y el export queda listo.
      </div>
      <div className="controls" style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={loadFullResults}
          disabled={fullResultsLoading || !!status?.runner.running}
        >
          {fullResultsLoading ? 'Cargando...' : 'Cargar todos los resultados'}
        </button>
        {fullResults !== null ? (
          <button type="button" onClick={() => setFullResults(null)}>
            Ocultar resultados completos
          </button>
        ) : null}
      </div>
      {fullResults !== null ? (
        <>
          <div className="actions" style={{ marginTop: 8 }}>
            Resultados completos del ultimo export Banner ({fullResults.length} filas). Las columnas de fecha solo
            aparecen cuando el runner externo las incluye en el CSV.
          </div>
          <table style={{ marginTop: 8 }}>
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
              {fullResults.map((item) => (
                <tr key={`full-${item.queryId ?? 'sin-query'}-${item.nrc}`}>
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
              {!fullResults.length ? (
                <tr>
                  <td colSpan={8}>Sin filas en el ultimo export Banner.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </>
      ) : (
        <table style={{ marginTop: 10 }}>
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
            {(status?.exportSummary.preview ?? []).map((item) => (
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
            {!status?.exportSummary.preview?.length ? (
              <tr>
                <td colSpan={8}>Aun no hay una exportacion Banner disponible.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      <div className="subtitle">Paso 4. Importar el resultado Banner a la base del sistema</div>
      <div className="controls">
        <label style={{ minWidth: 420 }}>
          Archivo a importar (opcional)
          <input
            value={importPath}
            onChange={(event) => setImportPath(event.target.value)}
            placeholder="Si lo dejas vacio, se usa el ultimo export Banner"
          />
        </label>
        <button onClick={importBannerResult} disabled={actionLoading || status?.runner.running}>
          {actionLoading ? 'Procesando...' : 'Importar resultado Banner a la base'}
        </button>
      </div>
      <div className="actions">
        Al importar, el sistema actualiza <span className="code">bannerReview</span> en los cursos y puede enlazar el
        docente encontrado por Banner al curso correspondiente.
      </div>

      {message ? <div className="message">{message}</div> : null}

      {status?.runner.logTail ? (
        <>
          <div className="subtitle">Seguimiento del proceso Banner</div>
          <pre className="log-box">{status.runner.logTail}</pre>
        </>
      ) : null}

      {importResult ? (
        <>
          <div className="subtitle">Resultado de la importacion</div>
          <pre className="log-box">{JSON.stringify(importResult, null, 2)}</pre>
        </>
      ) : null}
    </article>
  );
}
