'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';
import { Button, Field, StatusPill, AlertBox, PageHero, StatsGrid, PaginationControls, PAGE_SIZE_OPTIONS } from '../../_components/ui';
import type { PageSizeOption } from '../../_components/ui';
import type { PillTone } from '../../_components/ui/status-pill';
import type { AlertTone } from '../../_components/ui/alert-box';

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
    'Arma y ejecuta un lote de NRC. La recomendación es usar los periodos ya cargados por RPACA en la base actual.',
  'retry-errors': 'Toma un Query ID anterior y vuelve a intentar solo los NRC que fallaron.',
  export: 'Genera el CSV o JSON final de una consulta ya ejecutada en Banner.',
};

const START_BUTTON_LABELS: Record<BannerMode, string> = {
  lookup: 'Consultar NRC en Banner',
  batch: 'Iniciar lote Banner',
  'retry-errors': 'Reintentar errores',
  export: 'Exportar resultados',
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
    return 'Lote Banner iniciado. Al terminar se importará automáticamente a la base.';
  }
  const payload = data as Record<string, unknown>;
  const result = payload.result as Record<string, unknown> | undefined;
  const batch = result?.batch as Record<string, unknown> | undefined;
  if (batch && typeof batch.total === 'number') {
    return `Lote Banner iniciado con ${batch.total} NRC. Al terminar se importará automáticamente a la base.`;
  }
  return 'Lote Banner iniciado. Al terminar se importará automáticamente a la base.';
}

function extractQueryIdFromLog(logTail: string | undefined) {
  if (!logTail) return null;
  const match = logTail.match(/queryId:\s*'([^']+)'|"queryId"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? match?.[2] ?? null;
}

function resolveToneForStatus(statusString: string | null | undefined): PillTone {
  if (!statusString) return 'neutral';
  const upper = statusString.toUpperCase();
  if (upper.includes('ENCONTRADO') && !upper.includes('NO')) return 'ok';
  if (upper.includes('NO_') || upper.includes('FAIL') || upper.includes('DANGER')) return 'danger';
  if (upper.includes('SIN') || upper.includes('WARN')) return 'warn';
  return 'neutral';
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
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsPageSize, setResultsPageSize] = useState<PageSizeOption>(PAGE_SIZE_OPTIONS[1]);

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
      setResultsPage(1);
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
          ? 'Ruta del proyecto Banner guardada. La interfaz ya usará ese runner.'
          : 'La ruta se guardó, pero no existe en disco. Revisa el path antes de correr Banner.',
      );
    } catch (error) {
      setMessage(`No fue posible guardar la ruta de Banner: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
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
      setMessage('Se abrió el login de Banner. Completa SSO/2FA en Edge y luego pulsa "Guardar sesión Banner".');
    } catch (error) {
      setMessage(`No fue posible iniciar autenticación Banner: ${error instanceof Error ? error.message : String(error)}`);
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
      setMessage('Guardando sesión Banner. Espera a que el proceso termine y luego vuelve a ejecutar la consulta.');
    } catch (error) {
      setMessage(`No fue posible guardar la sesión Banner: ${error instanceof Error ? error.message : String(error)}`);
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
      setMessage(`Preview listo: ${response.total} NRC entrarían en el lote.`);
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
        setMessage(`${MODE_LABELS[mode]} en ejecución.`);
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
        setMessage('Lote Banner manual en ejecución.');
      } else if (mode === 'retry-errors') {
        await runAction('start', {
          command: 'retry-errors',
          queryId,
          workers: BANNER_STABLE_WORKERS,
        });
        setMessage('Reintento de errores en ejecución.');
      } else {
        await runAction('start', {
          command: 'export',
          queryId,
          format: exportFormat,
        });
        setMessage('Exportación Banner en ejecución.');
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
        `No fue posible iniciar la búsqueda con importación automática: ${
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
      setMessage('Solicitud de cancelación enviada.');
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

  let lastRunStatusTone: PillTone = 'neutral';
  if (status?.runner.running) lastRunStatusTone = 'warn';
  else if (status?.runner.lastRun?.status === 'FAILED') lastRunStatusTone = 'danger';
  else if (status?.runner.lastRun?.status === 'COMPLETED') lastRunStatusTone = 'ok';

  const runnerStatusLabel =
    status?.runner.running
      ? 'Corriendo'
      : status?.runner.lastRun?.status === 'FAILED'
        ? 'Falló'
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
  const totalResultPages = Math.max(1, Math.ceil(activeResults.length / resultsPageSize));
  const pagedResults = activeResults.slice((resultsPage - 1) * resultsPageSize, resultsPage * resultsPageSize);

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

  // Message alert resolution
  let messageTone: AlertTone = 'info';
  if (/error|fall|no fue|no se|expir/i.test(message)) messageTone = 'error';
  else if (/listo|guardad|en ejecu|importado|iniciado/i.test(message)) messageTone = 'success';

  // Auth tone resolution
  const lastAuth = status?.runner.lastRun?.command === 'auth' && status?.runner.lastRun?.status === 'COMPLETED';
  const authConfig = authNeedsAttention
    ? { tone: 'warn' as const, icon: '🔒', title: 'Sesión Banner requerida', desc: 'Pulsa Abrir login, completa SSO/2FA en Edge y luego Guardar sesión.' }
    : lastAuth
      ? { tone: 'success' as const, icon: '🔓', title: 'Sesión Banner activa', desc: 'Sesión guardada correctamente. Renueva con Abrir login si Banner pide credenciales nuevamente.' }
      : { tone: 'info' as const, icon: '🔐', title: 'Sesión Banner', desc: 'Sin información reciente de autenticación. Ejecuta Abrir login si Banner aún no responde.' };

  return (
    <div className="banner-v2">
      {/* Estilos nativos puros centralizados para las tablas y paneles para máximo rendimiento */}
      {/* Estilos centralizados en modules.css */}


      {/* HERO SECTION */}
      <section className="premium-card">
        <PageHero
          title="Automatización Banner"
          description="Consulta NRC en Banner por lote, individual o por reintento. Los resultados se importan a la base del sistema de forma optimizada."
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusPill tone={lastRunStatusTone} variant="dark" dot={status?.runner.running}>
              {runnerStatusLabel}
            </StatusPill>
            <StatusPill tone={status?.projectRootExists ? 'ok' : 'danger'} variant="dark">
              Runner {status?.projectRootExists ? 'OK' : 'No encontrado'}
            </StatusPill>
          </div>
          <Button variant="ghost" size="sm" onClick={loadAll} loading={loading || actionLoading}>
            ↻ Actualizar
          </Button>
        </PageHero>

        <StatsGrid items={[
          { label: 'Export Banner', value: exportTotal.toLocaleString('es-CO'), help: 'filas en último export', tone: 'default' },
          { label: 'Encontrados', value: statEncontrado.toLocaleString('es-CO'), help: 'docentes resueltos', tone: 'ok' },
          { label: 'Sin docente', value: statSinDocente.toLocaleString('es-CO'), help: 'requieren atención', tone: statSinDocente > 0 ? 'warn' : 'ok' },
          { label: 'No encontrados', value: statNoEncontrado.toLocaleString('es-CO'), help: 'NRC sin coincidencia', tone: statNoEncontrado > 0 ? 'danger' : 'ok' },
        ]} />

        <div className="panel-body">
          {/* MENSAJES DE ALERTA */}
          {message ? (
            <AlertBox tone={messageTone}>{message}</AlertBox>
          ) : null}

          {/* BANNER DE SESIÓN */}
          <AlertBox tone={authConfig.tone} icon={authConfig.icon} style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.9rem' }}>{authConfig.title}</strong>
              <StatusPill tone={authConfig.tone === 'success' ? 'ok' : authConfig.tone === 'warn' ? 'warn' : 'neutral'}>
                {authConfig.tone === 'success' ? 'Activa' : authConfig.tone === 'warn' ? 'Reauth' : 'Sin info'}
              </StatusPill>
            </div>
            <div style={{ fontSize: '0.82rem', marginBottom: '12px', opacity: 0.9 }}>{authConfig.desc}</div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <Button
                variant={authConfig.tone === 'warn' ? 'primary' : 'secondary'}
                size="sm"
                onClick={startBannerAuth}
                disabled={loading || actionLoading || !!status?.runner.running}
              >
                Abrir login
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={confirmBannerAuth}
                disabled={loading || actionLoading || status?.runner.current?.command !== 'auth' || !status.runner.current?.awaitingInput}
              >
                Guardar sesión
              </Button>
            </div>

            {/* Configuración avanzada colapsable */}
            <details style={{ marginTop: '12px', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '12px' }}>
              <summary style={{ fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', outline: 'none' }}>
                Configuración avanzada del runner
              </summary>
              <div style={{ paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Field label="Ruta del proyecto Banner">
                  <input
                    value={projectRootInput}
                    onChange={(e) => setProjectRootInput(e.target.value)}
                    placeholder="/ruta/al/proyecto-banner"
                  />
                </Field>
                <div>
                  <Button size="sm" onClick={saveProjectRoot} disabled={loading || actionLoading || !!status?.runner.running}>
                    Guardar ruta
                  </Button>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', background: '#fff', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                  {projectRootLooksLinux ? `Ruta Linux: ${bannerRootPreview}` :
                    projectRootLooksMounted ? `Ruta /mnt: ${bannerRootPreview} (mover a copia Linux recomendado)` :
                    `Ruta actual: ${bannerRootPreview || 'Sin configurar'}`}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', background: '#fff', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                  Último archivo: {basename(status?.exportSummary.latestFile)}
                </div>
                {latestRunQueryId ? (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', background: '#fff', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                    Último Query ID: {latestRunQueryId}
                  </div>
                ) : null}
                {status?.runner.lastRun ? (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', background: '#fff', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}>
                    Última corrida: {status.runner.lastRun.command} | {status.runner.lastRun.status}
                  </div>
                ) : null}
                {!status?.runner.running && status?.runner.logTail ? (
                  <details>
                    <summary style={{ fontSize: '0.74rem', cursor: 'pointer', fontWeight: 600 }}>Log última corrida</summary>
                    <pre style={{ marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', background: '#0f172a', color: '#cbd5e1', padding: '12px', borderRadius: '8px', maxHeight: '200px', overflow: 'auto' }}>
                      {status.runner.logTail}
                    </pre>
                  </details>
                ) : null}
              </div>
            </details>
          </AlertBox>

          {/* PROCESO EN CURSO */}
          {status?.runner.running ? (
            <div style={{ padding: '18px 22px', background: 'var(--amber-light, #fffbeb)', border: '1px solid #fcd34d', borderRadius: '14px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatusPill tone="warn" dot={true}>En curso</StatusPill>
                  {liveActivity?.queryId ? (
                    <StatusPill tone="neutral">Query {liveActivity.queryId.slice(0, 12)}…</StatusPill>
                  ) : null}
                  {liveActivity?.workers != null ? (
                    <StatusPill tone="neutral">{liveActivity.workers} workers</StatusPill>
                  ) : null}
                  <StatusPill tone="neutral" style={{ background: '#d97706', color: '#fff', borderColor: '#d97706' }}>
                    {progressDone}{progressTotal > 0 ? ` / ${progressTotal}` : ''} NRC
                  </StatusPill>
                </div>
                <Button variant="danger" size="sm" onClick={cancelBanner} disabled={actionLoading}>
                  Cancelar proceso
                </Button>
              </div>
              {progressTotal > 0 ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.75rem', color: '#92400e', fontWeight: 700 }}>
                    <span>Progreso</span>
                    <span>{progressPct}%</span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(217,119,6,0.15)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg, #f97316, #ea580c)', width: `${progressPct}%`, transition: 'width 250ms ease' }} />
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: 500 }}>Esperando inicio de tareas del lote…</div>
              )}
            </div>
          ) : null}

          {/* TABS CENTRALIZADOS */}
          <div className="ui-tabs-container">
            {TABS.map((tab) => (
              <button key={tab.id} className={`ui-tab-btn ${mode === tab.id ? 'active' : ''}`} onClick={() => setMode(tab.id)} type="button">
                <span className="t-lbl">{tab.label}</span>
                <span className="t-desc">{tab.desc}</span>
              </button>
            ))}
          </div>

          {/* MODO: LOOKUP */}
          {mode === 'lookup' ? (
            <div className="forms-grid">
              <Field label="NRC">
                <input value={nrc} onChange={(e) => setNrc(e.target.value)} placeholder="72305" />
              </Field>
              <Field label="Periodo">
                <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="202615" />
              </Field>
              <Field label="Nombre de consulta">
                <input value={queryName} onChange={(e) => setQueryName(e.target.value)} placeholder="banner-rpaca" />
              </Field>
            </div>
          ) : null}

          {/* MODO: BATCH */}
          {mode === 'batch' ? (
            <>
              <div className="forms-grid">
                <Field label="Fuente de NRC">
                  <select value={batchInputMode} onChange={(e) => setBatchInputMode(e.target.value as BatchInputMode)}>
                    <option value="DATABASE">Periodos RPACA (recomendado)</option>
                    <option value="MANUAL_INPUT">Archivo CSV manual</option>
                  </select>
                </Field>
                <Field label="Nombre de consulta">
                  <input value={queryName} onChange={(e) => setQueryName(e.target.value)} placeholder="banner-rpaca" />
                </Field>

                {batchInputMode === 'DATABASE' ? (
                  <>
                    <Field label="Tipo de lote">
                      <select value={batchSource} onChange={(e) => setBatchSource(e.target.value as BannerBatchSource)}>
                        {(batchOptions?.sources ?? []).map((s) => (
                          <option key={s.code} value={s.code}>{s.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Límite NRC (opcional)">
                      <input value={batchLimit} onChange={(e) => setBatchLimit(e.target.value)} placeholder="Ej: 20" />
                    </Field>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', alignSelf: 'center', padding: '12px 14px', background: resume ? 'var(--n-50)' : 'transparent', borderRadius: '10px', border: '1px solid var(--line)' }}>
                      <input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }} />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Reanudar lote anterior</span>
                    </label>
                  </>
                ) : (
                  <>
                    <Field label="Archivo CSV del lote" style={{ gridColumn: 'span 2' }}>
                      <input value={inputPath} onChange={(e) => setInputPath(e.target.value)} placeholder="Ruta del CSV" />
                    </Field>
                    <Field label="Periodo por defecto">
                      <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="202615" />
                    </Field>
                  </>
                )}
              </div>

              {batchInputMode === 'DATABASE' ? (
                <>
                  {/* Periodos de Base de Datos */}
                  <div style={{ marginTop: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                      <strong style={{ fontSize: '0.95rem' }}>Periodos disponibles ({selectedPeriodCodes.length} seleccionados)</strong>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <Button size="sm" onClick={() => selectPeriods((batchOptions?.periods ?? []).map((p) => p.code))}>Todos</Button>
                        {latestYear ? (
                          <Button variant="primary" size="sm" onClick={() => selectPeriods(batchOptions?.years.find((y) => y.year === latestYear)?.periodCodes ?? [])}>
                            Solo {latestYear}
                          </Button>
                        ) : null}
                        {(batchOptions?.years ?? []).map((y) => (
                          <Button key={y.year} size="sm" onClick={() => toggleYear(y.year)}>{y.year}</Button>
                        ))}
                        <Button size="sm" onClick={() => setSelectedPeriodCodes([])}>Limpiar</Button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '10px' }}>
                      {(batchOptions?.periods ?? []).map((p) => {
                        const checked = selectedPeriodCodes.includes(p.code);
                        return (
                          <label key={p.code} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${checked ? 'var(--primary)' : 'var(--line)'}`, background: checked ? 'rgba(27,58,107,0.04)' : '#fff', cursor: 'pointer', transition: 'all 130ms ease' }}>
                            <input type="checkbox" checked={checked} onChange={() => setSelectedPeriodCodes((curr) => toggleSelection(curr, p.code))} style={{ accentColor: 'var(--primary)', width: '16px', height: '16px' }} />
                            <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: checked ? 'var(--primary)' : 'var(--ink)' }}>{p.code}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label} · {p.courseCount} NRC</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Momentos */}
                  {(batchOptions?.moments ?? []).length > 0 ? (
                    <div style={{ marginTop: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <strong style={{ fontSize: '0.9rem' }}>Filtrar por momento</strong>
                        <Button size="sm" onClick={() => setSelectedMoments([])}>Todos</Button>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {(batchOptions?.moments ?? []).map((m) => {
                          const active = selectedMoments.includes(m.code);
                          return (
                            <Button key={m.code} variant={active ? 'primary' : 'secondary'} size="sm" onClick={() => setSelectedMoments((curr) => toggleSelection(curr, m.code))}>
                              {m.code} ({m.courseCount})
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {/* Resumen de Selección */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'var(--n-50)', borderRadius: '12px', marginTop: '20px', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ display: 'flex', gap: '24px' }}>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 700 }}>PERIODOS</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--primary)' }}>{selectedPeriodCodes.length}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 700 }}>NRC ESTIMADOS</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--primary)' }}>{selectedCourseCount.toLocaleString('es-CO')}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', fontWeight: 700 }}>TOTAL GLOBAL</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--muted)' }}>{totalCoursesAll.toLocaleString('es-CO')}</div>
                      </div>
                    </div>
                    <Button variant="secondary" onClick={previewDatabaseBatch} disabled={actionLoading || !selectedPeriodCodes.length || !!status?.runner.running}>
                      👁 Previsualizar lote
                    </Button>
                  </div>

                  {/* Previsualización generada */}
                  {batchPreview ? (
                    <div style={{ marginTop: '16px', border: '1px solid var(--line)', borderRadius: '12px', overflow: 'hidden' }}>
                      <div style={{ padding: '12px 16px', background: 'var(--n-50)', borderBottom: '1px solid var(--line)', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <StatusPill tone="neutral"><strong>{batchPreview.total}</strong> NRC en lote</StatusPill>
                        {Object.entries(batchPreview.byBannerStatus).slice(0, 5).map(([k, v]) => (
                          <StatusPill key={k} tone={resolveToneForStatus(k)}>{k}: {v}</StatusPill>
                        ))}
                      </div>
                      <div className="fast-table-wrapper">
                        <table className="fast-table">
                          <thead>
                            <tr>
                              <th>NRC</th>
                              <th>Periodo</th>
                              <th>Asignatura</th>
                              <th>Docente actual</th>
                              <th>Estado Banner</th>
                            </tr>
                          </thead>
                          <tbody>
                            {batchPreview.sample.map((item) => (
                              <tr key={`${item.courseId}-${item.nrc}`}>
                                <td><strong>{item.nrc}</strong></td>
                                <td>{item.periodCode}</td>
                                <td>{item.subjectName ?? '—'}</td>
                                <td style={{ color: item.teacherName ? 'inherit' : 'var(--muted)' }}>{item.teacherName ?? 'Sin docente'}</td>
                                <td><StatusPill tone={resolveToneForStatus(item.bannerReviewStatus)}>{item.bannerReviewStatus ?? 'SIN_DATO'}</StatusPill></td>
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
            <div className="forms-grid">
              <Field label="Query ID">
                <input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="Pega el Query ID" />
              </Field>
              <Field label="Workers">
                <input value={String(BANNER_STABLE_WORKERS)} readOnly />
              </Field>
            </div>
          ) : null}

          {/* MODO: EXPORT */}
          {mode === 'export' ? (
            <div className="forms-grid">
              <Field label="Query ID">
                <input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="Pega el Query ID" />
              </Field>
              <Field label="Formato">
                <input value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} placeholder="csv,json" />
              </Field>
            </div>
          ) : null}
        </div>

        {/* ACCIONES PRINCIPALES (BARRA INFERIOR GLASSMORFISMO) */}
        <div className="glass-actions-bar">
          {mode === 'batch' && batchInputMode === 'DATABASE' ? (
            <>
              <Button
                variant="primary"
                onClick={startBannerAndImport}
                disabled={!canStart || !selectedPeriodCodes.length}
              >
                ⚡ Buscar y actualizar base
              </Button>
              <Button
                variant="secondary"
                onClick={startBanner}
                disabled={!canStart || !selectedPeriodCodes.length}
              >
                Solo buscar en Banner
              </Button>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: 'auto', maxWidth: '380px', lineHeight: 1.4 }}>
                El primer botón ejecuta y sincroniza. El segundo solo realiza el scraping sin alterar la base de datos.
              </span>
            </>
          ) : (
            <Button variant="primary" onClick={startBanner} disabled={!canStart}>
              {actionLoading ? 'Procesando…' : START_BUTTON_LABELS[mode]}
            </Button>
          )}
        </div>
      </section>

      {/* SECCIÓN DE RESULTADOS */}
      <section className="premium-card">
        <div className="section-header">
          <h3>Último export Banner</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill tone="neutral"><strong>{exportTotal}</strong> filas</StatusPill>
            {Object.entries(statusCounts).slice(0, 4).map(([k, v]) => (
              <StatusPill key={k} tone={resolveToneForStatus(k)}>{k}: {v}</StatusPill>
            ))}
            <Button size="sm" onClick={loadFullResults} disabled={fullResultsLoading || !!status?.runner.running}>
              {fullResultsLoading ? 'Cargando…' : 'Cargar todos'}
            </Button>
            {fullResults !== null ? (
              <Button variant="ghost" size="sm" onClick={() => { setFullResults(null); setResultsPage(1); }}>
                Mostrar preview
              </Button>
            ) : null}
          </div>
        </div>

        <div className="fast-table-wrapper">
          <table className="fast-table">
            <thead>
              <tr>
                <th>NRC</th>
                <th>Periodo</th>
                <th>Docente</th>
                <th>ID</th>
                <th>Estado</th>
                <th>Inicio</th>
                <th>Cierre</th>
                <th>Revisado</th>
              </tr>
            </thead>
            <tbody>
              {pagedResults.length ? pagedResults.map((item) => (
                <tr key={`${item.queryId ?? 'sin'}-${item.nrc}`}>
                  <td><strong>{item.nrc}</strong></td>
                  <td>{item.period ?? '—'}</td>
                  <td style={{ color: item.teacherName ? 'inherit' : 'var(--muted)' }}>{item.teacherName ?? '—'}</td>
                  <td>{item.teacherId ?? '—'}</td>
                  <td><StatusPill tone={resolveToneForStatus(item.status)}>{item.status ?? '—'}</StatusPill></td>
                  <td>{item.startDate ?? '—'}</td>
                  <td>{item.endDate ?? '—'}</td>
                  <td>{item.checkedAt ? new Date(item.checkedAt).toLocaleDateString('es-CO') : '—'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: 'var(--muted)' }}>
                    {fullResults !== null ? 'Sin filas en el último export.' : 'Aún no hay exportación Banner disponible.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '0 20px 12px' }}>
          <PaginationControls
            currentPage={resultsPage}
            totalPages={totalResultPages}
            totalItems={activeResults.length}
            pageSize={resultsPageSize}
            onPageChange={setResultsPage}
            onPageSizeChange={(size) => { setResultsPageSize(size); setResultsPage(1); }}
            label="filas"
          />
        </div>
      </section>

      {/* SECCIÓN DE IMPORTACIÓN MANUAL */}
      <section className="premium-card" style={{ padding: '24px 32px' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 700 }}>Importar resultado a la base</h3>
        <div className="forms-grid">
          <Field label="Archivo (opcional — vacío usa el último export)">
            <input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="Ruta del archivo Banner" />
          </Field>
        </div>
        <div style={{ marginTop: '16px' }}>
          <Button variant="primary" onClick={importBannerResult} disabled={actionLoading || !!status?.runner.running}>
            ↓ Importar a la base
          </Button>
        </div>
        {importResult ? (
          <details style={{ marginTop: '16px', padding: '14px', background: 'var(--n-50)', borderRadius: '10px', border: '1px solid var(--line)' }}>
            <summary style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', cursor: 'pointer' }}>Resultado detallado</summary>
            <pre style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', background: '#0f172a', color: '#cbd5e1', padding: '12px', borderRadius: '8px', maxHeight: '200px', overflow: 'auto' }}>
              {JSON.stringify(importResult, null, 2)}
            </pre>
          </details>
        ) : null}
      </section>
    </div>
  );
}
