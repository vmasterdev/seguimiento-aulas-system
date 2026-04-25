'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type RpacaManagementPanelProps = {
  apiBase: string;
};

type ImportCsvResult = {
  ok: boolean;
  files: number;
  totalRows: number;
  createdCourses: number;
  updatedCourses: number;
  skippedRows: number;
  failedRows?: number;
  completedWithErrors?: boolean;
  skippedExistingCourses: number;
  preservedTeacherAssignments: number;
  periodsTouched: string[];
  historyPath?: string | null;
  historyRelativePath?: string | null;
  errors: string[];
};

type BannerStatusResponse = {
  ok: boolean;
  runner: {
    running: boolean;
    current: {
      id: string;
      status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    } | null;
    lastRun: {
      id: string;
      status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
      exitCode?: number | null;
    } | null;
    logTail: string;
  };
  exportSummary: {
    latestFile: string | null;
    rowCount: number;
  };
};

type BannerStartResponse = {
  ok: boolean;
  action: string;
  result?: {
    run?: {
      id: string;
      status: string;
    };
    batch?: {
      total?: number;
    };
  };
};

type BannerImportResponse = {
  ok: boolean;
  action: string;
  result?: {
    ok?: boolean;
    updatedCourses?: number;
    linkedTeachers?: number;
    statusCounts?: Record<string, number>;
  };
};

type CourseListItem = {
  id: string;
  bannerReviewStatus?: string | null;
};

type CourseListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: CourseListItem[];
};

type DeactivateBatchResponse = {
  ok: boolean;
  requested: number;
  deactivated: number;
  failed: number;
};

type RpacaBannerPipelineSummary = {
  periods: string[];
  bannerBatchTotal: number;
  bannerImportedRows: number;
  bannerFound: number;
  bannerNoEncontrado: number;
  systemDeactivated: number;
  readyForMoodle: number;
  latestBannerFile: string | null;
};

type MissingTeacherItem = {
  id: string;
  nrc: string;
  periodCode: string;
  programCode: string | null;
  programName: string | null;
  subjectName: string | null;
  moment: string | null;
  moodleStatus: string | null;
  detectedTemplate: string | null;
  currentTeacherId: string | null;
  currentTeacherName: string | null;
  sourceTeacherId: string | null;
  sourceDocumentId: string | null;
  sourceTeacherName: string | null;
  bannerStatus: string | null;
  bannerTeacherId: string | null;
  bannerTeacherName: string | null;
  preferredTeacherId: string | null;
  preferredTeacherName: string | null;
  preferredSource: string | null;
  bannerResolved: boolean;
  missingInSystemTeacher: boolean;
  missingInRpacaTeacherId: boolean;
  missingInRpacaTeacherName: boolean;
  missingReasons: string[];
};

type MissingTeacherResult = {
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  filters?: {
    periodCodes?: string[];
    moment?: string | null;
    q?: string | null;
  };
  items: MissingTeacherItem[];
};

type BannerBatchOptions = {
  periods: Array<{
    code: string;
    label: string;
    modality: string;
    year: string;
    courseCount: number;
  }>;
  defaults: {
    selectedPeriodCodes: string[];
    latestYear: string | null;
  };
};

export function RpacaManagementPanel({ apiBase }: RpacaManagementPanelProps) {
  const [rpacaFiles, setRpacaFiles] = useState<File[]>([]);
  const [preserveTeacherAssignment, setPreserveTeacherAssignment] = useState(true);
  const [createOnly, setCreateOnly] = useState(false);
  const [runBannerAfterImport, setRunBannerAfterImport] = useState(true);
  const [deactivateBannerNotFound, setDeactivateBannerNotFound] = useState(true);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportCsvResult | null>(null);
  const [pipelineSummary, setPipelineSummary] = useState<RpacaBannerPipelineSummary | null>(null);
  const [importMessage, setImportMessage] = useState('');
  const [recentPeriodsTouched, setRecentPeriodsTouched] = useState<string[]>([]);

  const [selectedPeriodCodes, setSelectedPeriodCodes] = useState<string[]>([]);
  const [periodOptions, setPeriodOptions] = useState<BannerBatchOptions['periods']>([]);
  const [momentFilter, setMomentFilter] = useState('');
  const [search, setSearch] = useState('');
  const [missingLimit, setMissingLimit] = useState('150');
  const [missingLoading, setMissingLoading] = useState(false);
  const [missingMessage, setMissingMessage] = useState('');
  const [missingResult, setMissingResult] = useState<MissingTeacherResult | null>(null);
  const [teacherDrafts, setTeacherDrafts] = useState<Record<string, string>>({});
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});

  const rowsWithDraft = useMemo(() => {
    const result = missingResult?.items ?? [];
    return result.filter((row) => (teacherDrafts[row.id] ?? '').trim().length > 0).length;
  }, [missingResult?.items, teacherDrafts]);

  useEffect(() => {
    void loadMissingTeacher();
    // Cargar tabla inicial al abrir la pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPeriodOptions();
  }, []);

  function toggleSelection(current: string[], value: string) {
    return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  }

  async function loadPeriodOptions() {
    try {
      const data = await fetchJson<BannerBatchOptions>('/api/banner/batch/options');
      setPeriodOptions(data.periods ?? []);
    } catch {
      setPeriodOptions([]);
    }
  }

  async function waitForBannerRun(runId: string) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const status = await fetchJson<BannerStatusResponse>('/api/banner/status');
      const run =
        status.runner.current?.id === runId
          ? status.runner.current
          : status.runner.lastRun?.id === runId
            ? status.runner.lastRun
            : null;

      if (run && run.status !== 'RUNNING') {
        return { run, status };
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 2000);
      });
    }

    throw new Error('Banner sigue ejecutandose despues de 20 minutos. Revisa su estado manualmente.');
  }

  async function fetchCoursesForPeriods(periodCodes: string[]) {
    const uniquePeriods = [...new Set(periodCodes.filter(Boolean))];
    const responses = await Promise.all(
      uniquePeriods.map((period) =>
        fetchJson<CourseListResponse>(`${apiBase}/courses?periodCode=${encodeURIComponent(period)}&limit=5000`),
      ),
    );
    return responses.flatMap((response) => response.items);
  }

  async function runBannerPipelineForPeriods(periodsTouched: string[]) {
    const periods = [...new Set(periodsTouched.filter(Boolean))];
    if (!periods.length) {
      return null;
    }

    setImportMessage(`RPACA importado. Iniciando validacion en Banner para: ${periods.join(', ')}.`);
    const started = await fetchJson<BannerStartResponse>('/api/banner/batch/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'ALL',
          periodCodes: periods,
          queryName: `rpaca-auto-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`,
          workers: 1,
        }),
      });

    const runId = started.result?.run?.id;
    if (!runId) {
      throw new Error('Banner no devolvio un identificador de corrida.');
    }

    const batchTotal = Number(started.result?.batch?.total ?? 0);
    setImportMessage(`Banner en ejecucion sobre ${batchTotal} NRC. Esperando finalizacion...`);
    const { run, status } = await waitForBannerRun(runId);
    if (run.status !== 'COMPLETED') {
      throw new Error(
        `Banner termino con estado ${run.status}. ${status.runner.logTail?.trim() ? 'Revisa el log de Banner.' : ''}`,
      );
    }

    setImportMessage('Banner terminado. Importando resultado a la base del sistema...');
    const imported = await fetchJson<BannerImportResponse>('/api/banner/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'import',
        payload: {},
      }),
    });

    const importedRows = Number(imported.result?.updatedCourses ?? 0);
    const statusCounts = imported.result?.statusCounts ?? {};
    const courses = await fetchCoursesForPeriods(periods);
    const bannerNoEncontradoIds = courses
      .filter((course) => String(course.bannerReviewStatus ?? '').trim().toUpperCase() === 'NO_ENCONTRADO')
      .map((course) => course.id);
    const bannerFound = courses.filter(
      (course) => String(course.bannerReviewStatus ?? '').trim().toUpperCase() === 'ENCONTRADO',
    ).length;
    const bannerNoEncontrado = bannerNoEncontradoIds.length;

    let systemDeactivated = 0;
    if (deactivateBannerNotFound && bannerNoEncontradoIds.length) {
      setImportMessage(`Banner importado. Descartando ${bannerNoEncontradoIds.length} NRC no encontrados del sistema...`);
      const deactivated = await fetchJson<DeactivateBatchResponse>(`${apiBase}/courses/deactivate-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseIds: bannerNoEncontradoIds,
          confirm: true,
          reason: 'NRC descartado automaticamente despues de validacion Banner posterior a importacion RPACA.',
        }),
      });
      systemDeactivated = deactivated.deactivated;
    }

    const readyForMoodle = bannerFound;

    return {
      periods,
      bannerBatchTotal: batchTotal,
      bannerImportedRows: importedRows || Number(statusCounts.ENCONTRADO ?? 0) + Number(statusCounts.NO_ENCONTRADO ?? 0) + Number(statusCounts.SIN_DOCENTE ?? 0),
      bannerFound,
      bannerNoEncontrado,
      systemDeactivated,
      readyForMoodle,
      latestBannerFile: status.exportSummary.latestFile,
    } satisfies RpacaBannerPipelineSummary;
  }

  async function importRpaca() {
    if (!rpacaFiles.length) {
      setImportMessage('Selecciona al menos un archivo RPACA (.csv).');
      return;
    }

    try {
      setImportLoading(true);
      setImportMessage('');
      setPipelineSummary(null);
      setRecentPeriodsTouched([]);
      const formData = new FormData();
      rpacaFiles.forEach((file) => formData.append('files', file, file.name));
      formData.append('preserveTeacherAssignment', preserveTeacherAssignment ? 'true' : 'false');
      formData.append('createOnly', createOnly ? 'true' : 'false');

      const response = await fetch(`${apiBase}/import/csv`, {
        method: 'POST',
        body: formData,
      });
      const data = (await response.json()) as ImportCsvResult & { message?: string | string[] };
      if (!response.ok || !data?.ok) {
        const message = Array.isArray(data?.message)
          ? data.message.join('; ')
          : (data?.message ?? 'No fue posible importar RPACA.');
        throw new Error(message);
      }

      setImportResult(data);
      setRecentPeriodsTouched(data.periodsTouched ?? []);
      if ((data.periodsTouched?.length ?? 0) === 1) {
        setSelectedPeriodCodes([data.periodsTouched[0]]);
      } else if ((data.periodsTouched?.length ?? 0) > 1) {
        setSelectedPeriodCodes(data.periodsTouched);
      }
      const historyNote = data.historyRelativePath ? ` Historial: ${data.historyRelativePath}` : '';
      const importBaseMessage = data.completedWithErrors
        ? `RPACA importado con observaciones. Fallaron ${data.failedRows ?? 0} filas.${historyNote}`
        : `RPACA importado correctamente.${historyNote}`;
      setImportMessage(importBaseMessage);

      if (runBannerAfterImport && data.periodsTouched?.length) {
        const summary = await runBannerPipelineForPeriods(data.periodsTouched);
        if (summary) {
          setPipelineSummary(summary);
          setImportMessage(
            `Flujo RPACA -> Banner completado. ${summary.bannerFound} NRC encontrados quedan listos para revision visual de tipo de aulas. ${summary.systemDeactivated} NRC no encontrados fueron descartados del sistema.${
              data.completedWithErrors ? ` Ademas, RPACA dejo ${data.failedRows ?? 0} filas con observaciones.` : ''
            }`,
          );
        }
      }

      await loadMissingTeacher(data.periodsTouched ?? []);
    } catch (error) {
      setImportMessage(`Error importando RPACA: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImportLoading(false);
    }
  }

  async function loadMissingTeacher(periodCodesOverride?: string[]) {
    try {
      setMissingLoading(true);
      setMissingMessage('');
      const params = new URLSearchParams();
      const effectivePeriodCodes = periodCodesOverride ?? selectedPeriodCodes;
      if (effectivePeriodCodes.length) params.set('periodCodes', effectivePeriodCodes.join(','));
      if (momentFilter.trim()) params.set('moment', momentFilter.trim());
      if (search.trim()) params.set('q', search.trim());
      if (missingLimit.trim()) params.set('limit', missingLimit.trim());

      const data = await fetchJson<MissingTeacherResult>(
        `${apiBase}/courses/missing-teacher/list?${params.toString()}`,
      );
      setMissingResult(data);
      setTeacherDrafts((prev) => {
        const next = { ...prev };
        for (const item of data.items) {
          if (next[item.id] !== undefined) continue;
          next[item.id] = item.preferredTeacherId || item.sourceTeacherId || item.sourceDocumentId || '';
        }
        return next;
      });
    } catch (error) {
      setMissingMessage(
        `No fue posible cargar NRC con faltantes de docente: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setMissingLoading(false);
    }
  }

  async function assignTeacherForCourse(courseId: string, teacherIdRaw: string) {
    const teacherId = teacherIdRaw.trim();
    if (!teacherId) {
      throw new Error('Debes ingresar un ID docente antes de guardar.');
    }
    await fetchJson(`${apiBase}/courses/${courseId}/teacher`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherId }),
    });
  }

  async function saveTeacher(courseId: string) {
    const teacherIdRaw = teacherDrafts[courseId] ?? '';
    try {
      setSavingMap((prev) => ({ ...prev, [courseId]: true }));
      setMissingMessage('');
      await assignTeacherForCourse(courseId, teacherIdRaw);
      setMissingMessage(`ID docente asignado para el NRC (${courseId.slice(0, 8)}...).`);
      await loadMissingTeacher();
    } catch (error) {
      setMissingMessage(
        `No fue posible asignar el ID docente: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSavingMap((prev) => ({ ...prev, [courseId]: false }));
    }
  }

  async function saveAllDrafts() {
    if (!missingResult?.items.length) return;
    const rows = missingResult.items.filter((item) => (teacherDrafts[item.id] ?? '').trim().length > 0);
    if (!rows.length) {
      setMissingMessage('No hay IDs diligenciados para guardar.');
      return;
    }

    for (const row of rows) {
      try {
        setSavingMap((prev) => ({ ...prev, [row.id]: true }));
        // Secuencial para evitar choques de estado en pantalla.
        // eslint-disable-next-line no-await-in-loop
        await assignTeacherForCourse(row.id, teacherDrafts[row.id] ?? '');
      } catch {
        // continua con el siguiente registro y reporta al final
      } finally {
        setSavingMap((prev) => ({ ...prev, [row.id]: false }));
      }
    }
    setMissingMessage(`Intento de guardado masivo finalizado para ${rows.length} NRC.`);
    await loadMissingTeacher();
  }

  return (
    <article className="panel">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Carga RPACA</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem' }}>
            Importa archivos CSV RPACA, valida contra Banner y resuelve docentes faltantes.
          </p>
        </div>
        <div className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted, #6b7280)' }}>
            {rpacaFiles.length ? (
              <span className="badge" style={{ marginRight: 6 }}>{rpacaFiles.length} archivo{rpacaFiles.length > 1 ? 's' : ''}</span>
            ) : null}
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              style={{ display: 'none' }}
              onChange={(event) => setRpacaFiles(Array.from(event.target.files ?? []))}
              id="rpaca-file-input"
            />
            <span
              role="button"
              tabIndex={0}
              onClick={() => document.getElementById('rpaca-file-input')?.click()}
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('rpaca-file-input')?.click()}
              style={{ cursor: 'pointer', textDecoration: 'underline', userSelect: 'none' }}
            >
              Elegir CSV
            </span>
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void importRpaca()}
            disabled={importLoading}
            style={{ fontWeight: 600 }}
          >
            {importLoading ? 'Importando...' : 'Importar CSV'}
          </button>
        </div>
      </div>

      {/* ── Upload zone / opciones ──────────────────────────────── */}
      <div className="panel" style={{ background: 'var(--surface-subtle, #f9fafb)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
            <input
              type="checkbox"
              checked={preserveTeacherAssignment}
              onChange={(event) => setPreserveTeacherAssignment(event.target.checked)}
            />
            Conservar docente actual si RPACA viene sin docente
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
            <input type="checkbox" checked={createOnly} onChange={(event) => setCreateOnly(event.target.checked)} />
            Solo crear NRC nuevos (no actualizar existentes)
          </label>
        </div>

        {/* Flash de resultado de importacion */}
        {importMessage ? (
          <div
            className={importMessage.startsWith('Error') ? 'flash chip-alert' : 'flash chip-ok'}
            style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, fontSize: '0.8125rem', lineHeight: 1.5 }}
          >
            {importMessage}
          </div>
        ) : null}

        {importResult?.historyRelativePath ? (
          <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>
            Historial: <span className="chip" style={{ fontFamily: 'monospace' }}>{importResult.historyRelativePath}</span>
          </div>
        ) : null}

        {importResult?.errors?.length ? (
          <div className="flash chip-alert" style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, fontSize: '0.8rem' }}>
            Errores (muestra): {importResult.errors.slice(0, 5).join(' | ')}
          </div>
        ) : null}
      </div>

      {/* ── Stats de importacion ────────────────────────────────── */}
      {importResult ? (
        <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
          <div className="stat-card" style={{ background: 'var(--surface-subtle, #f0fdf4)', border: '1px solid var(--border, #bbf7d0)', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-success, #16a34a)' }}>{importResult.createdCourses}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', marginTop: 2 }}>NRC creados</div>
          </div>
          <div className="stat-card" style={{ background: 'var(--surface-subtle, #eff6ff)', border: '1px solid var(--border, #bfdbfe)', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-info, #2563eb)' }}>{importResult.updatedCourses}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', marginTop: 2 }}>NRC actualizados</div>
          </div>
          <div className="stat-card" style={{ background: 'var(--surface-subtle, #fafafa)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)' }}>{importResult.skippedRows}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', marginTop: 2 }}>Filas omitidas</div>
          </div>
        </div>
      ) : null}

      <div className="divider" style={{ height: 1, background: 'var(--border, #e5e7eb)', margin: '4px 0 18px' }} />

      {/* ── Pipeline Banner (colapsable) ────────────────────────── */}
      <details className="disclosure" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9375rem', padding: '8px 0', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          Pipeline Banner
          {pipelineSummary ? (
            <span className="badge" style={{ fontWeight: 400, fontSize: '0.8rem' }}>
              {pipelineSummary.bannerFound} encontrados / {pipelineSummary.bannerNoEncontrado} no encontrados
            </span>
          ) : null}
        </summary>

        <div style={{ paddingTop: 12 }}>
          {/* Opciones del pipeline */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
              <input
                type="checkbox"
                checked={runBannerAfterImport}
                onChange={(event) => setRunBannerAfterImport(event.target.checked)}
              />
              Ejecutar Banner automaticamente al terminar importacion RPACA
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
              <input
                type="checkbox"
                checked={deactivateBannerNotFound}
                onChange={(event) => setDeactivateBannerNotFound(event.target.checked)}
                disabled={!runBannerAfterImport}
              />
              Descartar del sistema los NRC no encontrados en Banner
            </label>
          </div>

          {/* Resumen del pipeline si existe */}
          {pipelineSummary ? (
            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
              <div className="stat-card" style={{ background: 'var(--surface-subtle, #f0fdf4)', border: '1px solid var(--border, #bbf7d0)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-success, #16a34a)' }}>{pipelineSummary.bannerFound}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', marginTop: 2 }}>Banner encontrados</div>
              </div>
              <div className="stat-card" style={{ background: 'var(--surface-subtle, #fff7ed)', border: '1px solid var(--border, #fed7aa)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-warning, #ea580c)' }}>{pipelineSummary.bannerNoEncontrado}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', marginTop: 2 }}>No encontrados</div>
              </div>
              <div className="stat-card" style={{ background: 'var(--surface-subtle, #fafafa)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-muted, #6b7280)' }}>{pipelineSummary.systemDeactivated}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', marginTop: 2 }}>Descartados del sistema</div>
              </div>
            </div>
          ) : null}

          {pipelineSummary?.latestBannerFile ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>
              Ultimo archivo Banner: <span style={{ fontFamily: 'monospace' }}>{pipelineSummary.latestBannerFile}</span>
            </div>
          ) : null}

          {/* Selector de periodos para filtrar tabla de faltantes */}
          {periodOptions.length ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 6 }}>
                Periodos para tabla de faltantes:
              </div>
              <div className="toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <button type="button" onClick={() => setSelectedPeriodCodes([])} style={{ fontSize: '0.8rem' }}>
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPeriodCodes(periodOptions.map((p) => p.code))}
                  disabled={!periodOptions.length}
                  style={{ fontSize: '0.8rem' }}
                >
                  Marcar todos
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPeriodCodes(periodOptions[0]?.code ? [periodOptions[0].code] : [])}
                  disabled={!periodOptions.length}
                  style={{ fontSize: '0.8rem' }}
                >
                  Solo ultimo
                </button>
                <span className="divider" style={{ width: 1, height: 18, background: 'var(--border, #e5e7eb)', display: 'inline-block', margin: '0 4px' }} />
                {periodOptions.map((period) => {
                  const active = selectedPeriodCodes.includes(period.code);
                  return (
                    <button
                      key={`missing-period-${period.code}`}
                      type="button"
                      style={{
                        fontSize: '0.8rem',
                        ...(active
                          ? {
                              borderColor: 'var(--border-strong, #1f2937)',
                              background: 'var(--surface-strong, #eef2ff)',
                              fontWeight: 600,
                            }
                          : undefined),
                      }}
                      onClick={() => setSelectedPeriodCodes((current) => toggleSelection(current, period.code))}
                    >
                      {period.code}
                    </button>
                  );
                })}
              </div>
              {selectedPeriodCodes.length ? (
                <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>
                  Filtrando {selectedPeriodCodes.length} periodo(s): {selectedPeriodCodes.join(', ')}
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>
                  Sin seleccion manual: se muestran todos los periodos cargados por RPACA.
                </div>
              )}
            </div>
          ) : null}

          {recentPeriodsTouched.length > 1 ? (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-muted, #6b7280)' }}>Periodos tocados en esta carga:</span>
              {recentPeriodsTouched.map((period) => (
                <button
                  key={`recent-period-${period}`}
                  type="button"
                  onClick={() => setSelectedPeriodCodes([period])}
                  style={{ fontSize: '0.8rem' }}
                >
                  {period}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </details>

      <div className="divider" style={{ height: 1, background: 'var(--border, #e5e7eb)', margin: '4px 0 18px' }} />

      {/* ── Docentes faltantes ──────────────────────────────────── */}
      <section>
        {/* Header de seccion con badge y toolbar */}
        <div className="panel-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Docentes faltantes</span>
            {missingResult ? (
              <span className="badge" style={{ fontSize: '0.8rem' }}>{missingResult.total}</span>
            ) : null}
          </div>
          <div className="toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="primary"
              onClick={() => void saveAllDrafts()}
              disabled={missingLoading || !missingResult?.items?.length || rowsWithDraft === 0}
              style={{ fontSize: '0.8125rem' }}
            >
              Guardar todos ({rowsWithDraft})
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void loadMissingTeacher()}
              disabled={missingLoading}
              style={{ fontWeight: 600, fontSize: '0.8125rem' }}
            >
              {missingLoading ? 'Cargando...' : 'Buscar'}
            </button>
          </div>
        </div>

        {/* Filtros inline */}
        <div className="form-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar NRC / asignatura..."
            style={{ flex: '1 1 200px', minWidth: 160, fontSize: '0.875rem' }}
          />
          <select
            value={momentFilter}
            onChange={(event) => setMomentFilter(event.target.value)}
            style={{ fontSize: '0.875rem', minWidth: 130 }}
          >
            <option value="">Todos los momentos</option>
            <option value="MD1">M1 (MD1 / RY1)</option>
            <option value="MD2">M2 (MD2 / RY2)</option>
            <option value="1">RYC (1)</option>
          </select>
          <input
            value={missingLimit}
            onChange={(event) => setMissingLimit(event.target.value)}
            placeholder="Limite"
            style={{ width: 72, fontSize: '0.875rem' }}
          />
        </div>

        {/* Mensaje de estado */}
        {missingMessage ? (
          <div
            className={missingMessage.startsWith('No fue') ? 'flash chip-alert' : 'flash chip-ok'}
            style={{ marginBottom: 10, padding: '7px 12px', borderRadius: 6, fontSize: '0.8125rem' }}
          >
            {missingMessage}
          </div>
        ) : null}

        {/* Tabla */}
        {missingResult ? (
          <div className="table-wrap" style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8 }}>
            <table className="compact-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-subtle, #f9fafb)', zIndex: 1 }}>
                <tr>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)', whiteSpace: 'nowrap', fontWeight: 600 }}>NRC</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)', whiteSpace: 'nowrap', fontWeight: 600 }}>Periodo</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600 }}>Asignatura</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600 }}>Docente asignado</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)', whiteSpace: 'nowrap', fontWeight: 600 }}>Motivo</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600, minWidth: 140 }}>ID docente manual</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)', fontWeight: 600 }}>Accion</th>
                </tr>
              </thead>
              <tbody>
                {missingResult.items.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{ background: idx % 2 === 0 ? 'transparent' : 'var(--surface-subtle, #f9fafb)' }}
                  >
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #f3f4f6)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{item.nrc}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #f3f4f6)', whiteSpace: 'nowrap' }}>{item.periodCode}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #f3f4f6)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.subjectName ?? item.programCode ?? item.programName ?? '-'}
                    </td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #f3f4f6)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.preferredTeacherName ?? item.currentTeacherName ?? (
                        <span style={{ color: 'var(--text-muted, #9ca3af)' }}>Sin docente</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #f3f4f6)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(item.missingReasons ?? []).join(' | ') || '-'}
                    </td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                      <input
                        value={teacherDrafts[item.id] ?? ''}
                        onChange={(event) =>
                          setTeacherDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))
                        }
                        placeholder="ID docente"
                        style={{ width: '100%', fontSize: '0.8125rem', padding: '4px 6px' }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #f3f4f6)', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void saveTeacher(item.id)}
                        disabled={!!savingMap[item.id] || !(teacherDrafts[item.id] ?? '').trim()}
                        style={{ fontSize: '0.8rem' }}
                      >
                        {savingMap[item.id] ? 'Guardando...' : 'Guardar'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!missingResult.items.length ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted, #6b7280)' }}>
                      No hay NRC con faltantes para ese filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="divider" style={{ height: 1, background: 'var(--border, #e5e7eb)', margin: '18px 0' }} />

      {/* ── Deactivacion (colapsable) ───────────────────────────── */}
      <details className="disclosure">
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.9375rem', padding: '8px 0', userSelect: 'none', color: 'var(--color-danger, #dc2626)' }}>
          Deactivar cursos sin Banner
        </summary>
        <div style={{ paddingTop: 12, fontSize: '0.875rem', color: 'var(--text-muted, #6b7280)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 10px' }}>
            Esta accion descarta del sistema los NRC que Banner haya marcado como{' '}
            <span style={{ fontFamily: 'monospace', background: 'var(--surface-subtle, #f3f4f6)', padding: '1px 5px', borderRadius: 3 }}>NO_ENCONTRADO</span>.
            Solo aplica a los periodos actualmente seleccionados. La operacion es irreversible sin restauracion manual.
          </p>
          <p style={{ margin: '0 0 12px' }}>
            El flujo automatico posterior a la importacion RPACA ya ejecuta esta accion si la opcion esta activada en
            la seccion Pipeline Banner. Usa este boton solo si necesitas deactivar manualmente despues de una corrida Banner independiente.
          </p>
          <div className="toolbar" style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              style={{ color: 'var(--color-danger, #dc2626)', borderColor: 'var(--color-danger, #dc2626)', fontSize: '0.875rem' }}
              onClick={() => {
                if (
                  window.confirm(
                    'Confirmas la deactivacion de todos los NRC marcados como NO_ENCONTRADO en Banner para los periodos seleccionados?',
                  )
                ) {
                  void runBannerPipelineForPeriods(selectedPeriodCodes.length ? selectedPeriodCodes : []);
                }
              }}
              disabled={importLoading}
            >
              Deactivar NRC no encontrados
            </button>
          </div>
        </div>
      </details>

    </article>
  );
}
