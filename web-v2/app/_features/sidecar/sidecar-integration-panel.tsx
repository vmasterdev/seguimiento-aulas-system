'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type SidecarRunCommand = 'classify' | 'revalidate' | 'backup' | 'attendance' | 'activity' | 'participants' | 'gui';
type RevalidateMode = 'sin_matricula' | 'aulas_vacias' | 'ambos';
type ClassifySourceMode = 'DATABASE' | 'MANUAL_INPUT';
type BackupSourceMode = 'DATABASE' | 'MANUAL_INPUT';
type SidecarBatchSource = 'PENDING' | 'SAMPLING' | 'ALL';

type SidecarStatus = {
  running: boolean;
  current: {
    id: string;
    command: SidecarRunCommand;
    status: string;
    startedAt: string;
    endedAt?: string;
    exitCode?: number | null;
    pid?: number;
    logPath: string;
    outputPath?: string;
  } | null;
  lastRun: {
    id: string;
    command: SidecarRunCommand;
    status: string;
    startedAt: string;
    endedAt?: string;
    exitCode?: number | null;
    pid?: number;
    logPath: string;
    outputPath?: string;
  } | null;
  logTail: string;
  artifactSummary?: SidecarArtifactSummary | null;
};

type SidecarConfigResponse = {
  projectRoot: string;
  configPath: string;
  config: {
    runtime?: {
      workers?: number;
      browser?: string;
      headless?: boolean;
      pythonCommand?: string;
    };
    paths?: Record<string, string>;
  };
};

type SidecarBatchOptions = {
  sources: Array<{ code: SidecarBatchSource; label: string }>;
  periods: Array<{ code: string; label: string; modality: string; courseCount: number }>;
  moments: string[];
  templates: Array<{ code: string; label: string; count: number }>;
};

type SidecarBatchPreview = {
  filters: {
    source?: SidecarBatchSource;
    mode?: RevalidateMode;
    periodCodes: string[];
    moments: string[];
    templates?: string[];
    nrcs?: string[];
    limit: number | null;
  };
  total: number;
  byPeriod: Record<string, number>;
  byMoment: Record<string, number>;
  byStatus: Record<string, number>;
  byTemplate: Record<string, number>;
  byModality?: Record<string, number>;
  sample: Array<{
    courseId: string;
    nrc: string;
    periodCode: string;
    periodLabel: string;
    moment: string;
    title: string;
    template: string;
    method?: string;
    status: string;
    sourceFile?: string;
    moodleCourseUrl?: string | null;
    moodleCourseId?: string | null;
    resolvedModality?: string | null;
  }>;
};

type SidecarArtifactSummary = {
  kind: 'attendance' | 'activity' | 'participants';
  startedAt: string;
  endedAt: string;
  outputDir: string;
  totalCourses: number;
  completedCourses: number;
  failedCourses: number;
  skippedCourses: number;
  files: Array<{
    kind: 'attendance' | 'activity' | 'participants';
    nrc: string;
    periodCode: string;
    title: string;
    label?: string;
    fileName: string;
    relativePath: string;
    csvRelativePath?: string;
    participants?: number;
  }>;
  items: Array<{
    courseId?: string | null;
    nrc: string;
    periodCode: string;
    title: string;
    status: string;
    message?: string | null;
    downloads?: Array<{
      fileName: string;
      relativePath: string;
      label?: string;
    }>;
  }>;
};

type MoodleFollowupKind = 'sin_matricula' | 'no_encontrado' | 'ambos';

type SidecarImportResult = {
  ok?: boolean;
  inputPath?: string;
  dryRun?: boolean;
  parsedRows?: number;
  processedRows?: number;
  updatedRows?: number;
  skippedRows?: number;
  skippedNoPeriod?: number;
  noMatch?: number;
  ambiguous?: number;
  before?: {
    totalNrc: number;
    urlsFinalResueltas: number;
    pendientes: number;
    tiposUtiles: number;
  };
  after?: {
    totalNrc: number;
    urlsFinalResueltas: number;
    pendientes: number;
    tiposUtiles: number;
  };
  statusBreakdown?: Record<string, number>;
  notes?: string[];
  changes?: Array<{
    courseId: string;
    nrc: string;
    periodCode: string;
    subjectName: string | null;
    previousStatus: string;
    nextStatus: string;
    previousTemplate: string;
    nextTemplate: string;
    previousUrl: string | null;
    nextUrl: string | null;
    changedStatus: boolean;
    changedTemplate: boolean;
    changedUrl: boolean;
  }>;
};

type MoodleFollowupResponse = {
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  filters: {
    kind: MoodleFollowupKind;
    periodCodes: string[];
    moments: string[];
  };
  byKind: Record<string, number>;
  byPeriod: Record<string, number>;
  byBannerStatus: Record<string, number>;
  items: Array<{
    id: string;
    nrc: string;
    subjectName: string | null;
    periodCode: string;
    periodLabel: string;
    moment: string | null;
    programCode: string | null;
    programName: string | null;
    teacherId: string | null;
    teacherName: string | null;
    moodleStatus: string | null;
    moodleErrorCode: string | null;
    moodleNotes: string | null;
    moodleCourseUrl: string | null;
    moodleCourseId: string | null;
    bannerReviewStatus: string | null;
    followupKind: Exclude<MoodleFollowupKind, 'ambos'>;
    canSendToBanner: boolean;
    canDeactivate: boolean;
  }>;
};

type BannerActionResponse = {
  ok: boolean;
  action: string;
  result?: {
    batch?: {
      total?: number;
    };
  };
};

type SidecarIntegrationPanelProps = {
  apiBase: string;
};

const COMMAND_LABELS: Record<SidecarRunCommand, string> = {
  classify: 'Clasificar aulas desde Moodle',
  revalidate: 'Revalidar resultados anteriores',
  backup: 'Descargar respaldo de cursos',
  attendance: 'Descargar asistencias de Moodle',
  activity: 'Descargar actividad del curso',
  participants: 'Descargar participantes y roles',
  gui: 'Abrir la interfaz manual del sidecar',
};

const COMMAND_HELP: Record<SidecarRunCommand, string> = {
  classify:
    'Usa esta opcion para revisar muchos NRC, detectar el tipo de aula y generar el archivo final de clasificacion.',
  revalidate:
    'Sirve para volver a revisar cursos especiales, por ejemplo aulas vacias o registros sin matricula.',
  backup:
    'Descarga evidencias o respaldos de los NRC que indiques en un archivo CSV.',
  attendance:
    'Entra a las aulas con URL Moodle resuelta, localiza el modulo Asistencia y descarga su export XLSX.',
  activity:
    'Abre el reporte de actividad/logs del curso y descarga el CSV para auditoria o analisis posterior.',
  participants:
    'Abre la pagina de participantes del curso, toma el listado visible y guarda nombres, correos y roles para analitica.',
  gui: 'Abre el sidecar en modo manual cuando necesites trabajar directamente sobre la herramienta original.',
};

const START_BUTTON_LABELS: Record<SidecarRunCommand, string> = {
  classify: 'Iniciar revision automatica',
  revalidate: 'Iniciar revalidacion',
  backup: 'Iniciar respaldo',
  attendance: 'Descargar asistencias',
  activity: 'Descargar actividad',
  participants: 'Descargar participantes',
  gui: 'Abrir interfaz manual',
};

const BATCH_SOURCE_HELP: Record<SidecarBatchSource, string> = {
  ALL: 'Incluye todos los cursos elegibles de los periodos seleccionados.',
  SAMPLING: 'Incluye solo cursos que ya hacen parte del muestreo del sistema.',
  PENDING: 'Incluye solo cursos que siguen pendientes por clasificacion.',
};

const RECOMMENDED_FLOW_HINTS = [
  'Pendientes reales de tipo de aula: usa "Clasificar aulas desde Moodle" con fuente BD y lote PENDING.',
  'Aulas vacias o casos sin matricula/no registrado: usa "Revalidar resultados anteriores", no "Clasificar".',
  'Si quieres volver a revisar aulas vacias con estudiantes aunque ya no esten pendientes: usa "Clasificar" con lote ALL y, si quieres, filtra por tipo VACIO.',
  'Si ya tienes URL Moodle resuelta y quieres evidencia del curso: usa "Descargar asistencias", "Descargar actividad del curso" o "Descargar participantes y roles".',
];

const ARTIFACT_KIND_LABELS: Record<SidecarArtifactSummary['kind'], string> = {
  attendance: 'asistencia',
  activity: 'actividad',
  participants: 'participantes',
};

function buildEmptyExtractionMessage(command: 'attendance' | 'activity' | 'participants') {
  if (command === 'attendance') {
    return 'No hay cursos con URL Moodle resuelta para exportar asistencias con esos filtros.';
  }
  if (command === 'participants') {
    return 'No hay cursos con URL Moodle resuelta para extraer participantes con esos filtros.';
  }
  return 'No hay cursos con URL Moodle resuelta para exportar actividad con esos filtros.';
}

function toggleSelection(current: string[], value: string) {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function parseManualNrcList(value: string) {
  return unique(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function escapeCsv(value: string | null | undefined) {
  const text = String(value ?? '');
  if (!/[",;\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function parseDownloadName(disposition: string | null) {
  if (!disposition) return null;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const plainMatch = disposition.match(/filename="([^"]+)"/i) ?? disposition.match(/filename=([^;]+)/i);
  if (!plainMatch?.[1]) return null;
  return plainMatch[1].trim();
}

function parseStartMessage(result: unknown) {
  if (!result || typeof result !== 'object') return 'Ejecucion sidecar iniciada.';
  const payload = result as Record<string, unknown>;
  const batch = payload.batch as Record<string, unknown> | undefined;
  if (batch && typeof batch.total === 'number') {
    return `Ejecucion sidecar iniciada con lote BD (${batch.total} NRC).`;
  }
  return 'Ejecucion sidecar iniciada.';
}

function buildArtifactDownloadHref(apiBase: string, relativePath: string) {
  return `${apiBase}/integrations/moodle-sidecar/run/download?path=${encodeURIComponent(relativePath)}`;
}

function buildEmptyBatchMessage(source: SidecarBatchSource, action: 'classify' | 'backup') {
  const base =
    action === 'backup'
      ? 'El lote esta vacio. No hay NRC elegibles para descargar respaldo con esos filtros.'
      : 'El lote esta vacio. No hay NRC elegibles para iniciar la revision con esos filtros.';
  if (source === 'PENDING') {
    return `${base} En PENDING no entran cursos sin acceso, no matriculado o vacio sin estudiantes.`;
  }
  return base;
}

function buildEmptyRevalidateMessage(mode: RevalidateMode) {
  if (mode === 'aulas_vacias') {
    return 'No hay cursos con tipo de aula VACIO en los periodos y momentos seleccionados.';
  }
  if (mode === 'sin_matricula') {
    return 'No hay cursos marcados como sin matricula/no registrado en los periodos y momentos seleccionados.';
  }
  return 'No hay cursos para revalidar con los filtros seleccionados.';
}

export default function SidecarIntegrationPanel({ apiBase }: SidecarIntegrationPanelProps) {
  const [config, setConfig] = useState<SidecarConfigResponse | null>(null);
  const [status, setStatus] = useState<SidecarStatus | null>(null);
  const [batchOptions, setBatchOptions] = useState<SidecarBatchOptions | null>(null);
  const [batchPreview, setBatchPreview] = useState<SidecarBatchPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [command, setCommand] = useState<SidecarRunCommand>('classify');
  const [workers, setWorkers] = useState('4');
  const [browser, setBrowser] = useState<'edge' | 'chrome'>('chrome');
  const [headless, setHeadless] = useState(false);
  const [noResume, setNoResume] = useState(false);
  const [preloginAllModalities, setPreloginAllModalities] = useState(true);
  const [mode, setMode] = useState<RevalidateMode>('ambos');
  const [classifySourceMode, setClassifySourceMode] = useState<ClassifySourceMode>('DATABASE');
  const [backupSourceMode, setBackupSourceMode] = useState<BackupSourceMode>('DATABASE');
  const [batchSource, setBatchSource] = useState<SidecarBatchSource>('ALL');
  const [selectedPeriodCodes, setSelectedPeriodCodes] = useState<string[]>([]);
  const [selectedMoments, setSelectedMoments] = useState<string[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [inputDir, setInputDir] = useState('');
  const [output, setOutput] = useState('');
  const [nrcCsv, setNrcCsv] = useState('');
  const [manualExtractNrcs, setManualExtractNrcs] = useState('');
  const [loginWaitSeconds, setLoginWaitSeconds] = useState('300');
  const [backupTimeout, setBackupTimeout] = useState('240');
  const [keepOpen, setKeepOpen] = useState(false);
  const [python, setPython] = useState('');

  const [importPath, setImportPath] = useState('');
  const [importDryRun, setImportDryRun] = useState(false);
  const [importSource, setImportSource] = useState('ui-sidecar');
  const [importResult, setImportResult] = useState<SidecarImportResult | null>(null);
  const [followupKind, setFollowupKind] = useState<MoodleFollowupKind>('ambos');
  const [followupData, setFollowupData] = useState<MoodleFollowupResponse | null>(null);
  const [selectedFollowupIds, setSelectedFollowupIds] = useState<string[]>([]);
  const [followupQueryName, setFollowupQueryName] = useState('moodle-followup');
  const [deactivateReason, setDeactivateReason] = useState(
    'NRC desactivado luego de no encontrarse en Moodle ni en Banner.',
  );

  const canStart = useMemo(() => !status?.running && !actionLoading, [status?.running, actionLoading]);
  const hasBatchSelection = selectedPeriodCodes.length > 0;
  const currentCommandLabel = COMMAND_LABELS[command];
  const currentCommandHelp = COMMAND_HELP[command];
  const startButtonLabel = START_BUTTON_LABELS[command];
  const followupItems = followupData?.items ?? [];
  const selectedBannerFollowupIds = useMemo(
    () =>
      followupItems
        .filter((item) => selectedFollowupIds.includes(item.id) && item.canSendToBanner)
        .map((item) => item.id),
    [followupItems, selectedFollowupIds],
  );
  const selectedDeletableFollowupIds = useMemo(
    () =>
      followupItems
        .filter((item) => selectedFollowupIds.includes(item.id) && item.canDeactivate)
        .map((item) => item.id),
    [followupItems, selectedFollowupIds],
  );
  const selectedAuditorFollowupItems = useMemo(
    () => followupItems.filter((item) => selectedFollowupIds.includes(item.id) && item.followupKind === 'sin_matricula'),
    [followupItems, selectedFollowupIds],
  );
  const visibleAuditorFollowupItems = useMemo(
    () => followupItems.filter((item) => item.followupKind === 'sin_matricula'),
    [followupItems],
  );
  const auditorTemplateItems = useMemo(
    () => (selectedAuditorFollowupItems.length ? selectedAuditorFollowupItems : visibleAuditorFollowupItems),
    [selectedAuditorFollowupItems, visibleAuditorFollowupItems],
  );
  const lastRun = status?.lastRun ?? null;
  const manualExtractNrcList = useMemo(() => parseManualNrcList(manualExtractNrcs), [manualExtractNrcs]);

  async function loadAll() {
    try {
      setLoading(true);
      setMessage('');
      const [cfg, st, options] = await Promise.all([
        fetchJson<SidecarConfigResponse>(`${apiBase}/integrations/moodle-sidecar/config`),
        fetchJson<SidecarStatus>(`${apiBase}/integrations/moodle-sidecar/run/status`),
        fetchJson<SidecarBatchOptions>(`${apiBase}/integrations/moodle-sidecar/run/batch/options`),
      ]);
      setConfig(cfg);
      setStatus(st);
      setBatchOptions(options);

      if (!python && cfg.config?.runtime?.pythonCommand) {
        setPython(String(cfg.config.runtime.pythonCommand));
      }
      if ((!workers || workers === '4') && cfg.config?.runtime?.workers) {
        setWorkers(String(Math.max(1, Number(cfg.config.runtime.workers))));
      }
      if (cfg.config?.runtime?.browser) {
        const runtimeBrowser = String(cfg.config?.runtime?.browser).trim().toLowerCase();
        if (runtimeBrowser === 'edge' || runtimeBrowser === 'chrome') {
          setBrowser(runtimeBrowser);
        }
      }
      if (!selectedPeriodCodes.length && options.periods.length) {
        setSelectedPeriodCodes([options.periods[0].code]);
      }
    } catch (error) {
      setMessage(`No se pudo cargar sidecar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    setBatchPreview(null);
  }, [command, mode, batchSource, selectedPeriodCodes, selectedMoments, selectedTemplates, classifySourceMode, backupSourceMode]);

  useEffect(() => {
    setFollowupData(null);
    setSelectedFollowupIds([]);
  }, [followupKind, selectedPeriodCodes, selectedMoments]);

  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(() => {
      void fetchJson<SidecarStatus>(`${apiBase}/integrations/moodle-sidecar/run/status`)
        .then(setStatus)
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(id);
  }, [status?.running, apiBase]);

  async function previewBatch() {
    if (!hasBatchSelection) {
      setMessage('Selecciona al menos un periodo para armar el lote desde la BD.');
      return;
    }
    try {
      setActionLoading(true);
      setMessage('');
      const result =
        command === 'revalidate'
          ? await fetchJson<SidecarBatchPreview>(`${apiBase}/integrations/moodle-sidecar/run/revalidate/preview`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode,
                periodCodes: selectedPeriodCodes,
                moments: selectedMoments.length ? selectedMoments : undefined,
              }),
            })
          : command === 'attendance' || command === 'activity' || command === 'participants'
          ? await fetchJson<SidecarBatchPreview>(`${apiBase}/integrations/moodle-sidecar/run/extract/preview`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source: batchSource,
                periodCodes: selectedPeriodCodes,
                moments: selectedMoments.length ? selectedMoments : undefined,
                templates: selectedTemplates.length ? selectedTemplates : undefined,
                nrcs: manualExtractNrcList.length ? manualExtractNrcList : undefined,
              }),
            })
          : await fetchJson<SidecarBatchPreview>(`${apiBase}/integrations/moodle-sidecar/run/batch/preview`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source: batchSource,
                periodCodes: selectedPeriodCodes,
                moments: selectedMoments.length ? selectedMoments : undefined,
                templates: selectedTemplates.length ? selectedTemplates : undefined,
              }),
            });
      setBatchPreview(result);
      if (result.total === 0) {
        setMessage(
          command === 'revalidate'
            ? buildEmptyRevalidateMessage(mode)
            : command === 'attendance' || command === 'activity' || command === 'participants'
              ? buildEmptyExtractionMessage(command)
              : buildEmptyBatchMessage(batchSource, command === 'backup' ? 'backup' : 'classify'),
        );
      } else {
        setMessage(`Preview listo: ${result.total} NRC en el lote.`);
      }
    } catch (error) {
      setMessage(`No fue posible previsualizar el lote: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function startRun() {
    try {
      setActionLoading(true);
      setMessage('');

      if (command === 'classify' && classifySourceMode === 'DATABASE') {
        if (!hasBatchSelection) {
          setMessage('Selecciona al menos un periodo para ejecutar classify desde la BD.');
          return;
        }
        if (batchPreview && batchPreview.total === 0) {
          setMessage(buildEmptyBatchMessage(batchSource, 'classify'));
          return;
        }

        const body: Record<string, unknown> = {
          source: batchSource,
          periodCodes: selectedPeriodCodes,
          preloginAllModalities,
        };
        if (selectedMoments.length) body.moments = selectedMoments;
        if (selectedTemplates.length) body.templates = selectedTemplates;
        if (workers.trim()) body.workers = Number(workers);
        if (browser) body.browser = browser;
        if (headless) body.headless = true;
        if (python.trim()) body.python = python.trim();
        if (output.trim()) body.output = output.trim();
        if (noResume) body.noResume = true;

        const result = await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/start-from-db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setMessage(parseStartMessage(result));
      } else if (command === 'revalidate') {
        if (!hasBatchSelection) {
          setMessage('Selecciona al menos un periodo para ejecutar la revalidacion desde la BD.');
          return;
        }
        if (batchPreview && batchPreview.total === 0) {
          setMessage(buildEmptyRevalidateMessage(mode));
          return;
        }

        const body: Record<string, unknown> = {
          mode,
          periodCodes: selectedPeriodCodes,
        };
        if (selectedMoments.length) body.moments = selectedMoments;
        if (workers.trim()) body.workers = Number(workers);
        if (browser) body.browser = browser;
        if (headless) body.headless = true;
        if (python.trim()) body.python = python.trim();
        if (output.trim()) body.output = output.trim();

        const result = await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/start-revalidate-from-db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setMessage(parseStartMessage(result));
      } else if (command === 'backup' && backupSourceMode === 'DATABASE') {
        if (!hasBatchSelection) {
          setMessage('Selecciona al menos un periodo para ejecutar backups desde la BD.');
          return;
        }
        if (batchPreview && batchPreview.total === 0) {
          setMessage(buildEmptyBatchMessage(batchSource, 'backup'));
          return;
        }

        const body: Record<string, unknown> = {
          source: batchSource,
          periodCodes: selectedPeriodCodes,
        };
        if (selectedMoments.length) body.moments = selectedMoments;
        if (selectedTemplates.length) body.templates = selectedTemplates;
        if (python.trim()) body.python = python.trim();
        if (loginWaitSeconds.trim()) body.loginWaitSeconds = Number(loginWaitSeconds);
        if (backupTimeout.trim()) body.backupTimeout = Number(backupTimeout);
        if (keepOpen) body.keepOpen = true;

        const result = await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/start-backup-from-db`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setMessage(parseStartMessage(result));
      } else if (command === 'attendance' || command === 'activity' || command === 'participants') {
        if (!hasBatchSelection) {
          setMessage('Selecciona al menos un periodo para preparar la exportacion desde la BD.');
          return;
        }
        if (batchPreview && batchPreview.total === 0) {
          setMessage(buildEmptyExtractionMessage(command));
          return;
        }

        const body: Record<string, unknown> = {
          source: batchSource,
          periodCodes: selectedPeriodCodes,
        };
        if (selectedMoments.length) body.moments = selectedMoments;
        if (selectedTemplates.length) body.templates = selectedTemplates;
        if (manualExtractNrcList.length) body.nrcs = manualExtractNrcList;
        if (browser) body.browser = browser;
        if (headless) body.headless = true;
        if (python.trim()) body.python = python.trim();
        if (loginWaitSeconds.trim()) body.loginWaitSeconds = Number(loginWaitSeconds);
        if (keepOpen) body.keepOpen = true;

        const route =
          command === 'attendance'
            ? `${apiBase}/integrations/moodle-sidecar/run/start-attendance-from-db`
            : command === 'activity'
              ? `${apiBase}/integrations/moodle-sidecar/run/start-activity-from-db`
              : `${apiBase}/integrations/moodle-sidecar/run/start-participants-from-db`;

        const result = await fetchJson(route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setMessage(parseStartMessage(result));
      } else {
        const body: Record<string, unknown> = {
          command,
        };
        if (workers.trim()) body.workers = Number(workers);
        if (browser) body.browser = browser;
        if (headless) body.headless = true;
        if (python.trim()) body.python = python.trim();
        if (command === 'classify') {
          if (inputDir.trim()) body.inputDir = inputDir.trim();
          if (output.trim()) body.output = output.trim();
          if (noResume) body.noResume = true;
          if (preloginAllModalities) body.preloginAllModalities = true;
        }
        if (command === 'backup' && nrcCsv.trim()) {
          body.nrcCsv = nrcCsv.trim();
        }
        if (command === 'backup' && loginWaitSeconds.trim()) {
          body.loginWaitSeconds = Number(loginWaitSeconds);
        }
        if (command === 'backup' && backupTimeout.trim()) {
          body.backupTimeout = Number(backupTimeout);
        }
        if (command === 'backup' && keepOpen) {
          body.keepOpen = true;
        }

        await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setMessage('Ejecucion sidecar iniciada.');
      }

      const st = await fetchJson<SidecarStatus>(`${apiBase}/integrations/moodle-sidecar/run/status`);
      setStatus(st);
    } catch (error) {
      setMessage(`No se pudo iniciar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelRun() {
    try {
      setActionLoading(true);
      setMessage('');
      await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/cancel`, {
        method: 'POST',
      });
      setMessage('Cancelacion enviada.');
      const st = await fetchJson<SidecarStatus>(`${apiBase}/integrations/moodle-sidecar/run/status`);
      setStatus(st);
    } catch (error) {
      setMessage(`No se pudo cancelar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function importToSystem() {
    try {
      setActionLoading(true);
      setMessage('');
      const body: Record<string, unknown> = {
        dryRun: importDryRun,
      };
      if (importPath.trim()) body.inputPath = importPath.trim();
      if (importSource.trim()) body.sourceLabel = importSource.trim();
      const result = await fetchJson(`${apiBase}/integrations/moodle-sidecar/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setImportResult(result as SidecarImportResult);
      setMessage('Importacion sidecar completada.');
    } catch (error) {
      setMessage(`No se pudo importar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function previewRevalidateMode(nextMode: RevalidateMode) {
    if (!hasBatchSelection) {
      setMessage('Selecciona al menos un periodo y, si quieres, los momentos antes de revisar estos casos.');
      return;
    }

    try {
      setActionLoading(true);
      setMessage('');
      setCommand('revalidate');
      setMode(nextMode);
      const result = await fetchJson<SidecarBatchPreview>(`${apiBase}/integrations/moodle-sidecar/run/revalidate/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: nextMode,
          periodCodes: selectedPeriodCodes,
          moments: selectedMoments.length ? selectedMoments : undefined,
        }),
      });
      setBatchPreview(result);
      if (result.total === 0) {
        setMessage(buildEmptyRevalidateMessage(nextMode));
      } else {
        setMessage(`Preview listo: ${result.total} NRC para ${nextMode === 'aulas_vacias' ? 'aulas vacias' : nextMode === 'sin_matricula' ? 'sin matricula/no registrado' : 'revalidacion mixta'}.`);
      }
    } catch (error) {
      setMessage(`No fue posible previsualizar la revalidacion: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function loadFollowupCases(kindOverride: MoodleFollowupKind = followupKind) {
    try {
      setActionLoading(true);
      setMessage('');
      const params = new URLSearchParams({
        kind: kindOverride,
        limit: '5000',
      });
      if (selectedPeriodCodes.length) params.set('periodCodes', selectedPeriodCodes.join(','));
      if (selectedMoments.length) params.set('moments', selectedMoments.join(','));

      const result = await fetchJson<MoodleFollowupResponse>(`${apiBase}/courses/moodle-followup/list?${params.toString()}`);
      setFollowupKind(kindOverride);
      setFollowupData(result);
      setSelectedFollowupIds([]);
      setMessage(`Lista cargada: ${result.total} NRC en seguimiento.`);
    } catch (error) {
      setMessage(`No se pudo cargar la lista de seguimiento: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  function exportFollowupCsv() {
    if (!followupItems.length) {
      setMessage('Carga primero la lista de seguimiento para poder descargarla.');
      return;
    }

    const rows = [
      [
        'tipo_caso',
        'nrc',
        'asignatura',
        'periodo',
        'momento',
        'programa',
        'docente',
        'estado_moodle',
        'error_moodle',
        'estado_banner',
        'notas_moodle',
      ].join(','),
      ...followupItems.map((item) =>
        [
          escapeCsv(item.followupKind),
          escapeCsv(item.nrc),
          escapeCsv(item.subjectName),
          escapeCsv(item.periodCode),
          escapeCsv(item.moment),
          escapeCsv(item.programName),
          escapeCsv(item.teacherName),
          escapeCsv(item.moodleStatus),
          escapeCsv(item.moodleErrorCode),
          escapeCsv(item.bannerReviewStatus),
          escapeCsv(item.moodleNotes),
        ].join(','),
      ),
    ];

    const blob = new Blob([`${rows.join('\n')}\n`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `moodle_followup_${followupKind}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    setMessage('CSV descargado.');
  }

  async function downloadAuditorTemplate() {
    const rows = selectedAuditorFollowupItems.length ? selectedAuditorFollowupItems : visibleAuditorFollowupItems;
    if (!rows.length) {
      setMessage('No hay NRC sin matricula visibles para generar el formato oficial.');
      return;
    }

    try {
      setActionLoading(true);
      setMessage('');
      const response = await fetch('/api/moodle/auditor-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });

      if (!response.ok) {
        let detail = 'No se pudo generar el formato oficial.';
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload?.error) detail = payload.error;
        } catch {
          const text = await response.text();
          if (text.trim()) detail = text.trim();
        }
        throw new Error(detail);
      }

      const blob = await response.blob();
      const filename =
        parseDownloadName(response.headers.get('content-disposition')) ??
        response.headers.get('x-auditor-output-name') ??
        `FORMATO_AUDITOR_MOODLE_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const rowCount = Number(response.headers.get('x-auditor-row-count') ?? rows.length);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`Formato oficial generado con ${rowCount} NRC sin matricula.`);
    } catch (error) {
      setMessage(`No se pudo descargar el formato oficial: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function sendNotFoundToBanner() {
    const courseIds = selectedBannerFollowupIds.length
      ? selectedBannerFollowupIds
      : followupItems.filter((item) => item.canSendToBanner).map((item) => item.id);
    if (!courseIds.length) {
      setMessage('No hay NRC no encontrados en Moodle para enviar a Banner.');
      return;
    }

    try {
      setActionLoading(true);
      setMessage('');
      const response = await fetchJson<BannerActionResponse>('/api/banner/followup/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseIds,
          queryName: followupQueryName.trim() || undefined,
          workers: Number(workers) || 1,
        }),
      });
      const total = response.result?.batch?.total;
      setMessage(
        typeof total === 'number'
          ? `Banner iniciado con ${total} NRC no encontrados en Moodle.`
          : 'Banner iniciado para revisar los NRC no encontrados en Moodle.',
      );
    } catch (error) {
      setMessage(`No se pudo iniciar Banner desde seguimiento: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function importLatestBannerResult() {
    try {
      setActionLoading(true);
      setMessage('');
      await fetchJson<BannerActionResponse>('/api/banner/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          payload: {},
        }),
      });
      await loadFollowupCases();
      setMessage('Resultado Banner importado y lista actualizada.');
    } catch (error) {
      setMessage(
        `No se pudo importar el ultimo resultado de Banner: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function deactivateFollowupCourses() {
    const courseIds = selectedDeletableFollowupIds.length
      ? selectedDeletableFollowupIds
      : followupItems.filter((item) => item.canDeactivate).map((item) => item.id);
    if (!courseIds.length) {
      setMessage('No hay NRC listos para desactivar. Solo se permiten los no encontrados en Moodle y tambien en Banner.');
      return;
    }

    const confirmed = window.confirm(
      `Se van a desactivar ${courseIds.length} NRC. Esta accion los marca como descartados y ajusta muestreo/replicas si aplica. ¿Deseas continuar?`,
    );
    if (!confirmed) return;

    try {
      setActionLoading(true);
      setMessage('');
      const result = await fetchJson<{
        ok: boolean;
        deactivated: number;
        failed: number;
      }>(`${apiBase}/courses/deactivate-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseIds,
          reason: deactivateReason.trim() || undefined,
          confirm: true,
        }),
      });
      await loadFollowupCases();
      setMessage(`Desactivacion completada: ${result.deactivated} NRC desactivados, ${result.failed} fallidos.`);
    } catch (error) {
      setMessage(`No se pudo desactivar el lote: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <article className="panel">
      <h2>Automatizacion Moodle</h2>
      <div className="actions">
        Esta pantalla sirve para revisar aulas de Moodle en lote, seguir el avance del proceso y guardar el resultado
        en la base del sistema.
        <br />
        La ruta recomendada es usar <span className="code">Base de datos del sistema</span> para que no dependas de
        carpetas manuales. Para ejecucion visible, <span className="code">4 workers</span> es el punto recomendado.
      </div>

      <div className="controls" style={{ marginTop: 8 }}>
        <button onClick={loadAll} disabled={loading || actionLoading}>
          {loading ? 'Actualizando...' : 'Actualizar estado del proceso'}
        </button>
      </div>

      <div className="actions" style={{ marginTop: 6 }}>
        <span className="code">Archivo de configuracion: {config?.configPath ?? 'N/A'}</span>
      </div>
      <div className="badges" style={{ marginTop: 8 }}>
        <span className="badge">Proceso en curso: {status?.running ? 'SI' : 'NO'}</span>
        {status?.current ? <span className="badge">Tarea actual: {COMMAND_LABELS[status.current.command]}</span> : null}
        {status?.lastRun ? <span className="badge">Ultima tarea: {COMMAND_LABELS[status.lastRun.command]}</span> : null}
      </div>
      {lastRun ? (
        <div className="actions" style={{ marginTop: 8 }}>
          <strong>Ultima corrida:</strong> {COMMAND_LABELS[lastRun.command]} | {lastRun.status}
          {lastRun.startedAt ? ` | inicio ${lastRun.startedAt}` : ''}
          {lastRun.endedAt ? ` | fin ${lastRun.endedAt}` : ''}
          {typeof lastRun.exitCode === 'number' ? ` | exit ${lastRun.exitCode}` : ''}
        </div>
      ) : null}
      {lastRun?.logPath ? (
        <div className="actions" style={{ marginTop: 6 }}>
          <span className="code">Log mas reciente: {lastRun.logPath}</span>
        </div>
      ) : null}

      <div className="subtitle">Paso 1. Elegir la tarea</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
          marginBottom: 12,
        }}
      >
        {(['classify', 'revalidate', 'backup', 'attendance', 'activity', 'participants', 'gui'] as SidecarRunCommand[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCommand(option)}
            disabled={actionLoading}
            style={{
              textAlign: 'left',
              border: option === command ? '2px solid #0057A4' : '1px solid #c8d6e5',
              background: option === command ? '#eef5ff' : '#fff',
              color: '#16324f',
              borderRadius: 12,
              padding: '12px 14px',
            }}
          >
            <strong>{COMMAND_LABELS[option]}</strong>
            <br />
            <span style={{ fontSize: 13, opacity: 0.9 }}>{COMMAND_HELP[option]}</span>
          </button>
        ))}
      </div>
      <div className="controls">
        <label>
          Tarea a ejecutar
          <select value={command} onChange={(event) => setCommand(event.target.value as SidecarRunCommand)}>
            <option value="classify">{COMMAND_LABELS.classify}</option>
            <option value="revalidate">{COMMAND_LABELS.revalidate}</option>
            <option value="backup">{COMMAND_LABELS.backup}</option>
            <option value="attendance">{COMMAND_LABELS.attendance}</option>
            <option value="activity">{COMMAND_LABELS.activity}</option>
            <option value="participants">{COMMAND_LABELS.participants}</option>
            <option value="gui">{COMMAND_LABELS.gui}</option>
          </select>
        </label>
        {command === 'attendance' || command === 'activity' || command === 'participants' ? null : (
          <label>
            Cantidad de workers
            <input value={workers} onChange={(event) => setWorkers(event.target.value)} placeholder="4" />
          </label>
        )}
        <label>
          Navegador
          <select value={browser} onChange={(event) => setBrowser(event.target.value as 'edge' | 'chrome')}>
            <option value="edge">Microsoft Edge</option>
            <option value="chrome">Google Chrome</option>
          </select>
        </label>
        <label>
          Comando de Python
          <input value={python} onChange={(event) => setPython(event.target.value)} placeholder="python3" />
        </label>
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <strong>{currentCommandLabel}:</strong> {currentCommandHelp}
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        <strong>Ruta recomendada segun el caso:</strong>
        <br />
        1. {RECOMMENDED_FLOW_HINTS[0]}
        <br />
        2. {RECOMMENDED_FLOW_HINTS[1]}
        <br />
        3. {RECOMMENDED_FLOW_HINTS[2]}
        <br />
        4. {RECOMMENDED_FLOW_HINTS[3]}
      </div>

      <div className="subtitle" style={{ marginTop: 12 }}>Atajos frecuentes</div>
      <div className="actions">
        Si tu objetivo es revisar casos especiales, no cambies mas de lo necesario: selecciona periodos y momentos, y usa uno de estos atajos.
      </div>
      <div className="controls" style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={() => {
            setCommand('revalidate');
            setMode('aulas_vacias');
          }}
          disabled={actionLoading}
        >
          Ir a aulas vacias
        </button>
        <button
          type="button"
          onClick={() => {
            setCommand('revalidate');
            setMode('sin_matricula');
            setFollowupKind('sin_matricula');
          }}
          disabled={actionLoading}
        >
          Ir a no registrado
        </button>
        <button
          type="button"
          onClick={() => {
            setCommand('revalidate');
            setMode('ambos');
            setFollowupKind('ambos');
          }}
          disabled={actionLoading}
        >
          Ir a ambos casos
        </button>
      </div>

      {command === 'classify' ? (
        <>
          <div className="controls" style={{ marginTop: 8 }}>
            <label>
              Fuente de los NRC a revisar
              <select
                value={classifySourceMode}
                onChange={(event) => setClassifySourceMode(event.target.value as ClassifySourceMode)}
              >
                <option value="DATABASE">Base de datos del sistema (recomendado)</option>
                <option value="MANUAL_INPUT">Carpeta manual de archivos RPACA</option>
              </select>
            </label>
            <label style={{ minWidth: 340 }}>
              Archivo de salida (opcional)
              <input
                value={output}
                onChange={(event) => setOutput(event.target.value)}
                placeholder="storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE.xlsx"
              />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} />
              <span>Ejecutar sin abrir ventanas</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={noResume} onChange={(event) => setNoResume(event.target.checked)} />
              <span>No reutilizar progreso anterior</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preloginAllModalities}
                onChange={(event) => setPreloginAllModalities(event.target.checked)}
              />
              <span>Intentar iniciar sesion en todas las modalidades</span>
            </label>
          </div>

          {classifySourceMode === 'DATABASE' ? (
            <>
              <div className="subtitle" style={{ marginTop: 10 }}>
                Paso 2. Armar el lote desde la base de datos
              </div>
              <div className="controls">
                <label>
                  Fuente del lote
                  <select
                    value={batchSource}
                    onChange={(event) => setBatchSource(event.target.value as SidecarBatchSource)}
                  >
                    {(batchOptions?.sources ?? []).map((source) => (
                      <option key={source.code} value={source.code}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                {BATCH_SOURCE_HELP[batchSource]}
                <br />
                Selecciona los periodos y, si aplica, los momentos. El sistema arma un archivo temporal y luego lo
                envia al motor de revision.
              </div>

              <div className="subtitle" style={{ marginTop: 10 }}>
                Periodos a revisar
              </div>
              <div className="controls">
                <button
                  type="button"
                  onClick={() => setSelectedPeriodCodes((batchOptions?.periods ?? []).map((period) => period.code))}
                  disabled={actionLoading}
                >
                  Marcar todos los periodos
                </button>
                <button type="button" onClick={() => setSelectedPeriodCodes([])} disabled={actionLoading}>
                  Limpiar seleccion
                </button>
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {(batchOptions?.periods ?? []).map((period) => (
                  <label className="badge badge-selector" key={period.code}>
                    <input
                      type="checkbox"
                      checked={selectedPeriodCodes.includes(period.code)}
                      onChange={() => setSelectedPeriodCodes((current) => toggleSelection(current, period.code))}
                    />
                    <span>
                      {period.code} | {period.label} ({period.courseCount})
                    </span>
                  </label>
                ))}
              </div>

              <div className="subtitle" style={{ marginTop: 10 }}>
                Momentos a revisar
              </div>
              <div className="controls">
                <button
                  type="button"
                  onClick={() => setSelectedMoments(batchOptions?.moments ?? [])}
                  disabled={actionLoading}
                >
                  Marcar todos los momentos
                </button>
                <button type="button" onClick={() => setSelectedMoments([])} disabled={actionLoading}>
                  Usar todos los momentos
                </button>
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {(batchOptions?.moments ?? []).map((moment) => (
                  <label className="badge badge-selector" key={moment}>
                    <input
                      type="checkbox"
                      checked={selectedMoments.includes(moment)}
                      onChange={() => setSelectedMoments((current) => toggleSelection(current, moment))}
                    />
                    <span>{moment}</span>
                  </label>
                ))}
              </div>

              <div className="controls" style={{ marginTop: 10 }}>
                <button type="button" onClick={previewBatch} disabled={actionLoading || !hasBatchSelection || !!status?.running}>
                  {actionLoading ? 'Procesando...' : 'Previsualizar cursos a revisar'}
                </button>
              </div>

              {batchPreview ? (
                <>
                  <div className="subtitle" style={{ marginTop: 10 }}>
                    Resumen del lote
                  </div>
                  <div className="badges" style={{ marginTop: 10 }}>
                    <span className="badge">Total lote: {batchPreview.total}</span>
                    <span className="badge">Fuente: {batchPreview.filters.source}</span>
                    <span className="badge">
                      Momentos: {batchPreview.filters.moments.length ? batchPreview.filters.moments.join(', ') : 'todos'}
                    </span>
                    <span className="badge">
                      Tipos: {batchPreview.filters.templates?.length ? batchPreview.filters.templates.join(', ') : 'todos'}
                    </span>
                  </div>
                  <div className="badges" style={{ marginTop: 8 }}>
                    {Object.entries(batchPreview.byStatus).map(([key, value]) => (
                      <span className="badge" key={key}>
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                  <div className="badges" style={{ marginTop: 8 }}>
                    {Object.entries(batchPreview.byTemplate).map(([key, value]) => (
                      <span className="badge" key={key}>
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                  <div className="badges" style={{ marginTop: 8 }}>
                    {Object.entries(batchPreview.byPeriod).map(([key, value]) => (
                      <span className="badge" key={key}>
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                  <div className="actions" style={{ marginTop: 8 }}>
                    Muestra de cursos que entrarian en la revision. Si algo no coincide, ajusta periodos o momentos
                    antes de iniciar.
                  </div>
                  <table style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>NRC</th>
                        <th>Periodo</th>
                        <th>Momento</th>
                        <th>Tipo</th>
                        <th>Asignatura</th>
                        <th>Metodo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchPreview.sample.map((item) => (
                        <tr key={`${item.courseId}-${item.nrc}`}>
                          <td>{item.nrc}</td>
                          <td>{item.periodCode}</td>
                          <td>{item.moment}</td>
                          <td>{item.template}</td>
                          <td>{item.title}</td>
                          <td>{item.method}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </>
          ) : (
            <div className="controls" style={{ marginTop: 8 }}>
              <label style={{ minWidth: 280 }}>
                Carpeta de entrada
                <input
                  value={inputDir}
                  onChange={(event) => setInputDir(event.target.value)}
                  placeholder="storage/inputs/rpaca_csv"
                />
              </label>
              <div className="actions">Usa esta opcion solo si necesitas ejecutar el sidecar con una carpeta manual.</div>
            </div>
          )}
        </>
      ) : null}

      {command === 'revalidate' ? (
        <>
          <div className="actions" style={{ marginTop: 8 }}>
            <strong>Usa revalidacion para estos casos:</strong> cursos donde no estabas matriculado, cursos sin acceso y
            aulas que hoy siguen en tipo <span className="code">VACIO</span>. Esta opcion ya trabaja con la base de
            datos actual, no con archivos viejos de revalidacion.
          </div>
          <div className="controls" style={{ marginTop: 8 }}>
            <label>
              Tipo de revalidacion
              <select value={mode} onChange={(event) => setMode(event.target.value as RevalidateMode)}>
                <option value="ambos">Sin matricula/no registrado y aulas vacias</option>
                <option value="sin_matricula">Solo sin matricula / no registrado</option>
                <option value="aulas_vacias">Solo aulas vacias</option>
              </select>
            </label>
            <label style={{ minWidth: 340 }}>
              Archivo de salida (opcional)
              <input
                value={output}
                onChange={(event) => setOutput(event.target.value)}
                placeholder="storage/outputs/validation/REVALIDACION_PENDIENTES_RESULTADO.xlsx"
              />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} />
              <span>Ejecutar sin abrir ventanas</span>
            </label>
          </div>

          <div className="subtitle" style={{ marginTop: 10 }}>
            Periodos a revalidar
          </div>
          <div className="controls">
            <button
              type="button"
              onClick={() => setSelectedPeriodCodes((batchOptions?.periods ?? []).map((period) => period.code))}
              disabled={actionLoading}
            >
              Marcar todos los periodos
            </button>
            <button type="button" onClick={() => setSelectedPeriodCodes([])} disabled={actionLoading}>
              Limpiar seleccion
            </button>
          </div>
          <div className="badges" style={{ marginTop: 8 }}>
            {(batchOptions?.periods ?? []).map((period) => (
              <label className="badge badge-selector" key={`revalidate-${period.code}`}>
                <input
                  type="checkbox"
                  checked={selectedPeriodCodes.includes(period.code)}
                  onChange={() => setSelectedPeriodCodes((current) => toggleSelection(current, period.code))}
                />
                <span>
                  {period.code} | {period.label} ({period.courseCount})
                </span>
              </label>
            ))}
          </div>

          <div className="subtitle" style={{ marginTop: 10 }}>
            Momentos a incluir
          </div>
          <div className="controls">
            <button type="button" onClick={() => setSelectedMoments(batchOptions?.moments ?? [])} disabled={actionLoading}>
              Marcar todos los momentos
            </button>
            <button type="button" onClick={() => setSelectedMoments([])} disabled={actionLoading}>
              Usar todos los momentos
            </button>
          </div>
          <div className="badges" style={{ marginTop: 8 }}>
            {(batchOptions?.moments ?? []).map((moment) => (
              <label className="badge badge-selector" key={`revalidate-moment-${moment}`}>
                <input
                  type="checkbox"
                  checked={selectedMoments.includes(moment)}
                  onChange={() => setSelectedMoments((current) => toggleSelection(current, moment))}
                />
                <span>{moment}</span>
              </label>
            ))}
          </div>

          <div className="controls" style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => void previewRevalidateMode('aulas_vacias')}
              disabled={actionLoading || !hasBatchSelection || !!status?.running}
            >
              {actionLoading ? 'Procesando...' : 'Previsualizar aulas vacias'}
            </button>
            <button
              type="button"
              onClick={() => void previewRevalidateMode('sin_matricula')}
              disabled={actionLoading || !hasBatchSelection || !!status?.running}
            >
              {actionLoading ? 'Procesando...' : 'Previsualizar sin matricula / no registrado'}
            </button>
            <button type="button" onClick={previewBatch} disabled={actionLoading || !hasBatchSelection || !!status?.running}>
              {actionLoading ? 'Procesando...' : 'Previsualizar cursos a revalidar'}
            </button>
          </div>

          {batchPreview ? (
            <>
              <div className="subtitle" style={{ marginTop: 10 }}>
                Resumen de revalidacion
              </div>
              <div className="badges" style={{ marginTop: 10 }}>
                <span className="badge">Total lote: {batchPreview.total}</span>
                <span className="badge">Modo: {batchPreview.filters.mode ?? mode}</span>
                <span className="badge">
                  Momentos: {batchPreview.filters.moments.length ? batchPreview.filters.moments.join(', ') : 'todos'}
                </span>
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {Object.entries(batchPreview.byStatus).map(([key, value]) => (
                  <span className="badge" key={`revalidate-status-${key}`}>
                    {key}: {value}
                  </span>
                ))}
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {Object.entries(batchPreview.byTemplate).map(([key, value]) => (
                  <span className="badge" key={`revalidate-template-${key}`}>
                    {key}: {value}
                  </span>
                ))}
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {Object.entries(batchPreview.byPeriod).map(([key, value]) => (
                  <span className="badge" key={`revalidate-period-${key}`}>
                    {key}: {value}
                  </span>
                ))}
              </div>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Periodo</th>
                    <th>Momento</th>
                    <th>Tipo</th>
                    <th>Asignatura</th>
                    <th>Metodo</th>
                  </tr>
                </thead>
                <tbody>
                  {batchPreview.sample.map((item) => (
                    <tr key={`revalidate-${item.courseId}-${item.nrc}`}>
                      <td>{item.nrc}</td>
                      <td>{item.periodCode}</td>
                      <td>{item.moment}</td>
                      <td>{item.template}</td>
                      <td>{item.title}</td>
                      <td>{item.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      ) : null}

      {command === 'backup' ? (
        <>
          <div className="controls" style={{ marginTop: 8 }}>
            <label>
              Fuente de los NRC para respaldo
              <select
                value={backupSourceMode}
                onChange={(event) => setBackupSourceMode(event.target.value as BackupSourceMode)}
              >
                <option value="DATABASE">Base de datos del sistema</option>
                <option value="MANUAL_INPUT">Archivo CSV manual</option>
              </select>
            </label>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            <strong>Respaldo de cursos:</strong> aqui indicas el archivo CSV con los NRC que quieres descargar como
            copia de seguridad desde Moodle.
          </div>
          {backupSourceMode === 'DATABASE' ? (
            <>
              <div className="subtitle" style={{ marginTop: 10 }}>
                Paso 2. Filtrar cursos para respaldo
              </div>
              <div className="controls">
                <label>
                  Fuente del lote
                  <select
                    value={batchSource}
                    onChange={(event) => setBatchSource(event.target.value as SidecarBatchSource)}
                  >
                    {(batchOptions?.sources ?? []).map((source) => (
                      <option key={source.code} value={source.code}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                Selecciona periodos, momentos y tipos de aula. El sistema arma el CSV de NRC automaticamente para el
                respaldo.
              </div>

              <div className="subtitle" style={{ marginTop: 10 }}>
                Periodos a respaldar
              </div>
              <div className="controls">
                <button
                  type="button"
                  onClick={() => setSelectedPeriodCodes((batchOptions?.periods ?? []).map((period) => period.code))}
                  disabled={actionLoading}
                >
                  Marcar todos los periodos
                </button>
                <button type="button" onClick={() => setSelectedPeriodCodes([])} disabled={actionLoading}>
                  Limpiar seleccion
                </button>
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {(batchOptions?.periods ?? []).map((period) => (
                  <label className="badge badge-selector" key={`backup-${period.code}`}>
                    <input
                      type="checkbox"
                      checked={selectedPeriodCodes.includes(period.code)}
                      onChange={() => setSelectedPeriodCodes((current) => toggleSelection(current, period.code))}
                    />
                    <span>
                      {period.code} | {period.label} ({period.courseCount})
                    </span>
                  </label>
                ))}
              </div>

              <div className="subtitle" style={{ marginTop: 10 }}>
                Momentos a incluir
              </div>
              <div className="controls">
                <button type="button" onClick={() => setSelectedMoments(batchOptions?.moments ?? [])} disabled={actionLoading}>
                  Marcar todos los momentos
                </button>
                <button type="button" onClick={() => setSelectedMoments([])} disabled={actionLoading}>
                  Usar todos los momentos
                </button>
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {(batchOptions?.moments ?? []).map((moment) => (
                  <label className="badge badge-selector" key={`backup-moment-${moment}`}>
                    <input
                      type="checkbox"
                      checked={selectedMoments.includes(moment)}
                      onChange={() => setSelectedMoments((current) => toggleSelection(current, moment))}
                    />
                    <span>{moment}</span>
                  </label>
                ))}
              </div>

              <div className="subtitle" style={{ marginTop: 10 }}>
                Tipos de aula a respaldar
              </div>
              <div className="controls">
                <button
                  type="button"
                  onClick={() => setSelectedTemplates((batchOptions?.templates ?? []).map((template) => template.code))}
                  disabled={actionLoading}
                >
                  Marcar todos los tipos
                </button>
                <button type="button" onClick={() => setSelectedTemplates([])} disabled={actionLoading}>
                  Usar todos los tipos
                </button>
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {(batchOptions?.templates ?? []).map((template) => (
                  <label className="badge badge-selector" key={`backup-template-${template.code}`}>
                    <input
                      type="checkbox"
                      checked={selectedTemplates.includes(template.code)}
                      onChange={() => setSelectedTemplates((current) => toggleSelection(current, template.code))}
                    />
                    <span>
                      {template.label} ({template.count})
                    </span>
                  </label>
                ))}
              </div>

              <div className="controls" style={{ marginTop: 8 }}>
                <label>
                  Tiempo de espera para login (segundos)
                  <input value={loginWaitSeconds} onChange={(event) => setLoginWaitSeconds(event.target.value)} placeholder="300" />
                </label>
                <label>
                  Tiempo maximo del respaldo (segundos)
                  <input value={backupTimeout} onChange={(event) => setBackupTimeout(event.target.value)} placeholder="240" />
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={keepOpen} onChange={(event) => setKeepOpen(event.target.checked)} />
                  <span>Dejar navegador abierto al final</span>
                </label>
              </div>

              <div className="controls" style={{ marginTop: 10 }}>
                <button type="button" onClick={previewBatch} disabled={actionLoading || !hasBatchSelection || !!status?.running}>
                  {actionLoading ? 'Procesando...' : 'Previsualizar cursos para respaldo'}
                </button>
              </div>

              {batchPreview ? (
                <>
                  <div className="subtitle" style={{ marginTop: 10 }}>
                    Resumen del lote de respaldo
                  </div>
                  <div className="badges" style={{ marginTop: 10 }}>
                    <span className="badge">Total lote: {batchPreview.total}</span>
                    <span className="badge">Fuente: {batchPreview.filters.source}</span>
                    <span className="badge">
                      Tipos: {batchPreview.filters.templates?.length ? batchPreview.filters.templates.join(', ') : 'todos'}
                    </span>
                  </div>
                  <div className="badges" style={{ marginTop: 8 }}>
                    {Object.entries(batchPreview.byTemplate).map(([key, value]) => (
                      <span className="badge" key={`backup-preview-template-${key}`}>
                        {key}: {value}
                      </span>
                    ))}
                  </div>
                  <table style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>NRC</th>
                        <th>Periodo</th>
                        <th>Momento</th>
                        <th>Tipo</th>
                        <th>Asignatura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchPreview.sample.map((item) => (
                        <tr key={`backup-preview-${item.courseId}-${item.nrc}`}>
                          <td>{item.nrc}</td>
                          <td>{item.periodCode}</td>
                          <td>{item.moment}</td>
                          <td>{item.template}</td>
                          <td>{item.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </>
          ) : (
            <div className="controls" style={{ marginTop: 8 }}>
              <label style={{ minWidth: 340 }}>
                Archivo CSV con NRC para respaldo
                <input value={nrcCsv} onChange={(event) => setNrcCsv(event.target.value)} placeholder="tools/moodle-sidecar/nrcs.csv" />
              </label>
              <label>
                Tiempo de espera para login (segundos)
                <input value={loginWaitSeconds} onChange={(event) => setLoginWaitSeconds(event.target.value)} placeholder="300" />
              </label>
              <label>
                Tiempo maximo del respaldo (segundos)
                <input value={backupTimeout} onChange={(event) => setBackupTimeout(event.target.value)} placeholder="240" />
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={keepOpen} onChange={(event) => setKeepOpen(event.target.checked)} />
                <span>Dejar navegador abierto al final</span>
              </label>
            </div>
          )}
        </>
      ) : null}

      {command === 'attendance' || command === 'activity' || command === 'participants' ? (
        <>
          <div className="actions" style={{ marginTop: 8 }}>
            {command === 'attendance' ? (
              <>
                Esta tarea usa la <span className="code">URL Moodle final</span> guardada en el sistema, abre el aula,
                localiza el modulo <span className="code">Asistencia</span> y descarga el export oficial.
              </>
            ) : command === 'participants' ? (
              <>
                Esta tarea usa la <span className="code">URL Moodle final</span> y el <span className="code">courseId</span>{' '}
                para abrir el listado de participantes, capturar nombres, correos, roles visibles y ultimo acceso.
              </>
            ) : (
              <>
                Esta tarea usa la <span className="code">URL Moodle final</span> y el <span className="code">courseId</span>{' '}
                del curso para abrir el reporte de actividad y descargar el <span className="code">CSV</span> del log.
              </>
            )}
            <br />
            Corre en modo secuencial. Aqui no aplican <span className="code">workers</span>.
          </div>

          <div className="subtitle" style={{ marginTop: 10 }}>
            Paso 2. Seleccionar cursos con URL Moodle resuelta
          </div>
          <div className="controls">
            <label>
              Fuente del lote
              <select value={batchSource} onChange={(event) => setBatchSource(event.target.value as SidecarBatchSource)}>
                {(batchOptions?.sources ?? [])
                  .filter((source) => source.code !== 'PENDING')
                  .map((source) => (
                    <option key={`extract-${source.code}`} value={source.code}>
                      {source.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} />
              <span>Ejecutar sin abrir ventanas</span>
            </label>
            <label>
              Tiempo de espera para login (segundos)
              <input value={loginWaitSeconds} onChange={(event) => setLoginWaitSeconds(event.target.value)} placeholder="300" />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={keepOpen} onChange={(event) => setKeepOpen(event.target.checked)} />
              <span>Dejar navegador abierto al final</span>
            </label>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            Usa <span className="code">ALL</span> para el periodo completo o <span className="code">SAMPLING</span> si
            solo quieres descargar evidencias del muestreo.
          </div>
          <label style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            NRC especificos (opcional)
            <textarea
              value={manualExtractNrcs}
              onChange={(event) => setManualExtractNrcs(event.target.value)}
              rows={3}
              placeholder="72305, 72308, 15-72314"
            />
            <span className="actions">
              Si diligencias NRC aqui, el lote se recorta a esos cursos dentro de los periodos seleccionados.
            </span>
          </label>

          <div className="subtitle" style={{ marginTop: 10 }}>
            Periodos a incluir
          </div>
          <div className="controls">
            <button
              type="button"
              onClick={() => setSelectedPeriodCodes((batchOptions?.periods ?? []).map((period) => period.code))}
              disabled={actionLoading}
            >
              Marcar todos los periodos
            </button>
            <button type="button" onClick={() => setSelectedPeriodCodes([])} disabled={actionLoading}>
              Limpiar seleccion
            </button>
          </div>
          <div className="badges" style={{ marginTop: 8 }}>
            {(batchOptions?.periods ?? []).map((period) => (
              <label className="badge badge-selector" key={`extract-${period.code}`}>
                <input
                  type="checkbox"
                  checked={selectedPeriodCodes.includes(period.code)}
                  onChange={() => setSelectedPeriodCodes((current) => toggleSelection(current, period.code))}
                />
                <span>
                  {period.code} | {period.label} ({period.courseCount})
                </span>
              </label>
            ))}
          </div>

          <div className="subtitle" style={{ marginTop: 10 }}>
            Momentos a incluir
          </div>
          <div className="controls">
            <button type="button" onClick={() => setSelectedMoments(batchOptions?.moments ?? [])} disabled={actionLoading}>
              Marcar todos los momentos
            </button>
            <button type="button" onClick={() => setSelectedMoments([])} disabled={actionLoading}>
              Usar todos los momentos
            </button>
          </div>
          <div className="badges" style={{ marginTop: 8 }}>
            {(batchOptions?.moments ?? []).map((moment) => (
              <label className="badge badge-selector" key={`extract-moment-${moment}`}>
                <input
                  type="checkbox"
                  checked={selectedMoments.includes(moment)}
                  onChange={() => setSelectedMoments((current) => toggleSelection(current, moment))}
                />
                <span>{moment}</span>
              </label>
            ))}
          </div>

          <div className="subtitle" style={{ marginTop: 10 }}>
            Tipos de aula
          </div>
          <div className="controls">
            <button
              type="button"
              onClick={() => setSelectedTemplates((batchOptions?.templates ?? []).map((template) => template.code))}
              disabled={actionLoading}
            >
              Marcar todos los tipos
            </button>
            <button type="button" onClick={() => setSelectedTemplates([])} disabled={actionLoading}>
              Usar todos los tipos
            </button>
          </div>
          <div className="badges" style={{ marginTop: 8 }}>
            {(batchOptions?.templates ?? []).map((template) => (
              <label className="badge badge-selector" key={`extract-template-${template.code}`}>
                <input
                  type="checkbox"
                  checked={selectedTemplates.includes(template.code)}
                  onChange={() => setSelectedTemplates((current) => toggleSelection(current, template.code))}
                />
                <span>
                  {template.label} ({template.count})
                </span>
              </label>
            ))}
          </div>

          <div className="controls" style={{ marginTop: 10 }}>
            <button type="button" onClick={previewBatch} disabled={actionLoading || !hasBatchSelection || !!status?.running}>
              {actionLoading
                ? 'Procesando...'
                : command === 'attendance'
                  ? 'Previsualizar cursos para asistencia'
                  : command === 'participants'
                    ? 'Previsualizar cursos para participantes'
                    : 'Previsualizar cursos para actividad'}
            </button>
          </div>

          {batchPreview ? (
            <>
              <div className="subtitle" style={{ marginTop: 10 }}>
                Resumen del lote de exportacion
              </div>
              <div className="badges" style={{ marginTop: 10 }}>
                <span className="badge">Total lote: {batchPreview.total}</span>
                <span className="badge">Fuente: {batchPreview.filters.source ?? 'ALL'}</span>
                <span className="badge">
                  Tipos: {batchPreview.filters.templates?.length ? batchPreview.filters.templates.join(', ') : 'todos'}
                </span>
                <span className="badge">
                  NRC: {batchPreview.filters.nrcs?.length ? `${batchPreview.filters.nrcs.length} especificos` : 'todos'}
                </span>
              </div>
              <div className="badges" style={{ marginTop: 8 }}>
                {Object.entries(batchPreview.byStatus).map(([key, value]) => (
                  <span className="badge" key={`extract-status-${key}`}>
                    {key}: {value}
                  </span>
                ))}
              </div>
              {batchPreview.byModality ? (
                <div className="badges" style={{ marginTop: 8 }}>
                  {Object.entries(batchPreview.byModality).map(([key, value]) => (
                    <span className="badge" key={`extract-modality-${key}`}>
                      {key}: {value}
                    </span>
                  ))}
                </div>
              ) : null}
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Periodo</th>
                    <th>Momento</th>
                    <th>Tipo</th>
                    <th>Modalidad</th>
                    <th>Asignatura</th>
                    <th>URL Moodle</th>
                  </tr>
                </thead>
                <tbody>
                  {batchPreview.sample.map((item) => (
                    <tr key={`extract-${item.courseId}-${item.nrc}`}>
                      <td>{item.nrc}</td>
                      <td>{item.periodCode}</td>
                      <td>{item.moment}</td>
                      <td>{item.template}</td>
                      <td>{item.resolvedModality ?? '-'}</td>
                      <td>{item.title}</td>
                      <td>{item.moodleCourseUrl ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      ) : null}

      <div className="controls" style={{ marginTop: 10 }}>
        <button onClick={startRun} disabled={!canStart}>
          {actionLoading ? 'Procesando...' : startButtonLabel}
        </button>
        <button onClick={cancelRun} disabled={!status?.running || actionLoading}>
          Cancelar proceso actual
        </button>
      </div>

      {command === 'attendance' || command === 'activity' || command === 'participants' ? (
        <div className="actions" style={{ marginTop: 10 }}>
          Esta tarea solo descarga archivos. Si quieres explotar esos datos en analitica, luego debes importarlos
          desde la pantalla de analitica Moodle.
        </div>
      ) : (
        <>
      <div className="subtitle">Paso 3. Guardar el resultado en la base de datos</div>
      <div className="controls">
        <label style={{ minWidth: 420 }}>
          Archivo de resultado (csv/xlsx/json, opcional)
          <input
            value={importPath}
            onChange={(event) => setImportPath(event.target.value)}
            placeholder="storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE.csv"
          />
        </label>
        <label>
          Etiqueta del origen
          <input value={importSource} onChange={(event) => setImportSource(event.target.value)} placeholder="ui-sidecar" />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={importDryRun} onChange={(event) => setImportDryRun(event.target.checked)} />
          <span>Solo simular la importacion</span>
        </label>
        <button onClick={importToSystem} disabled={actionLoading || status?.running}>
          {actionLoading ? 'Procesando...' : 'Importar resultado al sistema'}
        </button>
      </div>
      <div className="actions">
        Si dejas el archivo vacio, el sistema toma automaticamente el ultimo resultado valido de clasificacion o
        revalidacion. Marca la simulacion solo si quieres revisar el impacto antes de guardar cambios definitivos.
      </div>

      <div className="subtitle">Paso 4. Resolver cursos sin acceso o no encontrados</div>
      <div className="actions">
        Aqui puedes ver en tabla los NRC donde no estabas registrado o los que Moodle no encontro. Desde esta misma
        vista puedes descargar el listado, mandar los <span className="code">NO_ENCONTRADO</span> a Banner y, cuando
        Banner tampoco los encuentre, desactivarlos con confirmacion.
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        Para los casos <span className="code">sin_matricula</span>, el boton de formato oficial llena el Excel con
        <span className="code"> Jaime Duvan</span>, <span className="code">Lozano Ardila</span>,
        <span className="code"> jaime.lozano.a@uniminuto.edu</span> y rol
        <span className="code"> Auditor con todos los permisos</span>.
      </div>
      <div className="controls" style={{ marginTop: 8 }}>
        <label>
          Tipo de casos a mostrar
          <select value={followupKind} onChange={(event) => setFollowupKind(event.target.value as MoodleFollowupKind)}>
            <option value="ambos">Sin matricula/no registrado y no encontrados</option>
            <option value="sin_matricula">Solo sin matricula / no registrado</option>
            <option value="no_encontrado">Solo no encontrados en Moodle</option>
          </select>
        </label>
        <label>
          Nombre de consulta para Banner
          <input
            value={followupQueryName}
            onChange={(event) => setFollowupQueryName(event.target.value)}
            placeholder="moodle-followup"
          />
        </label>
        <label style={{ minWidth: 360 }}>
          Motivo de desactivacion
          <input
            value={deactivateReason}
            onChange={(event) => setDeactivateReason(event.target.value)}
            placeholder="NRC desactivado luego de no encontrarse en Moodle ni en Banner."
          />
        </label>
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        La lista usa los periodos y momentos que tengas seleccionados arriba. Si no marcas nada, toma todos los
        disponibles.
      </div>
      <div className="controls" style={{ marginTop: 8 }}>
        <button type="button" onClick={() => void loadFollowupCases('sin_matricula')} disabled={actionLoading}>
          {actionLoading ? 'Procesando...' : 'Cargar no registrados'}
        </button>
        <button type="button" onClick={() => void loadFollowupCases('no_encontrado')} disabled={actionLoading}>
          {actionLoading ? 'Procesando...' : 'Cargar no encontrados'}
        </button>
        <button type="button" onClick={() => void loadFollowupCases('ambos')} disabled={actionLoading}>
          {actionLoading ? 'Procesando...' : 'Cargar ambos'}
        </button>
        <button type="button" onClick={() => void loadFollowupCases()} disabled={actionLoading}>
          {actionLoading ? 'Procesando...' : 'Cargar lista de seguimiento'}
        </button>
        <button type="button" onClick={exportFollowupCsv} disabled={actionLoading || !followupItems.length}>
          Descargar CSV de la lista
        </button>
        <button
          type="button"
          onClick={downloadAuditorTemplate}
          disabled={actionLoading || !visibleAuditorFollowupItems.length}
        >
          Descargar formato oficial de auditor
        </button>
        <button type="button" onClick={sendNotFoundToBanner} disabled={actionLoading || !followupItems.some((item) => item.canSendToBanner)}>
          Enviar no encontrados a Banner
        </button>
        <button type="button" onClick={importLatestBannerResult} disabled={actionLoading}>
          Importar ultimo resultado Banner
        </button>
        <button type="button" onClick={deactivateFollowupCourses} disabled={actionLoading || !followupItems.some((item) => item.canDeactivate)}>
          Desactivar no encontrados en Moodle y Banner
        </button>
      </div>

      {followupData ? (
        <>
          <div className="badges" style={{ marginTop: 10 }}>
            <span className="badge">Total: {followupData.total}</span>
            {Object.entries(followupData.byKind).map(([key, value]) => (
              <span className="badge" key={key}>
                {key}: {value}
              </span>
            ))}
            {Object.entries(followupData.byBannerStatus).map(([key, value]) => (
              <span className="badge" key={key}>
                Banner {key}: {value}
              </span>
            ))}
          </div>
          <div className="controls" style={{ marginTop: 8 }}>
            <button type="button" onClick={() => setSelectedFollowupIds(followupItems.map((item) => item.id))} disabled={actionLoading || !followupItems.length}>
              Marcar visibles
            </button>
            <button
              type="button"
              onClick={() => setSelectedFollowupIds(unique(followupItems.filter((item) => item.canSendToBanner).map((item) => item.id)))}
              disabled={actionLoading || !followupItems.some((item) => item.canSendToBanner)}
            >
              Marcar no encontrados para Banner
            </button>
            <button
              type="button"
              onClick={() => setSelectedFollowupIds(unique(followupItems.filter((item) => item.canDeactivate).map((item) => item.id)))}
              disabled={actionLoading || !followupItems.some((item) => item.canDeactivate)}
            >
              Marcar eliminables
            </button>
            <button
              type="button"
              onClick={() => setSelectedFollowupIds(unique(visibleAuditorFollowupItems.map((item) => item.id)))}
              disabled={actionLoading || !visibleAuditorFollowupItems.length}
            >
              Marcar sin matricula para formato
            </button>
            <button type="button" onClick={() => setSelectedFollowupIds([])} disabled={actionLoading || !selectedFollowupIds.length}>
              Limpiar seleccion
            </button>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            Seleccionados: {selectedFollowupIds.length}. Para desactivar, el NRC debe aparecer tambien con estado Banner{' '}
            <span className="code">NO_ENCONTRADO</span>.
          </div>
          <div className="subtitle" style={{ marginTop: 10 }}>Vista previa del formato oficial</div>
          <div className="actions" style={{ marginTop: 8 }}>
            El Excel va a salir con {auditorTemplateItems.length} NRC.
            {selectedAuditorFollowupItems.length
              ? ' Esta vista previa usa solo los NRC sin matricula que marcaste.'
              : ' Como no hay seleccion puntual para formato, esta vista previa usa todos los NRC sin matricula visibles.'}
            <br />
            Nombre: <span className="code">Jaime Duvan</span> | Apellidos: <span className="code">Lozano Ardila</span> |
            Correo: <span className="code">jaime.lozano.a@uniminuto.edu</span> | Rol:{' '}
            <span className="code">Auditor con todos los permisos</span>
          </div>
          {auditorTemplateItems.length ? (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Periodo</th>
                  <th>Asignatura / curso</th>
                  <th>Valor que ira en Excel</th>
                </tr>
              </thead>
              <tbody>
                {auditorTemplateItems.map((item) => (
                  <tr key={`auditor-preview-${item.id}`}>
                    <td>{item.nrc}</td>
                    <td>{item.periodCode}</td>
                    <td>{item.subjectName ?? item.moodleCourseUrl ?? '-'}</td>
                    <td>{`${item.nrc} - ${item.subjectName ?? item.moodleCourseUrl ?? 'Curso sin nombre corto'}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="actions" style={{ marginTop: 8 }}>
              No hay NRC sin matricula visibles para llenar el formato oficial.
            </div>
          )}
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Sel.</th>
                <th>Tipo</th>
                <th>NRC</th>
                <th>Asignatura</th>
                <th>Periodo</th>
                <th>Momento</th>
                <th>Programa</th>
                <th>Docente</th>
                <th>Estado Moodle</th>
                <th>Estado Banner</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {followupItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedFollowupIds.includes(item.id)}
                      onChange={() => setSelectedFollowupIds((current) => toggleSelection(current, item.id))}
                    />
                  </td>
                  <td>{item.followupKind === 'sin_matricula' ? 'Sin matricula' : 'No encontrado'}</td>
                  <td>{item.nrc}</td>
                  <td>{item.subjectName ?? '-'}</td>
                  <td>{item.periodCode}</td>
                  <td>{item.moment ?? '-'}</td>
                  <td>{item.programName ?? '-'}</td>
                  <td>{item.teacherName ?? '-'}</td>
                  <td>
                    {item.moodleStatus ?? '-'}
                    {item.moodleErrorCode ? ` / ${item.moodleErrorCode}` : ''}
                  </td>
                  <td>{item.bannerReviewStatus ?? '-'}</td>
                  <td>{item.moodleNotes ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
        </>
      )}

      {status?.artifactSummary ? (
        <>
          <div className="subtitle" style={{ marginTop: 10 }}>
            Archivos generados
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            Resultado de la ultima corrida de {ARTIFACT_KIND_LABELS[status.artifactSummary.kind]}.
            Carpeta base: <span className="code">{status.artifactSummary.outputDir}</span>
          </div>
          <div className="badges" style={{ marginTop: 8 }}>
            <span className="badge">Cursos: {status.artifactSummary.totalCourses}</span>
            <span className="badge">Completados: {status.artifactSummary.completedCourses}</span>
            <span className="badge">Fallidos: {status.artifactSummary.failedCourses}</span>
            <span className="badge">Sin archivo: {status.artifactSummary.skippedCourses}</span>
          </div>
          {status.artifactSummary.files.length ? (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Periodo</th>
                  <th>Curso</th>
                  <th>Archivo</th>
                  <th>Descarga</th>
                </tr>
              </thead>
              <tbody>
                {status.artifactSummary.files.slice(0, 200).map((file) => (
                  <tr key={`${file.relativePath}-${file.fileName}`}>
                    <td>{file.nrc}</td>
                    <td>{file.periodCode}</td>
                    <td>{file.title}</td>
                    <td>{file.fileName}</td>
                    <td>
                      <a href={buildArtifactDownloadHref(apiBase, file.relativePath)} target="_blank" rel="noreferrer">
                        Principal
                      </a>
                      {file.csvRelativePath ? (
                        <>
                          {' | '}
                          <a href={buildArtifactDownloadHref(apiBase, file.csvRelativePath)} target="_blank" rel="noreferrer">
                            CSV
                          </a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="actions" style={{ marginTop: 8 }}>
              La corrida termino, pero no dejo archivos descargables en el resumen.
            </div>
          )}
          {status.artifactSummary.items.length ? (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Periodo</th>
                  <th>Curso</th>
                  <th>Estado</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {status.artifactSummary.items.slice(0, 200).map((item) => (
                  <tr key={`artifact-item-${item.nrc}-${item.periodCode}-${item.title}`}>
                    <td>{item.nrc}</td>
                    <td>{item.periodCode}</td>
                    <td>{item.title}</td>
                    <td>{item.status}</td>
                    <td>{item.message ?? item.downloads?.map((download) => download.fileName).join(', ') ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}

      {message ? <div className="message">{message}</div> : null}

      {status?.logTail ? (
        <>
          <div className="subtitle">Seguimiento del proceso</div>
          <div className="actions" style={{ marginTop: 8 }}>
            Este bloque muestra el log vivo mientras Moodle corre. Cuando termina, aqui queda el ultimo log disponible
            para validar login, modalidad detectada, participantes y archivos generados.
          </div>
          <pre className="log-box">{status.logTail}</pre>
        </>
      ) : null}

      {importResult ? (
        <>
          <div className="subtitle">Resumen de la importacion</div>
          <div className="badges" style={{ marginTop: 8 }}>
            <span className="badge">Procesados: {importResult.processedRows ?? 0}</span>
            <span className="badge">Actualizados: {importResult.updatedRows ?? 0}</span>
            <span className="badge">Cambios detectados: {importResult.changes?.length ?? 0}</span>
            <span className="badge">Sin match: {importResult.noMatch ?? 0}</span>
          </div>
          {importResult.notes?.length ? (
            <div className="actions" style={{ marginTop: 8 }}>
              {importResult.notes.join(' ')}
            </div>
          ) : null}
          {importResult.changes?.length ? (
            <>
              <div className="subtitle" style={{ marginTop: 10 }}>Cursos con cambios de tipo o estado</div>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Periodo</th>
                    <th>Asignatura</th>
                    <th>Tipo anterior</th>
                    <th>Tipo nuevo</th>
                    <th>Estado anterior</th>
                    <th>Estado nuevo</th>
                    <th>Cambios</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.changes.map((item) => (
                    <tr key={`${item.courseId}-${item.nrc}`}>
                      <td>{item.nrc}</td>
                      <td>{item.periodCode}</td>
                      <td>{item.subjectName ?? '-'}</td>
                      <td>{item.previousTemplate}</td>
                      <td>{item.nextTemplate}</td>
                      <td>{item.previousStatus}</td>
                      <td>{item.nextStatus}</td>
                      <td>
                        {[
                          item.changedTemplate ? 'tipo' : null,
                          item.changedStatus ? 'estado' : null,
                          item.changedUrl ? 'url' : null,
                        ]
                          .filter(Boolean)
                          .join(', ') || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="actions" style={{ marginTop: 8 }}>
              La importacion no detecto cambios de tipo, estado o URL en los cursos procesados.
            </div>
          )}
        </>
      ) : null}
    </article>
  );
}
