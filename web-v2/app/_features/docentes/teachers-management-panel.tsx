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

type CoordinatorItem = {
  id: string;
  programId: string;
  programKey: string;
  fullName: string;
  email: string;
  campus: string | null;
  region: string | null;
  sourceSheet: string | null;
};

type CoordinatorsListResult = {
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  items: CoordinatorItem[];
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

type TeachersWorkbookImportResult = {
  ok: boolean;
  source: string;
  sheetsProcessed: string[];
  coordinatorSheetsProcessed: string[];
  createdTeachers: number;
  updatedTeachers: number;
  skippedRows: number;
  createdCoordinators: number;
  updatedCoordinators: number;
  skippedCoordinatorRows: number;
};

type SpaidenSyncResult = {
  ok: boolean;
  scope: 'teachers' | 'coordinators' | 'students' | 'all';
  startedAt: string;
  finishedAt: string;
  candidates: {
    teachers: number;
    coordinators: number;
    students: number;
    personIds: number;
  };
  skipped: {
    teachersWithoutId: number;
    coordinatorsWithoutMatch: number;
    studentsWithoutId: number;
  };
  preSyncConsolidation: {
    ok: boolean;
    reviewedCourses: number;
    candidateTeachers: number;
    updatedTeachers: number;
    alreadyConsistent: number;
    conflicts: number;
    skippedWithoutLinkedTeacher: number;
    skippedWithoutBannerId: number;
    conflictSamples: Array<{ teacherId: string; fullName: string; bannerIds: string[] }>;
  } | null;
  batch: {
    processed: number;
    found: number;
    notFound: number;
    failed: number;
    outputPath: string | null;
  };
  updates: {
    teachersSynced: number;
    coordinatorsSynced: number;
    studentIdsSynced: number;
    studentRowsSynced: number;
  };
  samples?: {
    skippedTeachers?: Array<{ id: string; fullName: string }>;
    skippedCoordinators?: Array<{ id: string; programId: string; fullName: string; email: string }>;
    notFoundEntities?: Array<{ entityType: string; entityId: string; personId: string }>;
  };
};

type BannerIdConsolidationResult = {
  ok: boolean;
  reviewedCourses: number;
  candidateTeachers: number;
  updatedTeachers: number;
  alreadyConsistent: number;
  conflicts: number;
  skippedWithoutLinkedTeacher: number;
  skippedWithoutBannerId: number;
  conflictSamples: Array<{ teacherId: string; fullName: string; bannerIds: string[] }>;
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

type ManualCoordinatorForm = {
  id: string;
  programId: string;
  fullName: string;
  email: string;
  campus: string;
  region: string;
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

const EMPTY_COORDINATOR_FORM: ManualCoordinatorForm = {
  id: '',
  programId: '',
  fullName: '',
  email: '',
  campus: '',
  region: '',
};

export function TeachersManagementPanel({ apiBase }: TeachersManagementPanelProps) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState('150');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<TeachersListResult | null>(null);

  const [form, setForm] = useState<ManualTeacherForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [coordinatorQ, setCoordinatorQ] = useState('');
  const [coordinatorLimit, setCoordinatorLimit] = useState('120');
  const [coordinatorsLoading, setCoordinatorsLoading] = useState(false);
  const [coordinatorsResult, setCoordinatorsResult] = useState<CoordinatorsListResult | null>(null);
  const [coordinatorForm, setCoordinatorForm] = useState<ManualCoordinatorForm>(EMPTY_COORDINATOR_FORM);
  const [savingCoordinator, setSavingCoordinator] = useState(false);

  const [csvFiles, setCsvFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<TeachersImportResult | null>(null);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [includeCoordinators, setIncludeCoordinators] = useState(true);
  const [sheetName, setSheetName] = useState('');
  const [importingWorkbook, setImportingWorkbook] = useState(false);
  const [workbookImportResult, setWorkbookImportResult] = useState<TeachersWorkbookImportResult | null>(null);
  const [spaidenLimitPerScope, setSpaidenLimitPerScope] = useState('');
  const [spaidenSyncing, setSpaidenSyncing] = useState(false);
  const [spaidenResult, setSpaidenResult] = useState<SpaidenSyncResult | null>(null);
  const [consolidatingBannerIds, setConsolidatingBannerIds] = useState(false);
  const [bannerIdConsolidation, setBannerIdConsolidation] = useState<BannerIdConsolidationResult | null>(null);

  useEffect(() => {
    void loadTeachers();
    void loadCoordinators();
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

  async function loadCoordinators() {
    try {
      setCoordinatorsLoading(true);
      setMessage('');
      const params = new URLSearchParams();
      if (coordinatorQ.trim()) params.set('q', coordinatorQ.trim());
      if (coordinatorLimit.trim()) params.set('limit', coordinatorLimit.trim());
      const data = await fetchJson<CoordinatorsListResult>(`${apiBase}/coordinators?${params.toString()}`);
      setCoordinatorsResult(data);
    } catch (error) {
      setMessage(
        `No fue posible cargar la tabla de coordinadores: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setCoordinatorsLoading(false);
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

  async function saveCoordinator() {
    if (!coordinatorForm.programId.trim()) {
      setMessage('Debes diligenciar el programa del coordinador.');
      return;
    }
    if (!coordinatorForm.fullName.trim()) {
      setMessage('Debes diligenciar el nombre del coordinador.');
      return;
    }
    if (!coordinatorForm.email.trim()) {
      setMessage('Debes diligenciar el correo del coordinador.');
      return;
    }

    try {
      setSavingCoordinator(true);
      setMessage('');
      await fetchJson(`${apiBase}/coordinators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coordinatorForm),
      });
      setMessage('Coordinador guardado correctamente.');
      setCoordinatorForm(EMPTY_COORDINATOR_FORM);
      await loadCoordinators();
    } catch (error) {
      setMessage(
        `No fue posible guardar coordinador: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSavingCoordinator(false);
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

  async function importWorkbook() {
    if (!workbookFile) {
      setMessage('Selecciona el Excel maestro de docentes/coordinadores.');
      return;
    }

    try {
      setImportingWorkbook(true);
      setMessage('');
      const formData = new FormData();
      formData.append('files', workbookFile, workbookFile.name);
      formData.append('includeCoordinators', includeCoordinators ? 'true' : 'false');
      if (sheetName.trim()) formData.append('sheetName', sheetName.trim());

      const data = await fetchJson<TeachersWorkbookImportResult>(`${apiBase}/import/teachers-xlsx`, {
        method: 'POST',
        body: formData,
      });

      setWorkbookImportResult(data);
      setMessage(
        includeCoordinators
          ? 'Excel maestro importado. Docentes y coordinadores actualizados.'
          : 'Excel maestro importado. Docentes actualizados.',
      );
      await loadTeachers();
      await loadCoordinators();
    } catch (error) {
      setMessage(
        `No fue posible importar el Excel maestro: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setImportingWorkbook(false);
    }
  }

  async function runSpaidenSync(scope: SpaidenSyncResult['scope']) {
    try {
      setSpaidenSyncing(true);
      setMessage('');
      const payload: Record<string, unknown> = { scope };
      if (spaidenLimitPerScope.trim()) payload.limitPerScope = spaidenLimitPerScope.trim();

      const data = await fetchJson<SpaidenSyncResult>(`${apiBase}/integrations/banner-people/spaiden-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      setSpaidenResult(data);
      setMessage('Sincronizacion SPAIDEN completada.');
      await loadTeachers();
      await loadCoordinators();
    } catch (error) {
      setMessage(`No fue posible sincronizar con SPAIDEN: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSpaidenSyncing(false);
    }
  }

  async function runBannerIdConsolidation() {
    try {
      setConsolidatingBannerIds(true);
      setMessage('');
      const data = await fetchJson<BannerIdConsolidationResult>(`${apiBase}/teachers/consolidate-banner-ids`, {
        method: 'POST',
      });
      setBannerIdConsolidation(data);
      setMessage('IDs Banner consolidados desde NRC resueltos.');
      await loadTeachers();
    } catch (error) {
      setMessage(
        `No fue posible consolidar IDs Banner desde los NRC resueltos: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setConsolidatingBannerIds(false);
    }
  }

  return (
    <article className="panel">
      <h2>Base de docentes y coordinadores</h2>

      <div className="subtitle">0) Sincronizar nombres y correos desde Banner (SPAIDEN)</div>
      <div className="actions">
        Antes de sincronizar, el sistema consolida automaticamente los IDs Banner reales desde los NRC ya resueltos en Banner.
      </div>
      <div className="controls">
        <label>
          Limite por grupo
          <input
            value={spaidenLimitPerScope}
            onChange={(event) => setSpaidenLimitPerScope(event.target.value)}
            placeholder="Vacio = todos"
          />
        </label>
        <button
          type="button"
          onClick={() => void runBannerIdConsolidation()}
          disabled={consolidatingBannerIds || spaidenSyncing}
        >
          {consolidatingBannerIds ? 'Consolidando...' : 'Consolidar IDs Banner desde NRC'}
        </button>
        <button type="button" onClick={() => void runSpaidenSync('teachers')} disabled={spaidenSyncing}>
          {spaidenSyncing ? 'Sincronizando...' : 'Docentes'}
        </button>
        <button type="button" onClick={() => void runSpaidenSync('coordinators')} disabled={spaidenSyncing}>
          {spaidenSyncing ? 'Sincronizando...' : 'Coordinadores'}
        </button>
        <button type="button" onClick={() => void runSpaidenSync('students')} disabled={spaidenSyncing}>
          {spaidenSyncing ? 'Sincronizando...' : 'Estudiantes'}
        </button>
        <button type="button" onClick={() => void runSpaidenSync('all')} disabled={spaidenSyncing}>
          {spaidenSyncing ? 'Sincronizando...' : 'Todo'}
        </button>
      </div>
      {bannerIdConsolidation ? (
        <div className="badges" style={{ marginTop: 8 }}>
          <span className="badge">IDs Banner nuevos: {bannerIdConsolidation.updatedTeachers}</span>
          <span className="badge">Ya consistentes: {bannerIdConsolidation.alreadyConsistent}</span>
          <span className="badge">Conflictos: {bannerIdConsolidation.conflicts}</span>
          <span className="badge">Docentes candidatos: {bannerIdConsolidation.candidateTeachers}</span>
        </div>
      ) : null}
      {spaidenResult ? (
        <>
          <div className="badges" style={{ marginTop: 8 }}>
            <span className="badge">Personas consultadas: {spaidenResult.candidates.personIds}</span>
            <span className="badge">Encontradas: {spaidenResult.batch.found}</span>
            <span className="badge">No encontradas: {spaidenResult.batch.notFound}</span>
            <span className="badge">Fallos: {spaidenResult.batch.failed}</span>
            <span className="badge">Docentes sincronizados: {spaidenResult.updates.teachersSynced}</span>
            <span className="badge">Coordinadores sincronizados: {spaidenResult.updates.coordinatorsSynced}</span>
            <span className="badge">IDs estudiantes: {spaidenResult.updates.studentIdsSynced}</span>
            <span className="badge">Filas estudiantes: {spaidenResult.updates.studentRowsSynced}</span>
          </div>
          {spaidenResult.preSyncConsolidation ? (
            <div className="actions" style={{ marginTop: 8 }}>
              Consolidacion previa: {spaidenResult.preSyncConsolidation.updatedTeachers} nuevos, {spaidenResult.preSyncConsolidation.alreadyConsistent} ya consistentes, {spaidenResult.preSyncConsolidation.conflicts} conflictos.
            </div>
          ) : null}
          <div className="actions" style={{ marginTop: 8 }}>
            Omitidos: docentes sin ID {spaidenResult.skipped.teachersWithoutId} | coordinadores sin cruce {spaidenResult.skipped.coordinatorsWithoutMatch} | estudiantes sin ID {spaidenResult.skipped.studentsWithoutId}
          </div>
          {spaidenResult.samples?.notFoundEntities?.length ? (
            <div className="actions" style={{ marginTop: 6 }}>
              No encontrados (muestra):{' '}
              {spaidenResult.samples.notFoundEntities
                .slice(0, 6)
                .map((item) => `${item.entityType}:${item.entityId} -> ${item.personId}`)
                .join(' | ')}
            </div>
          ) : null}
        </>
      ) : null}

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
        1.1) Tabla de coordinadores
      </div>
      <div className="controls">
        <label>
          Buscar
          <input
            value={coordinatorQ}
            onChange={(event) => setCoordinatorQ(event.target.value)}
            placeholder="Programa, nombre, correo..."
          />
        </label>
        <label>
          Limite
          <input
            value={coordinatorLimit}
            onChange={(event) => setCoordinatorLimit(event.target.value)}
            placeholder="120"
          />
        </label>
        <button type="button" onClick={() => void loadCoordinators()} disabled={coordinatorsLoading}>
          {coordinatorsLoading ? 'Cargando...' : 'Actualizar coordinadores'}
        </button>
      </div>

      {coordinatorsResult ? (
        <>
          <div className="actions">
            Total coordinadores: <span className="code">{coordinatorsResult.total}</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Programa</th>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Campus</th>
                  <th>Region</th>
                  <th>Origen</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {coordinatorsResult.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.programId}</td>
                    <td>{item.fullName}</td>
                    <td>{item.email}</td>
                    <td>{item.campus ?? '-'}</td>
                    <td>{item.region ?? '-'}</td>
                    <td>{item.sourceSheet ?? '-'}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setCoordinatorForm({
                            id: item.id,
                            programId: item.programId,
                            fullName: item.fullName,
                            email: item.email,
                            campus: item.campus ?? '',
                            region: item.region ?? '',
                          })
                        }
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
                {!coordinatorsResult.items.length ? (
                  <tr>
                    <td colSpan={7}>No hay coordinadores para este filtro.</td>
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
        2.1) Agregar/actualizar coordinador manualmente
      </div>
      <div className="actions">
        Si cargas un coordinador desde la tabla, aqui puedes cambiarle el correo o cualquier dato y guardarlo.
      </div>
      <div className="controls">
        <label>
          ID coordinador
          <input
            value={coordinatorForm.id}
            onChange={(event) => setCoordinatorForm((prev) => ({ ...prev, id: event.target.value }))}
            placeholder="Opcional para crear, automatico al editar"
          />
        </label>
        <label style={{ minWidth: 260 }}>
          Programa
          <input
            value={coordinatorForm.programId}
            onChange={(event) => setCoordinatorForm((prev) => ({ ...prev, programId: event.target.value }))}
          />
        </label>
        <label style={{ minWidth: 260 }}>
          Nombre
          <input
            value={coordinatorForm.fullName}
            onChange={(event) => setCoordinatorForm((prev) => ({ ...prev, fullName: event.target.value }))}
          />
        </label>
        <label style={{ minWidth: 260 }}>
          Correo
          <input
            value={coordinatorForm.email}
            onChange={(event) => setCoordinatorForm((prev) => ({ ...prev, email: event.target.value }))}
          />
        </label>
        <label>
          Campus
          <input
            value={coordinatorForm.campus}
            onChange={(event) => setCoordinatorForm((prev) => ({ ...prev, campus: event.target.value }))}
          />
        </label>
        <label>
          Region
          <input
            value={coordinatorForm.region}
            onChange={(event) => setCoordinatorForm((prev) => ({ ...prev, region: event.target.value }))}
          />
        </label>
        <button type="button" onClick={() => void saveCoordinator()} disabled={savingCoordinator}>
          {savingCoordinator ? 'Guardando...' : 'Guardar coordinador'}
        </button>
        <button
          type="button"
          onClick={() => setCoordinatorForm(EMPTY_COORDINATOR_FORM)}
          disabled={savingCoordinator}
        >
          Limpiar formulario
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

      <div className="subtitle" style={{ marginTop: 14 }}>
        4) Actualizar docentes y coordinadores desde Excel maestro
      </div>
      <div className="actions">
        Usa el mismo libro de Excel donde tengas hojas de docentes y, si aplica, hojas de coordinadores.
      </div>
      <div className="controls">
        <label style={{ minWidth: 360 }}>
          Archivo Excel
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(event) => setWorkbookFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Hoja puntual
          <input
            value={sheetName}
            onChange={(event) => setSheetName(event.target.value)}
            placeholder="Opcional: nombre exacto de la hoja"
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 220 }}>
          <input
            type="checkbox"
            checked={includeCoordinators}
            onChange={(event) => setIncludeCoordinators(event.target.checked)}
          />
          Incluir coordinadores
        </label>
        <button type="button" onClick={() => void importWorkbook()} disabled={importingWorkbook}>
          {importingWorkbook ? 'Importando Excel...' : 'Importar Excel maestro'}
        </button>
      </div>
      {workbookFile ? (
        <div className="actions">
          Archivo seleccionado: <span className="code">{workbookFile.name}</span>
        </div>
      ) : null}
      {workbookImportResult ? (
        <>
          <div className="badges" style={{ marginTop: 8 }}>
            <span className="badge">Docentes nuevos: {workbookImportResult.createdTeachers}</span>
            <span className="badge">Docentes actualizados: {workbookImportResult.updatedTeachers}</span>
            <span className="badge">Docentes omitidos: {workbookImportResult.skippedRows}</span>
            <span className="badge">Coordinadores nuevos: {workbookImportResult.createdCoordinators}</span>
            <span className="badge">Coordinadores actualizados: {workbookImportResult.updatedCoordinators}</span>
            <span className="badge">Coordinadores omitidos: {workbookImportResult.skippedCoordinatorRows}</span>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            Hojas docentes: {workbookImportResult.sheetsProcessed.length ? workbookImportResult.sheetsProcessed.join(', ') : '-'}
          </div>
          <div className="actions" style={{ marginTop: 4 }}>
            Hojas coordinadores:{' '}
            {workbookImportResult.coordinatorSheetsProcessed.length
              ? workbookImportResult.coordinatorSheetsProcessed.join(', ')
              : '-'}
          </div>
        </>
      ) : null}

      {message ? <div className="message">{message}</div> : null}
    </article>
  );
}
