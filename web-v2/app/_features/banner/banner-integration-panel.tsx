'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type BannerMode = 'lookup' | 'batch' | 'retry-errors' | 'export';
type BatchInputMode = 'DATABASE' | 'MANUAL_INPUT';
type BannerBatchSource = 'ALL' | 'MISSING_TEACHER' | 'PENDING_BANNER';

type BannerRunnerRun = {
  id: string;
  command: BannerMode;
  args: string[];
  startedAt: string;
  endedAt?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  exitCode?: number | null;
  pid?: number;
  logPath: string;
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
    }>;
  };
};

type BannerActionResponse = {
  ok: boolean;
  action: string;
  result?: unknown;
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

export function BannerIntegrationPanel() {
  const [status, setStatus] = useState<BannerStatusResponse | null>(null);
  const [batchOptions, setBatchOptions] = useState<BannerBatchOptions | null>(null);
  const [batchPreview, setBatchPreview] = useState<BannerBatchPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [importResult, setImportResult] = useState<unknown>(null);

  const [mode, setMode] = useState<BannerMode>('batch');
  const [batchInputMode, setBatchInputMode] = useState<BatchInputMode>('DATABASE');
  const [batchSource, setBatchSource] = useState<BannerBatchSource>('MISSING_TEACHER');
  const [selectedPeriodCodes, setSelectedPeriodCodes] = useState<string[]>([]);

  const [nrc, setNrc] = useState('72305');
  const [period, setPeriod] = useState('202615');
  const [queryName, setQueryName] = useState('banner-rpaca');
  const [inputPath, setInputPath] = useState('');
  const [workers, setWorkers] = useState('3');
  const [resume, setResume] = useState(false);
  const [queryId, setQueryId] = useState('');
  const [exportFormat, setExportFormat] = useState('csv,json');
  const [importPath, setImportPath] = useState('');

  const canStart = useMemo(() => !status?.runner.running && !actionLoading, [status?.runner.running, actionLoading]);
  const latestPreviewQueryId = status?.exportSummary.preview[0]?.queryId ?? '';
  const currentModeHelp = MODE_HELP[mode];
  const latestYear = batchOptions?.defaults.latestYear ?? null;

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
    if (!queryId.trim() && latestPreviewQueryId) {
      setQueryId(latestPreviewQueryId);
    }
  }, [latestPreviewQueryId, queryId]);

  useEffect(() => {
    setBatchPreview(null);
  }, [selectedPeriodCodes, batchSource, batchInputMode]);

  async function runAction(action: 'start' | 'cancel' | 'import', payload?: Record<string, unknown>) {
    return fetchJson<BannerActionResponse>('/api/banner/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload: payload ?? {} }),
    });
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

  async function startBanner() {
    try {
      setActionLoading(true);
      setMessage('');
      setImportResult(null);

      if (mode === 'batch' && batchInputMode === 'DATABASE') {
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
            workers: Number(workers) || 1,
            resume,
          }),
        });

        setMessage(parseStartMessage(response));
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
          queryId: queryId || undefined,
          workers: Number(workers) || 1,
          resume,
        });
        setMessage('Lote Banner manual en ejecucion.');
      } else if (mode === 'retry-errors') {
        await runAction('start', {
          command: 'retry-errors',
          queryId,
          workers: Number(workers) || 1,
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

      <div className="actions" style={{ marginTop: 8 }}>
        <span className="code">Proyecto externo: {status?.projectRoot ?? 'N/A'}</span>
        <br />
        <span className="code">Ultimo archivo exportado: {basename(status?.exportSummary.latestFile)}</span>
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
            Workers
            <input value={workers} onChange={(event) => setWorkers(event.target.value)} placeholder="3" />
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
        <button onClick={startBanner} disabled={!canStart}>
          {actionLoading ? 'Procesando...' : START_BUTTON_LABELS[mode]}
        </button>
        <button onClick={cancelBanner} disabled={!status?.runner.running || actionLoading}>
          Cancelar proceso Banner
        </button>
      </div>

      <div className="subtitle">Paso 3. Revisar el ultimo export generado</div>
      <div className="badges">
        {Object.entries(status?.exportSummary.statusCounts ?? {}).map(([key, value]) => (
          <span className="badge" key={key}>
            {key}: {value}
          </span>
        ))}
      </div>
      <div className="actions" style={{ marginTop: 8 }}>
        Usa este bloque para validar si Banner encontro docentes, si quedaron errores y cual fue el archivo mas reciente.
      </div>
      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>NRC</th>
            <th>Periodo</th>
            <th>Docente</th>
            <th>ID docente</th>
            <th>Estado</th>
            <th>Fecha</th>
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
              <td>{item.checkedAt ?? '-'}</td>
            </tr>
          ))}
          {!status?.exportSummary.preview?.length ? (
            <tr>
              <td colSpan={6}>Aun no hay una exportacion Banner disponible.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

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
