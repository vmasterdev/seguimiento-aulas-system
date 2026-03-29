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
      <h2>Gestion RPACA y faltantes de docente</h2>

      <div className="subtitle">1) Cargar nuevos RPACA (incremental seguro)</div>
      <div className="actions" style={{ marginTop: 6 }}>
        Esta importacion ya no borra metadata operativa del curso. Puedes conservar el docente actual si RPACA llega incompleto y, si quieres, limitarte a crear NRC nuevos sin tocar los existentes.
        <br />
        Cuando llegue un periodo nuevo, por ejemplo <span className="code">202765</span>, el sistema lo crea en la base
        automaticamente y los NRC quedan manejados con el prefijo correcto del periodo, por ejemplo{' '}
        <span className="code">65-xxxxx</span>.
      </div>
      <div className="controls">
        <label style={{ minWidth: 340 }}>
          Archivos CSV RPACA
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(event) => setRpacaFiles(Array.from(event.target.files ?? []))}
          />
        </label>
        <button type="button" onClick={() => void importRpaca()} disabled={importLoading}>
          {importLoading ? 'Importando...' : 'Importar RPACA'}
        </button>
      </div>
      <div className="controls" style={{ marginTop: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 360 }}>
          <input
            type="checkbox"
            checked={preserveTeacherAssignment}
            onChange={(event) => setPreserveTeacherAssignment(event.target.checked)}
          />
          Conservar docente actual si RPACA viene sin docente
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
          <input type="checkbox" checked={createOnly} onChange={(event) => setCreateOnly(event.target.checked)} />
          Solo crear NRC nuevos
        </label>
      </div>
      <div className="subtitle" style={{ marginTop: 12 }}>
        1.1) Flujo automatico despues de importar
      </div>
      <div className="actions" style={{ marginTop: 6 }}>
        Si activas este flujo, al terminar RPACA el sistema lanza Banner sobre los periodos tocados, importa el
        resultado y descarta del sistema los NRC que Banner marque como <span className="code">NO_ENCONTRADO</span>.
        Los NRC encontrados quedan listos para pasar a la revision visual de tipo de aulas en Moodle.
      </div>
      <div className="controls" style={{ marginTop: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 340 }}>
          <input
            type="checkbox"
            checked={runBannerAfterImport}
            onChange={(event) => setRunBannerAfterImport(event.target.checked)}
          />
          Ejecutar Banner automaticamente al terminar RPACA
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 360 }}>
          <input
            type="checkbox"
            checked={deactivateBannerNotFound}
            onChange={(event) => setDeactivateBannerNotFound(event.target.checked)}
            disabled={!runBannerAfterImport}
          />
          Descartar del sistema los NRC no encontrados en Banner
        </label>
        <div className="actions" style={{ minWidth: 240 }}>
          Banner corre en modo estable con <span className="code">1 worker</span>.
        </div>
      </div>
      {rpacaFiles.length ? (
        <div className="actions">
          Archivos seleccionados: <span className="code">{rpacaFiles.length}</span>
        </div>
      ) : null}
      {importMessage ? <div className="message">{importMessage}</div> : null}
      {importResult ? (
        <div className="badges" style={{ marginTop: 8 }}>
          <span className="badge">Filas: {importResult.totalRows}</span>
          <span className="badge">NRC nuevos: {importResult.createdCourses}</span>
          <span className="badge">NRC actualizados: {importResult.updatedCourses}</span>
          <span className="badge">Filas omitidas: {importResult.skippedRows}</span>
          <span className="badge">Filas con error: {importResult.failedRows ?? 0}</span>
          <span className="badge">Existentes sin tocar: {importResult.skippedExistingCourses}</span>
          <span className="badge">Docentes preservados: {importResult.preservedTeacherAssignments}</span>
          <span className="badge">Periodos: {(importResult.periodsTouched ?? []).join(', ') || 'N/A'}</span>
        </div>
      ) : null}
      {recentPeriodsTouched.length > 1 ? (
        <div className="actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          Periodos tocados en esta carga:
          {recentPeriodsTouched.map((period) => (
            <button
              key={`recent-period-${period}`}
              type="button"
              onClick={() => setSelectedPeriodCodes([period])}
            >
              {period}
            </button>
          ))}
        </div>
      ) : null}
      {importResult?.historyRelativePath ? (
        <div className="actions" style={{ marginTop: 8 }}>
          Historial guardado: <span className="code">{importResult.historyRelativePath}</span>
        </div>
      ) : null}
      {pipelineSummary ? (
        <div className="badges" style={{ marginTop: 8 }}>
          <span className="badge">Banner consultados: {pipelineSummary.bannerBatchTotal}</span>
          <span className="badge">Banner encontrados: {pipelineSummary.bannerFound}</span>
          <span className="badge">Banner no encontrados: {pipelineSummary.bannerNoEncontrado}</span>
          <span className="badge">Descartados del sistema: {pipelineSummary.systemDeactivated}</span>
          <span className="badge">Listos para Moodle: {pipelineSummary.readyForMoodle}</span>
        </div>
      ) : null}
      {pipelineSummary?.latestBannerFile ? (
        <div className="actions" style={{ marginTop: 8 }}>
          Ultimo archivo Banner usado: <span className="code">{pipelineSummary.latestBannerFile}</span>
        </div>
      ) : null}
      {importResult?.errors?.length ? (
        <div className="actions" style={{ marginTop: 8 }}>
          Errores (muestra): {importResult.errors.slice(0, 5).join(' | ')}
        </div>
      ) : null}

      <div className="subtitle" style={{ marginTop: 14 }}>
        2) Tabla de NRC pendientes por resolver en RPACA o sistema
      </div>
      <div className="actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <span>Periodos RPACA para esta tabla:</span>
        <button type="button" onClick={() => setSelectedPeriodCodes([])}>
          Ver todos
        </button>
        <button
          type="button"
          onClick={() => setSelectedPeriodCodes(periodOptions.map((period) => period.code))}
          disabled={!periodOptions.length}
        >
          Marcar todos
        </button>
        <button
          type="button"
          onClick={() => setSelectedPeriodCodes(periodOptions[0]?.code ? [periodOptions[0].code] : [])}
          disabled={!periodOptions.length}
        >
          Solo ultimo
        </button>
      </div>
      {periodOptions.length ? (
        <div className="actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {periodOptions.map((period) => {
            const active = selectedPeriodCodes.includes(period.code);
            return (
              <button
                key={`missing-period-${period.code}`}
                type="button"
                style={
                  active
                    ? {
                        borderColor: 'var(--border-strong, #1f2937)',
                        background: 'var(--surface-strong, #eef2ff)',
                        fontWeight: 600,
                      }
                    : undefined
                }
                onClick={() => setSelectedPeriodCodes((current) => toggleSelection(current, period.code))}
              >
                {period.code}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="actions" style={{ marginTop: 8 }}>
        {selectedPeriodCodes.length
          ? `Filtrando ${selectedPeriodCodes.length} periodo(s): ${selectedPeriodCodes.join(', ')}`
          : 'Sin seleccion manual: se muestran todos los periodos cargados por RPACA.'}
      </div>
      <div className="controls">
        <label>
          Momento
          <select value={momentFilter} onChange={(event) => setMomentFilter(event.target.value)}>
            <option value="">Todos</option>
            <option value="MD1">M1 (MD1 / RY1)</option>
            <option value="MD2">M2 (MD2 / RY2)</option>
            <option value="1">RYC (1)</option>
          </select>
        </label>
        <label style={{ minWidth: 220 }}>
          Buscar NRC / asignatura
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="15-72..." />
        </label>
        <label>
          Limite
          <input value={missingLimit} onChange={(event) => setMissingLimit(event.target.value)} placeholder="150" />
        </label>
        <button type="button" onClick={() => void loadMissingTeacher()} disabled={missingLoading}>
          {missingLoading ? 'Cargando...' : 'Cargar NRC con faltantes'}
        </button>
        <button
          type="button"
          onClick={() => void saveAllDrafts()}
          disabled={missingLoading || !missingResult?.items?.length || rowsWithDraft === 0}
        >
          Guardar todos ({rowsWithDraft})
        </button>
      </div>
      {missingMessage ? <div className="message">{missingMessage}</div> : null}

      {missingResult ? (
        <>
          <div className="actions">
            NRC con faltantes detectados: <span className="code">{missingResult.total}</span>
          </div>
          <div className="actions" style={{ marginTop: 6 }}>
            Los NRC ya resueltos por Banner no se muestran aqui. Si Banner trae docente, se prioriza sobre RPACA.
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Periodo</th>
                  <th>Programa</th>
                  <th>Asignatura</th>
                  <th>Docente priorizado</th>
                  <th>Fuente</th>
                  <th>Banner</th>
                  <th>RPACA</th>
                  <th>Motivo faltante</th>
                  <th>ID docente manual</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {missingResult.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.nrc}</td>
                    <td>{item.periodCode}</td>
                    <td>{item.programCode ?? item.programName ?? '-'}</td>
                    <td>{item.subjectName ?? '-'}</td>
                    <td>{item.preferredTeacherName ?? item.currentTeacherName ?? 'Sin docente'}</td>
                    <td>{item.preferredSource ?? '-'}</td>
                    <td>
                      {item.bannerTeacherName || item.bannerTeacherId
                        ? `${item.bannerTeacherName ?? '-'} (${item.bannerTeacherId ?? '-'})`
                        : (item.bannerStatus ?? '-')}
                    </td>
                    <td>
                      {item.sourceTeacherName || item.sourceTeacherId || item.sourceDocumentId
                        ? `${item.sourceTeacherName ?? '-'} (${item.sourceTeacherId ?? item.sourceDocumentId ?? '-'})`
                        : '-'}
                    </td>
                    <td>{(item.missingReasons ?? []).join(' | ') || '-'}</td>
                    <td>
                      <input
                        value={teacherDrafts[item.id] ?? ''}
                        onChange={(event) =>
                          setTeacherDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))
                        }
                        placeholder="ID docente"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void saveTeacher(item.id)}
                        disabled={!!savingMap[item.id] || !(teacherDrafts[item.id] ?? '').trim()}
                      >
                        {savingMap[item.id] ? 'Guardando...' : 'Guardar ID'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!missingResult.items.length ? (
                  <tr>
                    <td colSpan={11}>No hay NRC con faltantes para ese filtro.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </article>
  );
}
