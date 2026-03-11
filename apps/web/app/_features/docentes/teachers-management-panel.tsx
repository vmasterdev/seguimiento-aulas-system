'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type TeachersManagementPanelProps = {
  apiBase: string;
};

type TeacherItem = {
  id: string;
  sourceId: string | null;
  documentId: string | null;
  fullName: string;
  email: string | null;
  costCenter: string | null;
  coordination: string | null;
  campus: string | null;
  region: string | null;
};

type TeachersListResult = {
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  items: TeacherItem[];
};

type TeachersImportResult = {
  ok: boolean;
  files: number;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type ManualTeacherForm = {
  id: string;
  sourceId: string;
  documentId: string;
  fullName: string;
  email: string;
  campus: string;
  region: string;
  costCenter: string;
  coordination: string;
};

const EMPTY_FORM: ManualTeacherForm = {
  id: '',
  sourceId: '',
  documentId: '',
  fullName: '',
  email: '',
  campus: '',
  region: '',
  costCenter: '',
  coordination: '',
};

export function TeachersManagementPanel({ apiBase }: TeachersManagementPanelProps) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState('150');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<TeachersListResult | null>(null);

  const [form, setForm] = useState<ManualTeacherForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [csvFiles, setCsvFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<TeachersImportResult | null>(null);

  useEffect(() => {
    void loadTeachers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTeachers() {
    try {
      setLoading(true);
      setMessage('');
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (limit.trim()) params.set('limit', limit.trim());
      const data = await fetchJson<TeachersListResult>(`${apiBase}/teachers?${params.toString()}`);
      setResult(data);
    } catch (error) {
      setMessage(`No fue posible cargar la tabla de docentes: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveTeacher() {
    if (!form.fullName.trim()) {
      setMessage('Debes diligenciar el nombre del docente.');
      return;
    }
    if (!form.id.trim() && !form.sourceId.trim() && !form.documentId.trim()) {
      setMessage('Debes diligenciar al menos ID, sourceId o documentId.');
      return;
    }

    try {
      setSaving(true);
      setMessage('');
      await fetchJson(`${apiBase}/teachers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setMessage('Docente guardado correctamente.');
      setForm(EMPTY_FORM);
      await loadTeachers();
    } catch (error) {
      setMessage(`No fue posible guardar docente: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function importCsvTeachers() {
    if (!csvFiles.length) {
      setMessage('Selecciona al menos un CSV de docentes.');
      return;
    }

    try {
      setImporting(true);
      setMessage('');
      const formData = new FormData();
      csvFiles.forEach((file) => formData.append('files', file, file.name));
      const data = await fetchJson<TeachersImportResult>(`${apiBase}/teachers/import-csv`, {
        method: 'POST',
        body: formData,
      });
      setImportResult(data);
      setMessage('Carga masiva de docentes finalizada.');
      await loadTeachers();
    } catch (error) {
      setMessage(`No fue posible importar docentes: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <article className="panel">
      <h2>Base de datos de docentes</h2>

      <div className="subtitle">1) Tabla de docentes</div>
      <div className="controls">
        <label>
          Buscar
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="ID, nombre, correo..." />
        </label>
        <label>
          Limite
          <input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="150" />
        </label>
        <button type="button" onClick={() => void loadTeachers()} disabled={loading}>
          {loading ? 'Cargando...' : 'Actualizar tabla'}
        </button>
      </div>

      {result ? (
        <>
          <div className="actions">
            Total docentes: <span className="code">{result.total}</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>sourceId</th>
                  <th>documentId</th>
                  <th>Coordinacion</th>
                  <th>Centro costo</th>
                  <th>Campus</th>
                  <th>Region</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.fullName}</td>
                    <td>{item.email ?? '-'}</td>
                    <td>{item.sourceId ?? '-'}</td>
                    <td>{item.documentId ?? '-'}</td>
                    <td>{item.coordination ?? '-'}</td>
                    <td>{item.costCenter ?? '-'}</td>
                    <td>{item.campus ?? '-'}</td>
                    <td>{item.region ?? '-'}</td>
                  </tr>
                ))}
                {!result.items.length ? (
                  <tr>
                    <td colSpan={9}>No hay docentes para este filtro.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="subtitle" style={{ marginTop: 14 }}>
        2) Agregar/actualizar docente manualmente
      </div>
      <div className="controls">
        <label>
          ID docente
          <input value={form.id} onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))} />
        </label>
        <label>
          sourceId
          <input
            value={form.sourceId}
            onChange={(event) => setForm((prev) => ({ ...prev, sourceId: event.target.value }))}
          />
        </label>
        <label>
          documentId
          <input
            value={form.documentId}
            onChange={(event) => setForm((prev) => ({ ...prev, documentId: event.target.value }))}
          />
        </label>
        <label style={{ minWidth: 260 }}>
          Nombre
          <input
            value={form.fullName}
            onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
          />
        </label>
        <label style={{ minWidth: 240 }}>
          Correo
          <input value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
        </label>
        <label>
          Campus
          <input
            value={form.campus}
            onChange={(event) => setForm((prev) => ({ ...prev, campus: event.target.value }))}
          />
        </label>
        <label>
          Region
          <input
            value={form.region}
            onChange={(event) => setForm((prev) => ({ ...prev, region: event.target.value }))}
          />
        </label>
        <label>
          Centro costo
          <input
            value={form.costCenter}
            onChange={(event) => setForm((prev) => ({ ...prev, costCenter: event.target.value }))}
          />
        </label>
        <label style={{ minWidth: 220 }}>
          Coordinacion
          <input
            value={form.coordination}
            onChange={(event) => setForm((prev) => ({ ...prev, coordination: event.target.value }))}
          />
        </label>
        <button type="button" onClick={() => void saveTeacher()} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar docente'}
        </button>
      </div>

      <div className="subtitle" style={{ marginTop: 14 }}>
        3) Carga masiva de docentes (CSV)
      </div>
      <div className="controls">
        <label style={{ minWidth: 340 }}>
          Archivos CSV docentes
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(event) => setCsvFiles(Array.from(event.target.files ?? []))}
          />
        </label>
        <button type="button" onClick={() => void importCsvTeachers()} disabled={importing}>
          {importing ? 'Importando...' : 'Importar CSV docentes'}
        </button>
      </div>
      {csvFiles.length ? (
        <div className="actions">
          Archivos seleccionados: <span className="code">{csvFiles.length}</span>
        </div>
      ) : null}
      {importResult ? (
        <div className="badges" style={{ marginTop: 8 }}>
          <span className="badge">Filas: {importResult.totalRows}</span>
          <span className="badge">Nuevos: {importResult.created}</span>
          <span className="badge">Actualizados: {importResult.updated}</span>
          <span className="badge">Omitidos: {importResult.skipped}</span>
        </div>
      ) : null}
      {importResult?.errors?.length ? (
        <div className="actions" style={{ marginTop: 8 }}>
          Errores (muestra): {importResult.errors.slice(0, 5).join(' | ')}
        </div>
      ) : null}

      {message ? <div className="message">{message}</div> : null}
    </article>
  );
}
