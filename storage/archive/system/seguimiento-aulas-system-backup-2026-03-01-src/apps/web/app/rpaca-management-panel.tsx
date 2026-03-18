'use client';

import { useMemo, useState } from 'react';
import { useEffect } from 'react';

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
  periodsTouched: string[];
  errors: string[];
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
  sourceTeacherId: string | null;
  sourceDocumentId: string | null;
  sourceTeacherName: string | null;
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
  items: MissingTeacherItem[];
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T & { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join('; ')
      : (data?.message ?? `HTTP ${response.status}`);
    throw new Error(message);
  }
  return data;
}

export function RpacaManagementPanel({ apiBase }: RpacaManagementPanelProps) {
  const [rpacaFiles, setRpacaFiles] = useState<File[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportCsvResult | null>(null);
  const [importMessage, setImportMessage] = useState('');

  const [periodCode, setPeriodCode] = useState('202615');
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

  async function importRpaca() {
    if (!rpacaFiles.length) {
      setImportMessage('Selecciona al menos un archivo RPACA (.csv).');
      return;
    }

    try {
      setImportLoading(true);
      setImportMessage('');
      const formData = new FormData();
      rpacaFiles.forEach((file) => formData.append('files', file, file.name));

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
      setImportMessage('RPACA importado correctamente.');
      await loadMissingTeacher();
    } catch (error) {
      setImportMessage(`Error importando RPACA: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImportLoading(false);
    }
  }

  async function loadMissingTeacher() {
    try {
      setMissingLoading(true);
      setMissingMessage('');
      const params = new URLSearchParams();
      if (periodCode.trim()) params.set('periodCode', periodCode.trim());
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
          next[item.id] = item.sourceTeacherId || item.sourceDocumentId || '';
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

      <div className="subtitle">1) Cargar nuevos RPACA (incremental)</div>
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
          <span className="badge">Periodos: {(importResult.periodsTouched ?? []).join(', ') || 'N/A'}</span>
        </div>
      ) : null}
      {importResult?.errors?.length ? (
        <div className="actions" style={{ marginTop: 8 }}>
          Errores (muestra): {importResult.errors.slice(0, 5).join(' | ')}
        </div>
      ) : null}

      <div className="subtitle" style={{ marginTop: 14 }}>
        2) Tabla de NRC con faltantes en RPACA (ID_DOCENTE o NOMBRE_DOCENTE) y/o sin docente en sistema
      </div>
      <div className="controls">
        <label>
          Periodo
          <input value={periodCode} onChange={(event) => setPeriodCode(event.target.value)} placeholder="202615" />
        </label>
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
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Periodo</th>
                  <th>Programa</th>
                  <th>Asignatura</th>
                  <th>Docente (fuente)</th>
                  <th>ID fuente</th>
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
                    <td>{item.sourceTeacherName ?? '-'}</td>
                    <td>{item.sourceTeacherId ?? item.sourceDocumentId ?? '-'}</td>
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
                    <td colSpan={9}>No hay NRC con faltantes para ese filtro.</td>
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
