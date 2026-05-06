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
  const TABS: Array<{ id: BannerMode; label: string; desc: string }> = [
    { id: 'batch',         label: 'Lote',       desc: 'Procesa todos los NRC de varios periodos a la vez' },
    { id: 'lookup',        label: 'Individual', desc: 'Consulta un solo NRC para identificar al docente' },
    { id: 'retry-errors',  label: 'Reintentar', desc: 'Vuelve a correr solo los NRC que fallaron antes' },
    { id: 'export',        label: 'Exportar',   desc: 'Genera CSV/JSON de un Query ID anterior' },
  ];

  // Stats derived
  const exportTotal = status?.exportSummary.rowCount ?? 0;
  const statusCounts = status?.exportSummary.statusCounts ?? {};
  const statSinDocente = statusCounts['SIN_DOCENTE'] ?? statusCounts['SIN_DATO'] ?? 0;
  const statEncontrado = statusCounts['ENCONTRADO'] ?? 0;
  const statNoEncontrado = statusCounts['NO_ENCONTRADO'] ?? 0;
  const totalCoursesAll = batchOptions?.periods.reduce((sum, p) => sum + p.courseCount, 0) ?? 0;
  const selectedCourseCount = (batchOptions?.periods ?? [])
    .filter((p) => selectedPeriodCodes.includes(p.code))
    .reduce((sum, p) => sum + p.courseCount, 0);

  return (
    <div className="banner-v2">
      <style jsx>{`
        .banner-v2 {
          display: grid;
          gap: 16px;
        }
        .banner-v2 :global(*) {
          box-sizing: border-box;
        }
        .banner-shell {
          background: #fff;
          border-radius: 16px;
          border: 1px solid var(--line);
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }
        .banner-hero {
          background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #1e40af 100%);
          color: #fff;
          padding: 22px 28px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 20px;
          align-items: center;
        }
        .banner-hero h1 {
          margin: 0;
          font-size: 1.3rem;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: #fff;
        }
        .banner-hero p {
          margin: 4px 0 0;
          font-size: 0.82rem;
          color: rgba(255,255,255,0.72);
          max-width: 580px;
          line-height: 1.45;
        }
        .hero-status {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
        }
        .hero-status-row {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 11px;
          border-radius: 999px;
          font-size: 0.7rem;
          font-weight: 600;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.18);
          color: #fff;
        }
        .pill.ok { background: rgba(16,185,129,0.22); border-color: rgba(16,185,129,0.4); color: #d1fae5; }
        .pill.warn { background: rgba(245,158,11,0.25); border-color: rgba(245,158,11,0.4); color: #fef3c7; }
        .pill.danger { background: rgba(239,68,68,0.25); border-color: rgba(239,68,68,0.4); color: #fee2e2; }
        .pill .dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
        .pill-light {
          background: var(--n-100);
          color: var(--n-700);
          border: 1px solid var(--line);
        }
        .pill-light.danger { background: var(--red-light); color: #991b1b; border-color: #fca5a5; }
        .pill-light.warn { background: var(--amber-light); color: #92400e; border-color: #fcd34d; }
        .pill-light.ok { background: var(--green-light); color: #166534; border-color: #86efac; }
        .ghost-btn {
          background: rgba(255,255,255,0.12);
          color: #fff;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          padding: 7px 14px;
          font-size: 0.78rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 120ms ease;
        }
        .ghost-btn:hover { background: rgba(255,255,255,0.2); }

        .stats-row {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          padding: 18px 24px 4px;
        }
        @media (max-width: 900px) { .stats-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 480px) { .stats-row { grid-template-columns: 1fr; } }
        .stat {
          padding: 14px 16px;
          background: var(--n-50);
          border: 1px solid var(--line);
          border-radius: 12px;
        }
        .stat-l {
          font-size: 0.66rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--muted);
          font-weight: 600;
        }
        .stat-v {
          font-size: 1.55rem;
          font-weight: 700;
          color: var(--primary);
          letter-spacing: -0.02em;
          margin-top: 2px;
          line-height: 1.1;
        }
        .stat.ok .stat-v { color: #059669; }
        .stat.warn .stat-v { color: #d97706; }
        .stat.danger .stat-v { color: #dc2626; }
        .stat-h {
          font-size: 0.7rem;
          color: var(--muted);
          margin-top: 4px;
        }

        .body {
          padding: 18px 24px 24px;
        }
        .tabs {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 18px;
        }
        .tab {
          padding: 14px 12px;
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--muted);
          background: var(--n-50);
          border: none;
          border-right: 1px solid var(--line);
          cursor: pointer;
          transition: all 130ms ease;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          text-align: left;
        }
        .tab:last-child { border-right: none; }
        .tab:hover {
          background: #fff;
          color: var(--ink);
        }
        .tab.active {
          background: #fff;
          color: var(--primary);
        }
        .tab.active::before {
          content: '';
          display: block;
          width: 100%;
          height: 3px;
          background: var(--primary);
          margin: -14px -12px 11px;
          border-radius: 12px 12px 0 0;
        }
        .tab-label {
          font-weight: 600;
          font-size: 0.92rem;
        }
        .tab-desc {
          font-size: 0.7rem;
          font-weight: 400;
          color: var(--muted);
          line-height: 1.3;
        }
        .tab.active .tab-desc { color: var(--n-600); }
        @media (max-width: 720px) {
          .tabs { grid-template-columns: repeat(2, 1fr); }
          .tab { border-right: none; border-bottom: 1px solid var(--line); }
          .tab:nth-child(2n) { border-right: none; }
          .tab:nth-last-child(-n+2) { border-bottom: none; }
        }
        @media (max-width: 460px) {
          .tabs { grid-template-columns: 1fr; }
          .tab { border-right: none; border-bottom: 1px solid var(--line); }
          .tab:last-child { border-bottom: none; }
        }
        .form {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .field-l {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--muted);
          font-weight: 600;
        }
        .field input, .field select {
          padding: 9px 12px;
          font-size: 0.88rem;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #fff;
          color: var(--ink);
          transition: all 120ms ease;
        }
        .field input:hover, .field select:hover { border-color: var(--n-300); }
        .field input:focus, .field select:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(27,58,107,0.12);
        }

        /* Field moderno (floating label + select gris) — usar .field.modern */
        .field.modern {
          position: relative;
          gap: 0;
        }
        .field.modern .field-l {
          position: absolute;
          top: -7px;
          left: 12px;
          padding: 0 6px;
          font-size: 0.68rem;
          letter-spacing: 0.2px;
          color: var(--muted);
          font-weight: 600;
          background: #fff;
          z-index: 2;
          pointer-events: none;
          text-transform: none;
        }
        .field.modern input,
        .field.modern select {
          width: 100%;
          padding: 12px 14px;
          font-size: 0.88rem;
          font-weight: 500;
          border: 1.5px solid var(--line);
          border-radius: 10px;
          background: #fff;
          color: var(--ink);
          transition: all 140ms ease;
          font-family: inherit;
        }
        .field.modern input::placeholder { color: var(--n-400); font-weight: 400; }
        .field.modern input:focus,
        .field.modern select:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 4px rgba(27,58,107,0.1);
        }
        .field.modern:focus-within .field-l { color: var(--primary); }
        .field.modern select {
          appearance: none;
          -webkit-appearance: none;
          background-color: var(--n-50);
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%231b3a6b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 14px center;
          padding-right: 42px;
          cursor: pointer;
          font-weight: 600;
        }
        .field.modern select:hover { background-color: #fff; }
        .field.modern select:focus { background-color: #fff; }

        .field-check {
          display: inline-flex;
          align-items: center;
          gap: 11px;
          padding: 12px 16px;
          border: 1.5px solid var(--line);
          border-radius: 10px;
          background: #fff;
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--n-700);
          cursor: pointer;
          transition: all 140ms ease;
          align-self: flex-end;
          user-select: none;
          width: fit-content;
        }
        .field-check:hover {
          border-color: var(--primary-dim);
          background: var(--n-50);
          color: var(--ink);
        }
        .field-check:has(input:checked) {
          border-color: var(--primary);
          background: linear-gradient(135deg, rgba(27,58,107,0.05), rgba(27,58,107,0.02));
          color: var(--primary-dark);
          font-weight: 600;
        }
        .field-check input[type="checkbox"] {
          appearance: none;
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border: 1.5px solid var(--n-300);
          border-radius: 5px;
          background: #fff;
          cursor: pointer;
          position: relative;
          margin: 0;
          transition: all 140ms ease;
          flex-shrink: 0;
        }
        .field-check input[type="checkbox"]:checked {
          background: var(--primary);
          border-color: var(--primary);
        }
        .field-check input[type="checkbox"]:checked::after {
          content: '';
          position: absolute;
          left: 5px;
          top: 1px;
          width: 5px;
          height: 10px;
          border: solid #fff;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }
        .field-check:hover input[type="checkbox"]:not(:checked) {
          border-color: var(--primary-dim);
        }

        .bv2-section {
          margin-top: 22px;
          width: 100%;
        }
        .bv2-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding-bottom: 10px;
          margin-bottom: 12px;
          border-bottom: 1px solid var(--line);
        }
        .bv2-section-head h3 {
          margin: 0;
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--ink);
          letter-spacing: -0.01em;
        }
        .bv2-section-head .meta {
          font-size: 0.74rem;
          color: var(--muted);
          font-weight: 500;
        }
        .quick-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .quick {
          padding: 5px 11px;
          font-size: 0.75rem;
          font-weight: 500;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 999px;
          color: var(--n-700);
          cursor: pointer;
          transition: all 120ms ease;
        }
        .quick:hover { border-color: var(--primary-dim); background: var(--n-50); }
        .quick.primary {
          background: var(--primary);
          color: #fff;
          border-color: var(--primary);
        }

        .grid-cards {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          width: 100%;
        }
        @media (max-width: 1100px) { .grid-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 820px)  { .grid-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 520px)  { .grid-cards { grid-template-columns: 1fr; } }
        .card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: #fff;
          cursor: pointer;
          transition: all 130ms ease;
          font-size: 0.82rem;
          min-width: 0;
        }
        .card:hover { border-color: var(--primary-dim); background: var(--n-50); }
        .card.selected {
          border-color: var(--primary);
          background: linear-gradient(135deg, rgba(27,58,107,0.04), rgba(27,58,107,0.10));
          box-shadow: 0 0 0 1px var(--primary) inset;
        }
        .card input[type=checkbox] {
          accent-color: var(--primary);
          width: 16px;
          height: 16px;
          margin: 0;
          flex-shrink: 0;
        }
        .card-body { flex: 1; min-width: 0; line-height: 1.3; }
        .card-code { font-weight: 600; color: var(--ink); font-size: 0.84rem; }
        .card-meta { font-size: 0.7rem; color: var(--muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .card.selected .card-code { color: var(--primary-dark); }

        .moments-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 6px;
        }
        .moment-chip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px 12px;
          font-size: 0.78rem;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 999px;
          color: var(--n-700);
          cursor: pointer;
          transition: all 120ms ease;
        }
        .moment-chip:hover { border-color: var(--primary-dim); background: var(--n-50); }
        .moment-chip.active {
          background: var(--primary);
          color: #fff;
          border-color: var(--primary);
          font-weight: 600;
        }
        .moment-chip input { display: none; }

        .summary-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          background: linear-gradient(135deg, rgba(27,58,107,0.05), rgba(27,58,107,0.02));
          border: 1px solid var(--line);
          border-radius: 12px;
          margin-top: 18px;
        }
        .summary-stat-row { display: flex; gap: 22px; }
        .summary-stat .l { font-size: 0.66rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.4px; font-weight: 600; }
        .summary-stat .v { font-size: 1.2rem; font-weight: 700; color: var(--primary); letter-spacing: -0.01em; }

        .actions-bar {
          display: flex;
          gap: 10px;
          align-items: center;
          padding: 16px 24px;
          background: var(--n-50);
          border-top: 1px solid var(--line);
          flex-wrap: wrap;
        }
        .btn {
          padding: 9px 18px;
          font-size: 0.85rem;
          font-weight: 600;
          border-radius: 8px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: all 130ms ease;
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .btn-primary {
          background: var(--primary);
          color: #fff;
          border-color: var(--primary);
        }
        .btn-primary:not(:disabled):hover { background: var(--primary-dark); border-color: var(--primary-dark); }
        .btn-secondary {
          background: #fff;
          color: var(--ink);
          border-color: var(--line);
        }
        .btn-secondary:not(:disabled):hover { border-color: var(--n-300); background: var(--n-50); }
        .btn-danger {
          background: var(--red-light);
          color: var(--red);
          border-color: #fecaca;
        }
        .btn-danger:not(:disabled):hover { background: var(--red); color: #fff; border-color: var(--red); }
        .btn-ghost {
          background: transparent;
          color: var(--muted);
          border-color: transparent;
        }
        .btn-ghost:hover { color: var(--ink); background: var(--n-100); }
        .actions-help {
          font-size: 0.74rem;
          color: var(--muted);
          margin-left: auto;
          max-width: 380px;
          line-height: 1.4;
        }

        .alert {
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 0.83rem;
          line-height: 1.5;
          margin-bottom: 14px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .alert-icon { font-size: 1.05rem; flex-shrink: 0; line-height: 1.2; }
        .alert.info { background: var(--blue-light); border: 1px solid #bfdbfe; color: #1e3a8a; }
        .alert.warn { background: var(--amber-light); border: 1px solid #fcd34d; color: #92400e; }
        .alert.success { background: var(--green-light); border: 1px solid #86efac; color: #166534; }
        .alert.error { background: var(--red-light); border: 1px solid #fca5a5; color: #991b1b; }

        .running {
          padding: 16px 20px;
          background: linear-gradient(135deg, rgba(245,158,11,0.06), rgba(245,158,11,0.02));
          border: 1px solid #fcd34d;
          border-radius: 12px;
          margin-bottom: 14px;
        }
        .running-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .running-pills { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .progress {
          height: 8px;
          background: rgba(245,158,11,0.15);
          border-radius: 999px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #f59e0b, #d97706);
          transition: width 250ms ease;
        }
        .progress-label {
          margin-top: 6px;
          font-size: 0.72rem;
          color: #92400e;
          font-weight: 500;
        }

        .preview {
          margin-top: 16px;
          border: 1px solid var(--line);
          border-radius: 12px;
          overflow: hidden;
        }
        .preview-head {
          padding: 12px 16px;
          background: var(--n-50);
          border-bottom: 1px solid var(--line);
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .preview-table-wrap { overflow-x: auto; }
        .preview-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.82rem;
        }
        .preview-table th {
          text-align: left;
          padding: 10px 14px;
          background: #fff;
          font-size: 0.66rem;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--muted);
          font-weight: 600;
          border-bottom: 1px solid var(--line);
        }
        .preview-table td {
          padding: 10px 14px;
          border-bottom: 1px solid var(--line2);
          color: var(--ink);
        }
        .preview-table tr:last-child td { border-bottom: none; }
        .preview-table tr:hover td { background: var(--n-50); }

        .results-block {
          margin-top: 24px;
          border: 1px solid var(--line);
          border-radius: 14px;
          overflow: hidden;
          background: #fff;
        }
        .results-head {
          padding: 16px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--line);
          background: linear-gradient(135deg, rgba(27,58,107,0.03), transparent);
        }
        .results-head h3 {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--ink);
          letter-spacing: -0.01em;
        }
        .results-stats { display: flex; gap: 8px; flex-wrap: wrap; }
        .pager {
          padding: 12px 20px;
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: center;
          background: var(--n-50);
          border-top: 1px solid var(--line);
        }

        .config {
          margin-top: 16px;
          padding: 14px 18px;
          background: var(--n-50);
          border: 1px dashed var(--line);
          border-radius: 12px;
        }
        .config summary {
          font-size: 0.82rem;
          font-weight: 600;
          color: var(--muted);
          cursor: pointer;
          padding: 4px 0;
          list-style: none;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .config summary::before {
          content: '›';
          color: var(--primary);
          font-size: 1rem;
          transition: transform 150ms ease;
        }
        .config[open] summary::before { transform: rotate(90deg); }
        .config-body { padding-top: 12px; }
        .meta-line {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          color: var(--muted);
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 6px 10px;
          margin-top: 6px;
          word-break: break-all;
        }

        .log-tail {
          font-family: var(--font-mono);
          font-size: 0.7rem;
          background: #0f172a;
          color: #cbd5e1;
          padding: 12px 14px;
          border-radius: 8px;
          max-height: 240px;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          line-height: 1.4;
          margin-top: 10px;
        }

        @media (max-width: 720px) {
          .stats-row { grid-template-columns: repeat(2, 1fr); }
          .banner-hero { grid-template-columns: 1fr; }
          .hero-status { align-items: flex-start; }
          .summary-bar { flex-direction: column; align-items: flex-start; gap: 12px; }
          .actions-bar { padding: 14px 18px; }
          .actions-help { margin-left: 0; }
        }
      `}</style>

      {/* HERO */}
      <section className="banner-shell">
        <div className="banner-hero">
          <div>
            <h1>Automatización Banner</h1>
            <p>Consulta NRC en Banner por lote, individual o por reintento. Los resultados se importan a la base del sistema con un clic.</p>
          </div>
          <div className="hero-status">
            <div className="hero-status-row">
              <span className={`pill ${status?.runner.running ? 'warn' : status?.runner.lastRun?.status === 'FAILED' ? 'danger' : status?.runner.lastRun?.status === 'COMPLETED' ? 'ok' : ''}`}>
                <span className="dot" />
                {runnerStatusLabel}
              </span>
              <span className={`pill ${status?.projectRootExists ? 'ok' : 'danger'}`}>
                Runner {status?.projectRootExists ? 'OK' : 'no encontrado'}
              </span>
            </div>
            <button type="button" className="ghost-btn" onClick={loadAll} disabled={loading || actionLoading}>
              {loading ? 'Actualizando…' : '↻ Actualizar'}
            </button>
          </div>
        </div>

        {/* STATS */}
        <div className="stats-row">
          <div className="stat">
            <div className="stat-l">Export Banner</div>
            <div className="stat-v">{exportTotal.toLocaleString('es-CO')}</div>
            <div className="stat-h">filas en último export</div>
          </div>
          <div className="stat ok">
            <div className="stat-l">Encontrados</div>
            <div className="stat-v">{statEncontrado.toLocaleString('es-CO')}</div>
            <div className="stat-h">docentes resueltos</div>
          </div>
          <div className="stat warn">
            <div className="stat-l">Sin docente</div>
            <div className="stat-v">{statSinDocente.toLocaleString('es-CO')}</div>
            <div className="stat-h">requieren atención</div>
          </div>
          <div className="stat danger">
            <div className="stat-l">No encontrados</div>
            <div className="stat-v">{statNoEncontrado.toLocaleString('es-CO')}</div>
            <div className="stat-h">NRC sin coincidencia</div>
          </div>
        </div>

        <div className="body">
          {/* MENSAJES */}
          {message ? (
            <div className={`alert ${/error|fall|no fue|no se|expir/i.test(message) ? 'error' : /listo|guardad|en ejecu|importado|iniciado/i.test(message) ? 'success' : 'info'}`}>
              <span className="alert-icon">{/error|fall|no fue/i.test(message) ? '⚠' : /listo|iniciado|guardad/i.test(message) ? '✓' : 'ⓘ'}</span>
              <div>{message}</div>
            </div>
          ) : null}

          {(() => {
            const lastAuth = status?.runner.lastRun?.command === 'auth' && status?.runner.lastRun?.status === 'COMPLETED';
            const tone = authNeedsAttention
              ? { name: 'warn', bg: 'linear-gradient(135deg, #fffbeb, #fef3c7)', border: '#fcd34d', borderLeft: '#d97706', iconBg: '#fcd34d', titleColor: '#78350f', textColor: '#92400e', primaryBg: '#d97706', primaryBorder: '#d97706', secondaryBorder: '#fcd34d', secondaryColor: '#92400e', icon: '🔒', title: 'Sesión Banner requerida', desc: 'Pulsa Abrir login, completa SSO/2FA en Edge y luego Guardar sesión.' }
              : lastAuth
                ? { name: 'ok', bg: 'linear-gradient(135deg, #ecfdf5, #d1fae5)', border: '#86efac', borderLeft: '#059669', iconBg: '#86efac', titleColor: '#064e3b', textColor: '#166534', primaryBg: '#059669', primaryBorder: '#059669', secondaryBorder: '#86efac', secondaryColor: '#166534', icon: '🔓', title: 'Sesión Banner activa', desc: 'Sesión guardada correctamente. Renueva con Abrir login si Banner pide credenciales nuevamente.' }
                : { name: 'neutral', bg: 'linear-gradient(135deg, #f8fafc, #f1f5f9)', border: 'var(--line)', borderLeft: 'var(--primary)', iconBg: 'var(--primary-light)', titleColor: 'var(--ink)', textColor: 'var(--muted)', primaryBg: 'var(--primary)', primaryBorder: 'var(--primary)', secondaryBorder: 'var(--line)', secondaryColor: 'var(--ink)', icon: '🔐', title: 'Sesión Banner', desc: 'Sin información reciente de autenticación. Ejecuta Abrir login si Banner aún no responde.' };
            return (
              <div style={{
                padding: '16px 18px',
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                borderLeft: `4px solid ${tone.borderLeft}`,
                borderRadius: 12,
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: tone.iconBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: 18,
                  }}>{tone.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: tone.titleColor }}>{tone.title}</div>
                      <span style={{ display: 'inline-flex', padding: '2px 9px', borderRadius: 999, background: '#fff', color: tone.titleColor, border: `1px solid ${tone.border}`, fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                        {tone.name === 'ok' ? 'Activa' : tone.name === 'warn' ? 'Reauth' : 'Sin info'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: tone.textColor, lineHeight: 1.5, marginBottom: 12 }}>
                      {tone.desc}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={startBannerAuth}
                        disabled={loading || actionLoading || !!status?.runner.running}
                        style={{
                          padding: '8px 16px',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          borderRadius: 8,
                          border: `1.5px solid ${tone.primaryBorder}`,
                          background: tone.primaryBg,
                          color: '#fff',
                          cursor: 'pointer',
                          opacity: (loading || actionLoading || !!status?.runner.running) ? 0.45 : 1,
                        }}
                      >
                        Abrir login
                      </button>
                      <button
                        type="button"
                        onClick={confirmBannerAuth}
                        disabled={loading || actionLoading || status?.runner.current?.command !== 'auth' || !status.runner.current?.awaitingInput}
                        style={{
                          padding: '8px 16px',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          borderRadius: 8,
                          border: `1.5px solid ${tone.secondaryBorder}`,
                          background: '#fff',
                          color: tone.secondaryColor,
                          cursor: 'pointer',
                          opacity: (loading || actionLoading || status?.runner.current?.command !== 'auth' || !status.runner.current?.awaitingInput) ? 0.45 : 1,
                        }}
                      >
                        Guardar sesión
                      </button>
                    </div>
                  </div>
                </div>

                {/* Detalles colapsables: ruta proyecto + meta + log */}
                <details style={{ borderTop: `1px solid ${tone.border}`, paddingTop: 12 }}>
                  <summary style={{ fontSize: '0.76rem', fontWeight: 600, color: tone.textColor, cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '1rem' }}>›</span>
                    Configuración avanzada del runner
                  </summary>
                  <div style={{ paddingTop: 12 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div className="field modern">
                        <label className="field-l">Ruta del proyecto Banner</label>
                        <input value={projectRootInput} onChange={(e) => setProjectRootInput(e.target.value)} placeholder="/ruta/al/proyecto-banner" />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={saveProjectRoot}
                      disabled={loading || actionLoading || !!status?.runner.running}
                      style={{
                        padding: '7px 14px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        borderRadius: 8,
                        border: `1.5px solid ${tone.secondaryBorder}`,
                        background: '#fff',
                        color: tone.secondaryColor,
                        cursor: 'pointer',
                        marginBottom: 10,
                        opacity: (loading || actionLoading || !!status?.runner.running) ? 0.45 : 1,
                      }}
                    >
                      Guardar ruta
                    </button>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: tone.textColor, background: '#fff', border: `1px solid ${tone.border}`, borderRadius: 6, padding: '6px 10px', marginTop: 6, wordBreak: 'break-all' }}>
                      {projectRootLooksLinux ? `Ruta Linux: ${bannerRootPreview}` :
                        projectRootLooksMounted ? `Ruta /mnt: ${bannerRootPreview} (mover a copia Linux recomendado)` :
                        `Ruta actual: ${bannerRootPreview || 'Sin configurar'}`}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: tone.textColor, background: '#fff', border: `1px solid ${tone.border}`, borderRadius: 6, padding: '6px 10px', marginTop: 6, wordBreak: 'break-all' }}>
                      Último archivo: {basename(status?.exportSummary.latestFile)}
                    </div>
                    {latestRunQueryId ? (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: tone.textColor, background: '#fff', border: `1px solid ${tone.border}`, borderRadius: 6, padding: '6px 10px', marginTop: 6, wordBreak: 'break-all' }}>
                        Último Query ID: {latestRunQueryId}
                      </div>
                    ) : null}
                    {status?.runner.lastRun ? (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: tone.textColor, background: '#fff', border: `1px solid ${tone.border}`, borderRadius: 6, padding: '6px 10px', marginTop: 6, wordBreak: 'break-all' }}>
                        Última corrida: {status.runner.lastRun.command} | {status.runner.lastRun.status}
                        {status.runner.lastRun.startedAt ? ` · inicio ${status.runner.lastRun.startedAt}` : ''}
                        {status.runner.lastRun.endedAt ? ` · fin ${status.runner.lastRun.endedAt}` : ''}
                      </div>
                    ) : null}
                    {!status?.runner.running && status?.runner.logTail ? (
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ fontSize: '0.74rem', color: tone.textColor, cursor: 'pointer', fontWeight: 600 }}>Log última corrida</summary>
                        <pre style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '0.7rem', background: '#0f172a', color: '#cbd5e1', padding: '12px 14px', borderRadius: 8, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>{status.runner.logTail}</pre>
                      </details>
                    ) : null}
                  </div>
                </details>
              </div>
            );
          })()}

          {/* PROCESO EN CURSO */}
          {status?.runner.running ? (
            <div style={{
              padding: '18px 20px',
              background: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
              border: '1px solid #fdba74',
              borderRadius: 14,
              marginBottom: 16,
              boxShadow: '0 2px 8px rgba(217,119,6,0.08)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '5px 12px',
                    borderRadius: 999,
                    background: '#fff',
                    color: '#9a3412',
                    border: '1px solid #fdba74',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                  }}>
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: '#f97316',
                      display: 'inline-block',
                      animation: 'bv2-pulse 1.4s ease-in-out infinite',
                    }} />
                    En curso
                  </span>
                  {liveActivity?.queryId ? (
                    <span style={{ display: 'inline-flex', padding: '5px 11px', borderRadius: 999, background: '#fff', color: '#9a3412', border: '1px solid #fed7aa', fontSize: '0.72rem', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                      Query {liveActivity.queryId.slice(0, 12)}…
                    </span>
                  ) : null}
                  {liveActivity?.workers != null ? (
                    <span style={{ display: 'inline-flex', padding: '5px 11px', borderRadius: 999, background: '#fff', color: '#9a3412', border: '1px solid #fed7aa', fontSize: '0.72rem', fontWeight: 500 }}>
                      {liveActivity.workers} workers
                    </span>
                  ) : null}
                  <span style={{ display: 'inline-flex', padding: '5px 11px', borderRadius: 999, background: '#9a3412', color: '#fff', border: '1px solid #9a3412', fontSize: '0.72rem', fontWeight: 600 }}>
                    {progressDone}{progressTotal > 0 ? ` / ${progressTotal}` : ''} NRC
                  </span>
                </div>
                <button
                  type="button"
                  onClick={cancelBanner}
                  disabled={actionLoading}
                  style={{
                    padding: '7px 16px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    borderRadius: 8,
                    border: '1.5px solid #dc2626',
                    background: '#fff',
                    color: '#dc2626',
                    cursor: 'pointer',
                    opacity: actionLoading ? 0.45 : 1,
                  }}
                >
                  Cancelar proceso
                </button>
              </div>
              {progressTotal > 0 ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.72rem', color: '#9a3412', fontWeight: 600 }}>
                    <span>Progreso</span>
                    <span>{progressPct}%</span>
                  </div>
                  <div style={{ height: 8, background: 'rgba(217,119,6,0.15)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      background: 'linear-gradient(90deg, #f97316, #ea580c)',
                      width: `${progressPct}%`,
                      transition: 'width 250ms ease',
                      borderRadius: 999,
                    }} />
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fff', border: '1px solid #fed7aa', borderRadius: 8, fontSize: '0.78rem', color: '#9a3412' }}>
                  <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #f97316', borderTopColor: 'transparent', borderRadius: 999, animation: 'bv2-spin 800ms linear infinite' }} />
                  Esperando inicio del proceso…
                </div>
              )}
              {status.runner.logTail ? (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: '0.74rem', color: '#9a3412', fontWeight: 600, cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '1rem' }}>›</span>
                    Ver log del proceso
                  </summary>
                  <pre style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '0.7rem', background: '#0f172a', color: '#cbd5e1', padding: '12px 14px', borderRadius: 8, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>{status.runner.logTail}</pre>
                </details>
              ) : null}
            </div>
          ) : null}

          {/* TABS */}
          <div className="tabs">
            {TABS.map((tab) => (
              <button key={tab.id} className={`tab${mode === tab.id ? ' active' : ''}`} onClick={() => setMode(tab.id)} type="button">
                <span className="tab-label">{tab.label}</span>
                <span className="tab-desc">{tab.desc}</span>
              </button>
            ))}
          </div>

          {/* MODO: LOOKUP */}
          {mode === 'lookup' ? (
            <div className="form">
              <div className="field">
                <label className="field-l">NRC</label>
                <input value={nrc} onChange={(e) => setNrc(e.target.value)} placeholder="72305" />
              </div>
              <div className="field">
                <label className="field-l">Periodo</label>
                <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="202615" />
              </div>
              <div className="field">
                <label className="field-l">Nombre de consulta</label>
                <input value={queryName} onChange={(e) => setQueryName(e.target.value)} placeholder="banner-rpaca" />
              </div>
            </div>
          ) : null}

          {/* MODO: BATCH */}
          {mode === 'batch' ? (
            <>
              <div className="form">
                <div className="field">
                  <label className="field-l">Fuente de NRC</label>
                  <select value={batchInputMode} onChange={(e) => setBatchInputMode(e.target.value as BatchInputMode)}>
                    <option value="DATABASE">Periodos RPACA (recomendado)</option>
                    <option value="MANUAL_INPUT">Archivo CSV manual</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-l">Nombre de consulta</label>
                  <input value={queryName} onChange={(e) => setQueryName(e.target.value)} placeholder="banner-rpaca" />
                </div>
                {batchInputMode === 'DATABASE' ? (
                  <>
                    <div className="field">
                      <label className="field-l">Tipo de lote</label>
                      <select value={batchSource} onChange={(e) => setBatchSource(e.target.value as BannerBatchSource)}>
                        {(batchOptions?.sources ?? []).map((s) => (
                          <option key={s.code} value={s.code}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label className="field-l">Límite NRC (opcional)</label>
                      <input value={batchLimit} onChange={(e) => setBatchLimit(e.target.value)} placeholder="Ej: 20" />
                    </div>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 11,
                        padding: '12px 16px',
                        border: `1.5px solid ${resume ? 'var(--primary)' : 'var(--line)'}`,
                        borderRadius: 10,
                        background: resume ? 'rgba(27,58,107,0.05)' : '#fff',
                        fontSize: '0.85rem',
                        fontWeight: resume ? 600 : 500,
                        color: resume ? 'var(--primary-dark)' : 'var(--n-700)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        alignSelf: 'flex-end',
                        width: 'fit-content',
                        transition: 'all 140ms ease',
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          border: `1.5px solid ${resume ? 'var(--primary)' : 'var(--n-300)'}`,
                          borderRadius: 5,
                          background: resume ? 'var(--primary)' : '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 140ms ease',
                        }}
                      >
                        {resume ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : null}
                      </span>
                      <input
                        type="checkbox"
                        checked={resume}
                        onChange={(e) => setResume(e.target.checked)}
                        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                      />
                      <span>Reanudar lote anterior</span>
                    </label>
                  </>
                ) : (
                  <>
                    <div className="field modern" style={{ gridColumn: 'span 2' }}>
                      <label className="field-l">Archivo CSV del lote</label>
                      <input value={inputPath} onChange={(e) => setInputPath(e.target.value)} placeholder="Ruta del CSV" />
                    </div>
                    <div className="field modern">
                      <label className="field-l">Periodo por defecto</label>
                      <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="202615" />
                    </div>
                  </>
                )}
              </div>

              {batchInputMode === 'DATABASE' ? (
                <>
                  {/* Atajos */}
                  <div style={{ marginTop: 22, width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid var(--line)' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', textTransform: 'none' }}>Periodos disponibles</h3>
                        <div style={{ fontSize: '0.74rem', color: 'var(--muted)', fontWeight: 500, marginTop: 2 }}>{selectedPeriodCodes.length} de {batchOptions?.periods.length ?? 0} seleccionado{selectedPeriodCodes.length !== 1 ? 's' : ''}</div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <button type="button" className="quick" onClick={() => selectPeriods((batchOptions?.periods ?? []).map((p) => p.code))} disabled={actionLoading}>Todos</button>
                        {latestYear ? (
                          <button type="button" className="quick primary" onClick={() => selectPeriods(batchOptions?.years.find((y) => y.year === latestYear)?.periodCodes ?? [])} disabled={actionLoading}>
                            Solo {latestYear}
                          </button>
                        ) : null}
                        {(batchOptions?.years ?? []).map((y) => (
                          <button type="button" key={y.year} className="quick" onClick={() => toggleYear(y.year)} disabled={actionLoading}>
                            {y.year} ({y.courseCount})
                          </button>
                        ))}
                        <button type="button" className="quick" onClick={() => setSelectedPeriodCodes([])} disabled={actionLoading}>Limpiar</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, width: '100%' }}>
                      {(batchOptions?.periods ?? []).map((p) => {
                        const checked = selectedPeriodCodes.includes(p.code);
                        return (
                          <label key={p.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: `1px solid ${checked ? 'var(--primary)' : 'var(--line)'}`, borderRadius: 10, background: checked ? 'rgba(27,58,107,0.06)' : '#fff', cursor: 'pointer', fontSize: '0.82rem', minWidth: 0, boxShadow: checked ? '0 0 0 1px var(--primary) inset' : 'none', transition: 'all 130ms ease' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setSelectedPeriodCodes((curr) => toggleSelection(curr, p.code))}
                              style={{ accentColor: 'var(--primary)', width: 16, height: 16, margin: 0, flexShrink: 0 }}
                            />
                            <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                              <div style={{ fontWeight: 600, color: checked ? 'var(--primary-dark)' : 'var(--ink)', fontSize: '0.84rem' }}>{p.code}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label} · {p.courseCount} NRC</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Momentos */}
                  {(batchOptions?.moments ?? []).length > 0 ? (
                    <div style={{ marginTop: 22, width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid var(--line)' }}>
                        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', textTransform: 'none' }}>Filtrar por momento</h3>
                        <button type="button" className="quick" onClick={() => setSelectedMoments([])} disabled={actionLoading}>Todos</button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(batchOptions?.moments ?? []).map((m) => {
                          const active = selectedMoments.includes(m.code);
                          return (
                            <label
                              key={m.code}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 7,
                                padding: '6px 14px',
                                fontSize: '0.78rem',
                                fontWeight: active ? 600 : 500,
                                background: active ? 'var(--primary)' : '#fff',
                                color: active ? '#fff' : 'var(--n-700)',
                                border: `1.5px solid ${active ? 'var(--primary)' : 'var(--line)'}`,
                                borderRadius: 999,
                                cursor: 'pointer',
                                transition: 'all 120ms ease',
                                userSelect: 'none',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() => setSelectedMoments((curr) => toggleSelection(curr, m.code))}
                                style={{ display: 'none' }}
                              />
                              <span>{m.code} · {m.courseCount}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* Resumen */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'linear-gradient(135deg, rgba(27,58,107,0.05), rgba(27,58,107,0.01))', border: '1px solid var(--line)', borderRadius: 12, marginTop: 22, gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 28 }}>
                      <div>
                        <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.4px', fontWeight: 600 }}>Periodos</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{selectedPeriodCodes.length}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.4px', fontWeight: 600 }}>NRC estimados</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{selectedCourseCount.toLocaleString('es-CO')}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.4px', fontWeight: 600 }}>De un total</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--n-500)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{totalCoursesAll.toLocaleString('es-CO')}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={previewDatabaseBatch}
                      disabled={actionLoading || !selectedPeriodCodes.length || !!status?.runner.running}
                      style={{
                        padding: '10px 18px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        background: '#fff',
                        color: 'var(--ink)',
                        border: '1.5px solid var(--line)',
                        borderRadius: 10,
                        cursor: 'pointer',
                        opacity: (actionLoading || !selectedPeriodCodes.length || !!status?.runner.running) ? 0.45 : 1,
                        transition: 'all 130ms ease',
                      }}
                    >
                      {actionLoading ? 'Calculando…' : '👁  Previsualizar lote'}
                    </button>
                  </div>

                  {/* Preview */}
                  {batchPreview ? (
                    <div style={{ marginTop: 16, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                      <div style={{ padding: '12px 16px', background: 'var(--n-50)', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: 'var(--primary-light)', color: 'var(--primary-dark)', fontSize: '0.74rem', fontWeight: 600, border: '1px solid rgba(27,58,107,0.2)' }}>
                          <strong style={{ marginRight: 4 }}>{batchPreview.total}</strong> NRC en lote
                        </span>
                        {Object.entries(batchPreview.byBannerStatus).slice(0, 5).map(([k, v]) => {
                          const tone = k === 'ENCONTRADO' ? { bg: 'var(--green-light)', color: '#166534', bd: '#86efac' } :
                            k === 'NO_ENCONTRADO' ? { bg: 'var(--red-light)', color: '#991b1b', bd: '#fca5a5' } :
                            k.startsWith('SIN') ? { bg: 'var(--amber-light)', color: '#92400e', bd: '#fcd34d' } :
                            { bg: 'var(--n-100)', color: 'var(--n-700)', bd: 'var(--line)' };
                          return (
                            <span key={k} style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: tone.bg, color: tone.color, border: `1px solid ${tone.bd}`, fontSize: '0.72rem', fontWeight: 600 }}>{k}: {v}</span>
                          );
                        })}
                        {Object.entries(batchPreview.byMoment ?? {}).slice(0, 4).map(([k, v]) => (
                          <span key={k} style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: 'var(--n-100)', color: 'var(--n-700)', border: '1px solid var(--line)', fontSize: '0.72rem', fontWeight: 500 }}>Momento {k}: {v}</span>
                        ))}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr>
                              {['NRC', 'Periodo', 'Asignatura', 'Docente actual', 'Estado Banner'].map((h) => (
                                <th key={h} style={{ textAlign: 'left', padding: '10px 14px', background: '#fff', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {batchPreview.sample.map((item) => (
                              <tr key={`${item.courseId}-${item.nrc}`}>
                                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}><strong>{item.nrc}</strong></td>
                                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>{item.periodCode}</td>
                                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>{item.subjectName ?? '—'}</td>
                                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)', color: item.teacherName ? 'var(--ink)' : 'var(--muted)' }}>{item.teacherName ?? 'Sin docente'}</td>
                                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>
                                  <span style={{ display: 'inline-flex', padding: '3px 9px', borderRadius: 999, background: 'var(--amber-light)', color: '#92400e', border: '1px solid #fcd34d', fontSize: '0.7rem', fontWeight: 600 }}>{item.bannerReviewStatus ?? 'SIN_DATO'}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {/* MODO: RETRY */}
          {mode === 'retry-errors' ? (
            <div className="form">
              <div className="field">
                <label className="field-l">Query ID</label>
                <input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="Pega el Query ID" />
              </div>
              <div className="field">
                <label className="field-l">Workers</label>
                <input value={String(BANNER_STABLE_WORKERS)} readOnly />
              </div>
            </div>
          ) : null}

          {/* MODO: EXPORT */}
          {mode === 'export' ? (
            <div className="form">
              <div className="field">
                <label className="field-l">Query ID</label>
                <input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="Pega el Query ID" />
              </div>
              <div className="field">
                <label className="field-l">Formato</label>
                <input value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} placeholder="csv,json" />
              </div>
            </div>
          ) : null}
        </div>

        {/* ACTIONS BAR */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '16px 24px', background: 'var(--n-50)', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
          {mode === 'batch' && batchInputMode === 'DATABASE' ? (
            <>
              <button
                type="button"
                onClick={startBannerAndImport}
                disabled={!canStart || !selectedPeriodCodes.length}
                style={{
                  padding: '10px 20px',
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  borderRadius: 10,
                  border: '1.5px solid var(--primary)',
                  background: 'var(--primary)',
                  color: '#fff',
                  cursor: 'pointer',
                  opacity: (!canStart || !selectedPeriodCodes.length) ? 0.45 : 1,
                  transition: 'all 130ms ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {actionLoading ? 'Procesando…' : '⚡ Buscar y actualizar base'}
              </button>
              <button
                type="button"
                onClick={startBanner}
                disabled={!canStart || !selectedPeriodCodes.length}
                style={{
                  padding: '10px 20px',
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  borderRadius: 10,
                  border: '1.5px solid var(--line)',
                  background: '#fff',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  opacity: (!canStart || !selectedPeriodCodes.length) ? 0.45 : 1,
                  transition: 'all 130ms ease',
                }}
              >
                Solo buscar en Banner
              </button>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: 'auto', maxWidth: 380, lineHeight: 1.4 }}>El primer botón hace flujo completo. El segundo solo consulta sin importar.</span>
            </>
          ) : (
            <button
              type="button"
              onClick={startBanner}
              disabled={!canStart}
              style={{
                padding: '10px 20px',
                fontSize: '0.86rem',
                fontWeight: 600,
                borderRadius: 10,
                border: '1.5px solid var(--primary)',
                background: 'var(--primary)',
                color: '#fff',
                cursor: 'pointer',
                opacity: !canStart ? 0.45 : 1,
              }}
            >
              {actionLoading ? 'Procesando…' : START_BUTTON_LABELS[mode]}
            </button>
          )}
        </div>
      </section>

      {/* RESULTADOS */}
      <section style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 4px 16px rgba(15,23,42,0.06)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--line)', background: 'linear-gradient(135deg, rgba(27,58,107,0.03), transparent)' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', textTransform: 'none' }}>Último export Banner</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: 'var(--n-100)', color: 'var(--n-700)', border: '1px solid var(--line)', fontSize: '0.74rem', fontWeight: 600 }}>
              <strong style={{ color: 'var(--ink)', marginRight: 4 }}>{exportTotal}</strong> filas
            </span>
            {Object.entries(statusCounts).slice(0, 4).map(([k, v]) => {
              const tone = k.includes('ENCONTRADO') && !k.includes('NO') ? { bg: 'var(--green-light)', color: '#166534', bd: '#86efac' } :
                k.includes('NO_') ? { bg: 'var(--red-light)', color: '#991b1b', bd: '#fca5a5' } :
                k.includes('SIN') ? { bg: 'var(--amber-light)', color: '#92400e', bd: '#fcd34d' } :
                { bg: 'var(--n-100)', color: 'var(--n-700)', bd: 'var(--line)' };
              return <span key={k} style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: tone.bg, color: tone.color, border: `1px solid ${tone.bd}`, fontSize: '0.72rem', fontWeight: 600 }}>{k}: {v}</span>;
            })}
            <button
              type="button"
              onClick={loadFullResults}
              disabled={fullResultsLoading || !!status?.runner.running}
              style={{ padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, background: '#fff', color: 'var(--ink)', border: '1.5px solid var(--line)', borderRadius: 8, cursor: 'pointer', opacity: (fullResultsLoading || !!status?.runner.running) ? 0.45 : 1 }}
            >
              {fullResultsLoading ? 'Cargando…' : 'Cargar todos'}
            </button>
            {fullResults !== null ? (
              <button type="button" onClick={() => { setFullResults(null); setResultsPage(0); }} style={{ padding: '7px 12px', fontSize: '0.8rem', background: 'transparent', color: 'var(--muted)', border: 'none', cursor: 'pointer' }}>Mostrar preview</button>
            ) : null}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                {['NRC', 'Periodo', 'Docente', 'ID', 'Estado', 'Inicio', 'Cierre', 'Revisado'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', background: '#fff', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--line)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedResults.length ? pagedResults.map((item) => {
                const tone = item.status === 'ENCONTRADO' ? { bg: 'var(--green-light)', color: '#166534', bd: '#86efac' } :
                  item.status === 'NO_ENCONTRADO' ? { bg: 'var(--red-light)', color: '#991b1b', bd: '#fca5a5' } :
                  item.status === 'SIN_DOCENTE' ? { bg: 'var(--amber-light)', color: '#92400e', bd: '#fcd34d' } :
                  { bg: 'var(--n-100)', color: 'var(--n-700)', bd: 'var(--line)' };
                return (
                  <tr key={`${item.queryId ?? 'sin'}-${item.nrc}`}>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}><strong>{item.nrc}</strong></td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>{item.period ?? '—'}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)', color: item.teacherName ? 'var(--ink)' : 'var(--muted)' }}>{item.teacherName ?? '—'}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>{item.teacherId ?? '—'}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>
                      <span style={{ display: 'inline-flex', padding: '3px 9px', borderRadius: 999, background: tone.bg, color: tone.color, border: `1px solid ${tone.bd}`, fontSize: '0.7rem', fontWeight: 600 }}>{item.status ?? '—'}</span>
                    </td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>{item.startDate ?? '—'}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>{item.endDate ?? '—'}</td>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--line2)' }}>{item.checkedAt ? new Date(item.checkedAt).toLocaleDateString('es-CO') : '—'}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={8} style={{ color: 'var(--muted)', textAlign: 'center', padding: 24 }}>
                  {fullResults !== null ? 'Sin filas en el último export.' : 'Aún no hay exportación Banner disponible.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {totalResultPages > 1 ? (
          <div style={{ padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', background: 'var(--n-50)', borderTop: '1px solid var(--line)' }}>
            <button type="button" onClick={() => setResultsPage((p) => Math.max(0, p - 1))} disabled={resultsPage === 0} style={{ padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, background: '#fff', color: 'var(--ink)', border: '1.5px solid var(--line)', borderRadius: 8, cursor: 'pointer', opacity: resultsPage === 0 ? 0.45 : 1 }}>← Anterior</button>
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)', fontWeight: 500 }}>Página {resultsPage + 1} de {totalResultPages}</span>
            <button type="button" onClick={() => setResultsPage((p) => Math.min(totalResultPages - 1, p + 1))} disabled={resultsPage >= totalResultPages - 1} style={{ padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, background: '#fff', color: 'var(--ink)', border: '1.5px solid var(--line)', borderRadius: 8, cursor: 'pointer', opacity: resultsPage >= totalResultPages - 1 ? 0.45 : 1 }}>Siguiente →</button>
          </div>
        ) : null}
      </section>

      {/* IMPORTAR */}
      <section style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 4px 16px rgba(15,23,42,0.06)', padding: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em', textTransform: 'none' }}>Importar resultado a la base</h3>
        <div style={{ marginBottom: 14 }}>
          <div className="field modern">
            <label className="field-l">Archivo (opcional — vacío usa el último export)</label>
            <input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="Ruta del archivo Banner" />
          </div>
        </div>
        <button
          type="button"
          onClick={importBannerResult}
          disabled={actionLoading || !!status?.runner.running}
          style={{ padding: '10px 20px', fontSize: '0.86rem', fontWeight: 600, borderRadius: 10, border: '1.5px solid var(--primary)', background: 'var(--primary)', color: '#fff', cursor: 'pointer', opacity: (actionLoading || !!status?.runner.running) ? 0.45 : 1 }}
        >
          {actionLoading ? 'Procesando…' : '↓ Importar a la base'}
        </button>
        {importResult ? (
          <details style={{ marginTop: 14, padding: '12px 16px', background: 'var(--n-50)', border: '1px dashed var(--line)', borderRadius: 12 }}>
            <summary style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', cursor: 'pointer' }}>Resultado de la importación</summary>
            <pre style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: '0.7rem', background: '#0f172a', color: '#cbd5e1', padding: '12px 14px', borderRadius: 8, maxHeight: 240, overflow: 'auto' }}>{JSON.stringify(importResult, null, 2)}</pre>
          </details>
        ) : null}
      </section>

    </div>
  );
}

