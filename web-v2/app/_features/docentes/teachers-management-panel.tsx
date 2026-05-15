'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';
import { Button, StatusPill, PageHero, StatsGrid, AlertBox, Modal, useConfirm } from '../../_components/ui';

type TeacherStatus = 'NUEVO' | 'ANTIGUO' | 'SIN_CONTRATO';

function classifyTeacher(fechaInicio: string | null, previousEmployment = false): TeacherStatus {
  if (!fechaInicio) return 'SIN_CONTRATO';
  const start = new Date(fechaInicio);
  if (Number.isNaN(start.getTime())) return 'SIN_CONTRATO';
  // Si ya trabajó antes en la institución, cuenta como ANTIGUO desde el primer día
  if (previousEmployment) return 'ANTIGUO';
  const now = new Date();
  if (start.getFullYear() === now.getFullYear()) return 'NUEVO';
  return 'ANTIGUO';
}

function weeksSince(fechaInicio: string | null): number | null {
  if (!fechaInicio) return null;
  const start = new Date(fechaInicio);
  if (Number.isNaN(start.getTime())) return null;
  const ms = Date.now() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 7));
}

function daysUntilContractEnd(fechaFin: string | null): number | null {
  if (!fechaFin) return null;
  const end = new Date(fechaFin);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalizeMatchKey(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toUpperCase();
}

function findCoordinatorMatch(
  teacher: { coordination: string | null; programaCodigo: string | null; costCenter: string | null },
  coordinators: Array<{ id: string; programId: string; programKey: string; fullName: string; email: string }>,
): { fullName: string; email: string } | null {
  const teacherCoord = normalizeMatchKey(teacher.coordination);
  const teacherCode = normalizeMatchKey(teacher.programaCodigo);
  const teacherCost = normalizeMatchKey(teacher.costCenter);
  for (const c of coordinators) {
    const ck = normalizeMatchKey(c.programKey || c.programId);
    if (!ck) continue;
    if (teacherCode && ck === teacherCode) return c;
    if (teacherCost && ck === teacherCost) return c;
    if (teacherCoord && (ck === teacherCoord || teacherCoord.startsWith(ck) || ck.startsWith(teacherCoord))) return c;
  }
  return null;
}

function statusBadge(status: TeacherStatus): { label: string; bg: string; color: string; border: string } {
  if (status === 'NUEVO') return { label: 'NUEVO', bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' };
  if (status === 'ANTIGUO') return { label: 'ANTIGUO', bg: '#dcfce7', color: '#166534', border: '#86efac' };
  return { label: 'SIN CONTRATO', bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' };
}

type TeachersManagementPanelProps = {
  apiBase: string;
};

type TeacherItem = {
  id: string;
  sourceId: string | null;
  documentId: string | null;
  fullName: string;
  email: string | null;
  email2: string | null;
  costCenter: string | null;
  coordination: string | null;
  campus: string | null;
  region: string | null;
  escalafon: string | null;
  dedicacion: string | null;
  tipoContrato: string | null;
  fechaInicio: string | null;
  fechaFin: string | null;
  antiguedadText: string | null;
  programaAcademico: string | null;
  programaCodigo: string | null;
  previousEmployment?: boolean;
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

type DedupPreviewResult = {
  ok: boolean;
  totalTeachers: number;
  duplicateGroupCount: number;
  teachersThatWouldBeDeleted: number;
  orphansWithNoCourses: number;
  estimatedAfterMerge: number;
  groups: Array<{
    sourceId: string | null;
    keepId: string;
    keepName: string;
    count: number;
    teachers: Array<{ id: string; fullName: string; sourceId: string | null; documentId: string | null; courseCount: number }>;
  }>;
};

type DedupApplyResult = {
  ok: boolean;
  mergedGroups: number;
  deletedTeachers: number;
  coursesReassigned: number;
  orphansDeleted: number;
  finalTeacherCount: number;
};

type BannerKeepPreviewResult = {
  ok: boolean;
  dryRun: true;
  toKeepCount: number;
  toDeleteCount: number;
  coursesToUnlink: number;
  uniqueTeachersInBatch: number;
  csvFile: string;
  samples: Array<{ id: string; fullName: string; sourceId: string | null; courseCount: number }>;
};

type BannerKeepApplyResult = {
  ok: boolean;
  dryRun: false;
  deletedTeachers: number;
  unlinkedCourses: number;
  finalTeacherCount: number;
  csvFile: string;
  uniqueTeachersInBatch: number;
};

type ManualTeacherForm = {
  id: string;
  sourceId: string;
  documentId: string;
  fullName: string;
  email: string;
  email2: string;
  campus: string;
  region: string;
  costCenter: string;
  coordination: string;
  escalafon: string;
  dedicacion: string;
  tipoContrato: string;
  fechaInicio: string;
  fechaFin: string;
  antiguedadText: string;
  programaAcademico: string;
  programaCodigo: string;
  previousEmployment: boolean;
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
  email2: '',
  campus: '',
  region: '',
  costCenter: '',
  coordination: '',
  escalafon: '',
  dedicacion: '',
  tipoContrato: '',
  fechaInicio: '',
  fechaFin: '',
  antiguedadText: '',
  programaAcademico: '',
  programaCodigo: '',
  previousEmployment: false,
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
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState('150');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<TeachersListResult | null>(null);

  const [filterCoords, setFilterCoords] = useState<string[]>([]);
  const [filterCampus, setFilterCampus] = useState<string[]>([]);
  const [filterMissing, setFilterMissing] = useState<string[]>([]);
  const [filterEscalafon, setFilterEscalafon] = useState<string[]>([]);
  const [filterDedicacion, setFilterDedicacion] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<TeacherStatus[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [detailTeacher, setDetailTeacher] = useState<TeacherItem | null>(null);
  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [showCoordinatorForm, setShowCoordinatorForm] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);

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

  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [editingCoordinatorId, setEditingCoordinatorId] = useState<string | null>(null);

  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupApplying, setDedupApplying] = useState(false);
  const [dedupRemoveOrphans, setDedupRemoveOrphans] = useState(false);
  const [dedupPreviewResult, setDedupPreviewResult] = useState<DedupPreviewResult | null>(null);
  const [dedupApplyResult, setDedupApplyResult] = useState<DedupApplyResult | null>(null);

  const [bannerKeepLoading, setBannerKeepLoading] = useState(false);
  const [bannerKeepApplying, setBannerKeepApplying] = useState(false);
  const [bannerKeepPreview, setBannerKeepPreview] = useState<BannerKeepPreviewResult | null>(null);
  const [bannerKeepResult, setBannerKeepResult] = useState<BannerKeepApplyResult | null>(null);

  const [deletingAll, setDeletingAll] = useState(false);

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
      setEditingTeacherId(null);
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
      setEditingCoordinatorId(null);
      await loadCoordinators();
    } catch (error) {
      setMessage(
        `No fue posible guardar coordinador: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSavingCoordinator(false);
    }
  }

  async function loadBannerKeepPreview() {
    try {
      setBannerKeepLoading(true);
      setBannerKeepResult(null);
      setMessage('');
      const data = await fetchJson<BannerKeepPreviewResult>('/api/teachers/banner-keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      setBannerKeepPreview(data);
    } catch (error) {
      setMessage(`Error al analizar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBannerKeepLoading(false);
    }
  }

  async function applyBannerKeep() {
    if (!bannerKeepPreview) return;
    const ok = await confirm({
      title: 'Eliminar docentes fuera del lote Banner',
      tone: 'danger',
      confirmLabel: 'Eliminar',
      message: (
        <>
          ¿Confirmas eliminar <strong>{bannerKeepPreview.toDeleteCount}</strong> docentes que NO están en el último lote Banner?
          Esto dejará <strong>{bannerKeepPreview.coursesToUnlink}</strong> cursos sin docente asignado. Esta acción no se puede deshacer fácilmente.
        </>
      ),
    });
    if (!ok) return;
    try {
      setBannerKeepApplying(true);
      setMessage('');
      const data = await fetchJson<BannerKeepApplyResult>('/api/teachers/banner-keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      });
      setBannerKeepResult(data);
      setBannerKeepPreview(null);
      setMessage(`Limpieza completa. Docentes restantes: ${data.finalTeacherCount}`);
      await loadTeachers();
    } catch (error) {
      setMessage(`Error al aplicar limpieza: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBannerKeepApplying(false);
    }
  }

  async function loadDedupPreview() {
    try {
      setDedupLoading(true);
      setMessage('');
      setDedupApplyResult(null);
      const data = await fetchJson<DedupPreviewResult>(`${apiBase}/teachers/dedup-preview`);
      setDedupPreviewResult(data);
    } catch (error) {
      setMessage(`No fue posible analizar duplicados: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDedupLoading(false);
    }
  }

  async function applyDedup() {
    const ok = await confirm({
      title: 'Consolidar duplicados',
      tone: 'danger',
      confirmLabel: 'Consolidar',
      message: '¿Confirmas consolidar los duplicados? Esta acción fusiona docentes con el mismo sourceId y no se puede deshacer fácilmente.',
    });
    if (!ok) return;
    try {
      setDedupApplying(true);
      setMessage('');
      const data = await fetchJson<DedupApplyResult>(`${apiBase}/teachers/dedup-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeOrphans: dedupRemoveOrphans }),
      });
      setDedupApplyResult(data);
      setDedupPreviewResult(null);
      setMessage(`Consolidacion completa. Docentes restantes: ${data.finalTeacherCount}`);
      await loadTeachers();
    } catch (error) {
      setMessage(`Error al consolidar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDedupApplying(false);
    }
  }

  async function deleteAllTeachers() {
    const ok = await confirm({
      title: 'Eliminar TODOS los docentes',
      tone: 'danger',
      confirmLabel: 'Eliminar todos',
      message: '¿Confirmas ELIMINAR TODOS los docentes? Esto desvinculará todos los cursos y no se puede deshacer fácilmente.',
    });
    if (!ok) return;
    try {
      setDeletingAll(true);
      setMessage('');
      const data = await fetchJson<{ ok: boolean; deletedTeachers: number; unlinkedCourses: number }>(
        `${apiBase}/teachers/delete-all`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) },
      );
      setMessage(`Listo: ${data.deletedTeachers} docentes eliminados, ${data.unlinkedCourses} cursos desvinculados.`);
      setResult(null);
      await loadTeachers();
    } catch (error) {
      setMessage(`Error al eliminar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeletingAll(false);
    }
  }

  function downloadTeachersCsv() {
    if (!result?.items.length) return;
    const header = ['id', 'cedula', 'nombre', 'correo', 'correo2', 'sede', 'region', 'centrocosto', 'coordinacion'].join(',');
    const rows = result.items.map(t => [
      `"${(t.id ?? '').replace(/"/g, '""')}"`,
      `"${(t.documentId ?? '').replace(/"/g, '""')}"`,
      `"${(t.fullName ?? '').replace(/"/g, '""')}"`,
      `"${(t.email ?? '').replace(/"/g, '""')}"`,
      `"${(t.email2 ?? '').replace(/"/g, '""')}"`,
      `"${(t.campus ?? '').replace(/"/g, '""')}"`,
      `"${(t.region ?? '').replace(/"/g, '""')}"`,
      `"${(t.costCenter ?? '').replace(/"/g, '""')}"`,
      `"${(t.coordination ?? '').replace(/"/g, '""')}"`,
    ].join(','));
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docentes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseCsvText(text: string): Array<Record<string, string>> {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (!lines.length) return [];
    const parseRow = (line: string): string[] => {
      const cells: string[] = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
          else { inQuote = !inQuote; }
        } else if (ch === ',' && !inQuote) {
          cells.push(cur.trim()); cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    };
    const headers = parseRow(lines[0]).map(h => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_'));
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = parseRow(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
      return row;
    });
  }

  async function importUnifiedCsv() {
    if (!csvFiles.length) {
      setMessage('Selecciona al menos un CSV.');
      return;
    }
    try {
      setImporting(true);
      setMessage('');
      let totalTeacherRows = 0, totalCoordRows = 0, coordCreated = 0, coordErrors = 0;

      for (const file of csvFiles) {
        const text = await file.text();
        const rows = parseCsvText(text);

        const teacherRows = rows.filter(r => {
          const tipo = (r['tipo'] ?? '').toUpperCase().trim();
          return tipo !== 'COORDINADOR';
        });
        const coordRows = rows.filter(r => {
          const tipo = (r['tipo'] ?? '').toUpperCase().trim();
          return tipo === 'COORDINADOR';
        });

        // Docentes → enviar al endpoint existente como CSV
        if (teacherRows.length) {
          totalTeacherRows += teacherRows.length;
          const teacherHeader = 'id,cedula,nombre,correo,correo2,sede,region,centrocosto,coordinacion';
          const teacherCsvLines = teacherRows.map(r =>
            [r['id']??'', r['cedula']??'', r['nombre']??'', r['correo']??'', r['correo2']??r['email2']??'', r['sede']??'', r['region']??'', r['centrocosto']??'', r['coordinacion']??''].map(v => `"${v.replace(/"/g,'""')}"`).join(',')
          );
          const teacherCsvText = [teacherHeader, ...teacherCsvLines].join('\n');
          const teacherFile = new File([teacherCsvText], file.name, { type: 'text/csv' });
          const fd = new FormData();
          fd.append('files', teacherFile, teacherFile.name);
          const res = await fetchJson<TeachersImportResult>(`${apiBase}/teachers/import-csv`, { method: 'POST', body: fd });
          setImportResult(res);
        }

        // Coordinadores → POST individual por fila
        for (const r of coordRows) {
          totalCoordRows++;
          const programId = (r['programa_id'] ?? r['programa'] ?? '').trim();
          const nombre = (r['nombre'] ?? '').trim();
          const correo = (r['correo'] ?? r['email'] ?? '').trim();
          if (!programId || !nombre || !correo) { coordErrors++; continue; }
          try {
            await fetchJson(`${apiBase}/coordinators`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                programId,
                fullName: nombre,
                email: correo,
                campus: (r['sede'] ?? r['campus'] ?? '').trim() || undefined,
                region: (r['region'] ?? '').trim() || undefined,
              }),
            });
            coordCreated++;
          } catch { coordErrors++; }
        }
      }

      const parts = [];
      if (totalTeacherRows) parts.push(`${totalTeacherRows} filas de docentes procesadas`);
      if (totalCoordRows) parts.push(`${coordCreated} coordinadores importados${coordErrors ? `, ${coordErrors} con error` : ''}`);
      setMessage(parts.join(' | ') + '.');
      await loadTeachers();
      await loadCoordinators();
    } catch (error) {
      setMessage(`Error en importación: ${error instanceof Error ? error.message : String(error)}`);
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

  async function deleteTeacher(id: string, name: string) {
    const ok = await confirm({
      title: 'Eliminar docente',
      tone: 'danger',
      confirmLabel: 'Eliminar',
      message: `¿Eliminar al docente "${name}"? Esta acción no se puede deshacer.`,
    });
    if (!ok) return;
    try {
      setLoading(true);
      setMessage('');
      await fetchJson(`${apiBase}/teachers/${id}`, { method: 'DELETE' });
      setMessage(`Docente "${name}" eliminado correctamente.`);
      await loadTeachers();
    } catch (error) {
      setMessage(`No fue posible eliminar el docente: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function deleteCoordinator(id: string, name: string) {
    const ok = await confirm({
      title: 'Eliminar coordinador',
      tone: 'danger',
      confirmLabel: 'Eliminar',
      message: `¿Eliminar al coordinador "${name}"? Esta acción no se puede deshacer.`,
    });
    if (!ok) return;
    try {
      setCoordinatorsLoading(true);
      setMessage('');
      await fetchJson(`${apiBase}/coordinators/${id}`, { method: 'DELETE' });
      setMessage(`Coordinador "${name}" eliminado correctamente.`);
      await loadCoordinators();
    } catch (error) {
      setMessage(`No fue posible eliminar el coordinador: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCoordinatorsLoading(false);
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

  const totalDocentes = result?.total ?? 0;
  const totalCoords = coordinatorsResult?.total ?? 0;
  const sinContrato = result?.items.filter((i) => !i.tipoContrato).length ?? 0;
  const sinCorreo = result?.items.filter((i) => !i.email).length ?? 0;

  return (
    <article className="premium-card">
      <PageHero
        title="Docentes y coordinadores"
        description="Base de docentes activos. Vinculación Banner, sincronización SPAIDEN, importación masiva y mantenimiento."
      >
        <StatusPill tone={loading ? 'warn' : totalDocentes > 0 ? 'ok' : 'neutral'} dot={loading}>
          {loading ? 'Cargando' : `${totalDocentes} docentes`}
        </StatusPill>
        <Button variant="ghost" size="sm" onClick={() => { void loadTeachers(); void loadCoordinators(); }} loading={loading}>
          ↻ Actualizar
        </Button>
      </PageHero>

      <StatsGrid items={[
        { label: 'Docentes', value: totalDocentes, tone: 'default' },
        { label: 'Coordinadores', value: totalCoords, tone: 'default' },
        { label: 'Sin contrato', value: sinContrato, tone: sinContrato > 0 ? 'warn' : 'ok' },
        { label: 'Sin correo', value: sinCorreo, tone: sinCorreo > 0 ? 'warn' : 'ok' },
      ]} />

      <div className="panel-body">

      <div className="subtitle">0) Traer nombres y correos desde Banner</div>
      <div className="actions">
        Consulta Banner (SPAIDEN) para completar el nombre completo y el correo institucional de cada docente ya importado.
        Requiere que los docentes tengan cédula registrada.
      </div>

      {/* Paso 1 */}
      <div className="subtitle">Paso 1 — Vincular cédulas con Banner</div>
      <div className="actions" style={{ marginBottom: 6 }}>
        Cruza las cédulas de los docentes importados con los NRC ya resueltos en Banner para obtener el ID interno de Banner.
        Hazlo primero si acabas de importar docentes nuevos.
      </div>
      <div className="controls">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void runBannerIdConsolidation()}
          disabled={consolidatingBannerIds || spaidenSyncing}
          loading={consolidatingBannerIds}
        >
          Vincular cédulas con Banner
        </Button>
      </div>
      {bannerIdConsolidation ? (
        <div className="badges" style={{ marginTop: 8 }}>
          <StatusPill tone="ok">✓ IDs vinculados nuevos: {bannerIdConsolidation.updatedTeachers}</StatusPill>
          <StatusPill tone="neutral">Ya vinculados: {bannerIdConsolidation.alreadyConsistent}</StatusPill>
          {bannerIdConsolidation.conflicts > 0 && (
            <StatusPill tone="danger">Conflictos: {bannerIdConsolidation.conflicts}</StatusPill>
          )}
          <StatusPill tone="neutral">Candidatos: {bannerIdConsolidation.candidateTeachers}</StatusPill>
        </div>
      ) : null}

      {/* Paso 2 */}
      <div className="subtitle" style={{ marginTop: 16 }}>Paso 2 — Traer nombre y correo desde Banner</div>
      <div className="actions" style={{ marginBottom: 6 }}>
        Con los IDs ya vinculados, consulta Banner para actualizar el nombre completo y el correo institucional.
        Usa <strong>Solo docentes</strong> para el caso habitual.
      </div>
      <div className="controls">
        <label style={{ fontSize: 12 }}>
          Límite (opcional)
          <input
            value={spaidenLimitPerScope}
            onChange={(event) => setSpaidenLimitPerScope(event.target.value)}
            placeholder="Vacío = todos"
            style={{ width: 110 }}
          />
        </label>
        <Button variant="primary" size="sm" onClick={() => void runSpaidenSync('teachers')} disabled={spaidenSyncing} loading={spaidenSyncing}>
          Solo docentes
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void runSpaidenSync('coordinators')} disabled={spaidenSyncing}>
          Solo coordinadores
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void runSpaidenSync('all')} disabled={spaidenSyncing}>
          Todo (docentes + coordinadores + estudiantes)
        </Button>
      </div>
      {spaidenResult ? (
        <AlertBox tone="success" style={{ marginTop: 10 }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>Resultado sincronización SPAIDEN</strong>
          <div className="badges">
            <StatusPill tone="ok">✓ Docentes: {spaidenResult.updates.teachersSynced}</StatusPill>
            <StatusPill tone="ok">✓ Coordinadores: {spaidenResult.updates.coordinatorsSynced}</StatusPill>
            <StatusPill tone="neutral">Consultados: {spaidenResult.candidates.personIds}</StatusPill>
            <StatusPill tone="neutral">Encontrados: {spaidenResult.batch.found}</StatusPill>
            {spaidenResult.batch.notFound > 0 && (
              <StatusPill tone="warn">No encontrados: {spaidenResult.batch.notFound}</StatusPill>
            )}
            {spaidenResult.batch.failed > 0 && (
              <StatusPill tone="danger">Fallos: {spaidenResult.batch.failed}</StatusPill>
            )}
          </div>
          {(spaidenResult.skipped.teachersWithoutId > 0 || spaidenResult.skipped.coordinatorsWithoutMatch > 0) && (
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--muted)' }}>
              Omitidos por falta de ID: {spaidenResult.skipped.teachersWithoutId} docente(s), {spaidenResult.skipped.coordinatorsWithoutMatch} coordinador(es).
            </div>
          )}
          {spaidenResult.samples?.notFoundEntities?.length ? (
            <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--muted)' }}>
              Muestra no encontrados: {spaidenResult.samples.notFoundEntities.slice(0, 5).map((item) => item.entityId).join(', ')}
            </div>
          ) : null}
        </AlertBox>
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
        <Button variant="primary" size="sm" onClick={() => void loadTeachers()} disabled={loading} loading={loading}>
          Actualizar tabla
        </Button>
        <Button variant="secondary" size="sm" onClick={downloadTeachersCsv} disabled={!result?.items.length}>
          CSV ({result?.items.length ?? 0})
        </Button>
        <Button variant="danger" size="sm" onClick={() => void deleteAllTeachers()} disabled={deletingAll || loading} loading={deletingAll}>
          Eliminar todos
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
        >
          {(() => {
            const total = filterCoords.length + filterCampus.length + filterMissing.length + filterEscalafon.length + filterDedicacion.length + filterStatus.length;
            return showFilters ? 'Ocultar filtros' : `Filtros${total > 0 ? ` (${total})` : ''}`;
          })()}
        </Button>
        {(filterCoords.length + filterCampus.length + filterMissing.length + filterEscalafon.length + filterDedicacion.length + filterStatus.length > 0) && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setFilterCoords([]);
              setFilterCampus([]);
              setFilterMissing([]);
              setFilterEscalafon([]);
              setFilterDedicacion([]);
              setFilterStatus([]);
            }}
          >
            Limpiar filtros
          </Button>
        )}
      </div>

      {showFilters && result?.items.length ? (() => {
        const coords = [...new Set(result.items.map(i => i.coordination).filter(Boolean) as string[])].sort();
        const campuses = [...new Set(result.items.map(i => i.campus).filter(Boolean) as string[])].sort();
        const escalafones = [...new Set(result.items.map(i => i.escalafon).filter(Boolean) as string[])].sort();
        const dedicaciones = [...new Set(result.items.map(i => i.dedicacion).filter(Boolean) as string[])].sort();
        const statusOptions: { key: TeacherStatus; label: string }[] = [
          { key: 'NUEVO', label: 'Nuevo' },
          { key: 'ANTIGUO', label: 'Antiguo' },
          { key: 'SIN_CONTRATO', label: 'Sin contrato' },
        ];
        const missingOptions = [
          { key: 'email', label: 'Sin correo' },
          { key: 'email2', label: 'Sin correo 2' },
          { key: 'campus', label: 'Sin sede' },
          { key: 'region', label: 'Sin región' },
          { key: 'coordination', label: 'Sin coordinación' },
          { key: 'costCenter', label: 'Sin centro costo' },
          { key: 'escalafon', label: 'Sin escalafón' },
          { key: 'tipoContrato', label: 'Sin contrato' },
          { key: 'fechaFin', label: 'Sin fecha fin' },
        ];
        const toggle = (arr: string[], setter: (v: string[]) => void, val: string) => {
          setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);
        };
        const chipStyle = (active: boolean): React.CSSProperties => ({
          padding: '4px 10px',
          borderRadius: 14,
          border: `1px solid ${active ? '#1e40af' : '#cbd5e1'}`,
          background: active ? '#1e40af' : '#fff',
          color: active ? '#fff' : '#374151',
          fontSize: 12,
          cursor: 'pointer',
        });
        return (
          <div style={{ background: '#f1f5f9', padding: 12, borderRadius: 8, margin: '8px 0', border: '1px solid #cbd5e1' }}>
            <div style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 12, color: '#0f172a' }}>Estado del docente:</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {statusOptions.map((opt) => (
                  <button key={opt.key} type="button" style={chipStyle(filterStatus.includes(opt.key))} onClick={() => toggle(filterStatus as string[], setFilterStatus as (v: string[]) => void, opt.key)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 12, color: '#0f172a' }}>Campos faltantes:</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {missingOptions.map((opt) => (
                  <button key={opt.key} type="button" style={chipStyle(filterMissing.includes(opt.key))} onClick={() => toggle(filterMissing, setFilterMissing, opt.key)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {escalafones.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 12, color: '#0f172a' }}>Escalafón ({escalafones.length}):</strong>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {escalafones.map((e) => (
                    <button key={e} type="button" style={chipStyle(filterEscalafon.includes(e))} onClick={() => toggle(filterEscalafon, setFilterEscalafon, e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {dedicaciones.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 12, color: '#0f172a' }}>Dedicación ({dedicaciones.length}):</strong>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {dedicaciones.map((d) => (
                    <button key={d} type="button" style={chipStyle(filterDedicacion.includes(d))} onClick={() => toggle(filterDedicacion, setFilterDedicacion, d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {coords.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 12, color: '#0f172a' }}>Coordinación ({coords.length}):</strong>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {coords.map((c) => (
                    <button key={c} type="button" style={chipStyle(filterCoords.includes(c))} onClick={() => toggle(filterCoords, setFilterCoords, c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {campuses.length > 0 && (
              <div>
                <strong style={{ fontSize: 12, color: '#0f172a' }}>Sede ({campuses.length}):</strong>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  {campuses.map((c) => (
                    <button key={c} type="button" style={chipStyle(filterCampus.includes(c))} onClick={() => toggle(filterCampus, setFilterCampus, c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })() : null}

      {result ? (
        <>
          <div className="actions">
            Total docentes: <span className="code">{result.total}</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Nombre</th>
                  <th>Correo(s)</th>
                  <th>Programa</th>
                  <th>Coordinación</th>
                  <th>Coordinador</th>
                  <th>Sede</th>
                  <th>Escalafón</th>
                  <th>Dedicación</th>
                  <th>Contrato</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {result.items
                  .filter((item) => {
                    if (filterCoords.length && !filterCoords.includes(item.coordination ?? '')) return false;
                    if (filterCampus.length && !filterCampus.includes(item.campus ?? '')) return false;
                    if (filterEscalafon.length && !filterEscalafon.includes(item.escalafon ?? '')) return false;
                    if (filterDedicacion.length && !filterDedicacion.includes(item.dedicacion ?? '')) return false;
                    if (filterStatus.length) {
                      const status = classifyTeacher(item.fechaInicio, item.previousEmployment);
                      if (!filterStatus.includes(status)) return false;
                    }
                    if (filterMissing.length) {
                      const hasAllMissing = filterMissing.every((field) => {
                        const val = (item as unknown as Record<string, unknown>)[field];
                        return !val || String(val).trim() === '';
                      });
                      if (!hasAllMissing) return false;
                    }
                    return true;
                  })
                  .map((item) => {
                  const missCell = (val: string | null | undefined): React.CSSProperties =>
                    !val || String(val).trim() === '' ? { background: '#fef2f2', color: '#991b1b', fontStyle: 'italic' } : {};
                  const status = classifyTeacher(item.fechaInicio, item.previousEmployment);
                  const sb = statusBadge(status);
                  const daysToEnd = daysUntilContractEnd(item.fechaFin);
                  const contractWarning = daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 30;
                  const contractExpired = daysToEnd !== null && daysToEnd < 0;
                  const coord = coordinatorsResult?.items
                    ? findCoordinatorMatch(item, coordinatorsResult.items)
                    : null;
                  return (
                  <Fragment key={item.id}>
                    <tr style={editingTeacherId === item.id ? { background: 'var(--surface-2, #f0f4ff)' } : undefined}>
                      <td>
                        <StatusPill tone={status === 'NUEVO' ? 'neutral' : status === 'ANTIGUO' ? 'ok' : 'danger'}>
                          {sb.label}
                        </StatusPill>
                        <br />
                        <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>{item.id}</span>
                      </td>
                      <td>
                        <strong>{item.fullName}</strong>
                        {item.documentId && <><br /><span style={{ fontSize: 11, color: '#64748b' }}>CC {item.documentId}</span></>}
                      </td>
                      <td style={missCell(item.email)}>
                        <span style={{ fontSize: 12 }}>{item.email ?? 'falta'}</span>
                        {item.email2 ? (
                          <><br /><span style={{ fontSize: 11, color: '#64748b' }}>{item.email2}</span></>
                        ) : (
                          <><br /><span style={{ fontSize: 11, color: '#b45309', fontStyle: 'italic' }}>sin correo 2</span></>
                        )}
                      </td>
                      <td style={missCell(item.programaAcademico)}>
                        {item.programaAcademico ?? 'falta'}
                        {item.programaCodigo && <><br /><span style={{ fontSize: 11, color: '#64748b' }}>{item.programaCodigo}</span></>}
                      </td>
                      <td style={missCell(item.coordination)}>{item.coordination ?? 'falta'}</td>
                      <td style={!coord ? { background: '#fef3c7', color: '#92400e', fontStyle: 'italic' } : {}}>
                        {coord ? (
                          <>
                            <span style={{ fontSize: 12 }}>{coord.fullName}</span>
                            <br />
                            <span style={{ fontSize: 11, color: '#64748b' }}>{coord.email}</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 11 }}>sin coordinador</span>
                        )}
                      </td>
                      <td style={missCell(item.campus)}>
                        {item.campus ?? 'falta'}
                        {item.region && <><br /><span style={{ fontSize: 11, color: '#64748b' }}>{item.region}</span></>}
                      </td>
                      <td style={missCell(item.escalafon)}>
                        <span style={{ fontSize: 12 }}>{item.escalafon ?? 'falta'}</span>
                      </td>
                      <td style={missCell(item.dedicacion)}>
                        <span style={{ fontSize: 12 }}>{item.dedicacion ?? 'falta'}</span>
                      </td>
                      <td style={contractExpired ? { background: '#fee2e2', color: '#991b1b', fontWeight: 700 } : contractWarning ? { background: '#fef3c7', color: '#92400e' } : missCell(item.tipoContrato)}>
                        <span style={{ fontSize: 12 }}>{item.tipoContrato ?? 'falta'}</span>
                        {item.fechaFin && (
                          <>
                            <br />
                            <span style={{ fontSize: 11 }}>
                              {contractExpired ? `⚠ vencido hace ${Math.abs(daysToEnd!)}d` : contractWarning ? `⚠ termina en ${daysToEnd}d` : `fin: ${formatDate(item.fechaFin)}`}
                            </span>
                          </>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Button variant="ghost" size="sm" onClick={() => setDetailTeacher(item)}>
                          Ficha
                        </Button>
                        <Button
                          variant={editingTeacherId === item.id ? 'danger' : 'primary'}
                          size="sm"
                          style={{ marginLeft: 4 }}
                          onClick={() => {
                            if (editingTeacherId === item.id) {
                              setEditingTeacherId(null);
                              setForm(EMPTY_FORM);
                            } else {
                              setEditingTeacherId(item.id);
                              setForm({
                                id: item.id,
                                sourceId: item.sourceId ?? '',
                                documentId: item.documentId ?? '',
                                fullName: item.fullName,
                                email: item.email ?? '',
                                email2: item.email2 ?? '',
                                campus: item.campus ?? '',
                                region: item.region ?? '',
                                costCenter: item.costCenter ?? '',
                                coordination: item.coordination ?? '',
                                escalafon: item.escalafon ?? '',
                                dedicacion: item.dedicacion ?? '',
                                tipoContrato: item.tipoContrato ?? '',
                                fechaInicio: item.fechaInicio ? item.fechaInicio.slice(0, 10) : '',
                                fechaFin: item.fechaFin ? item.fechaFin.slice(0, 10) : '',
                                antiguedadText: item.antiguedadText ?? '',
                                programaAcademico: item.programaAcademico ?? '',
                                programaCodigo: item.programaCodigo ?? '',
                                previousEmployment: item.previousEmployment ?? false,
                              });
                            }
                          }}
                        >
                          {editingTeacherId === item.id ? 'Cancelar' : 'Editar'}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          style={{ marginLeft: 4 }}
                          onClick={() => void deleteTeacher(item.id, item.fullName)}
                          disabled={loading}
                        >
                          Eliminar
                        </Button>
                      </td>
                    </tr>
                    {editingTeacherId === item.id ? (
                      <tr>
                        <td colSpan={10} style={{ padding: 0 }}>
                          <div className="controls" style={{ padding: '12px 16px', background: 'var(--primary-light)', borderLeft: '3px solid var(--primary)', margin: 0 }}>
                            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 8, color: 'var(--primary)' }}>
                              Editando: {item.fullName}
                            </div>
                            <label>ID docente<input value={form.id} readOnly style={{ background: 'var(--line)' }} /></label>
                            <label>sourceId<input value={form.sourceId} onChange={(e) => setForm((p) => ({ ...p, sourceId: e.target.value }))} /></label>
                            <label>documentId<input value={form.documentId} onChange={(e) => setForm((p) => ({ ...p, documentId: e.target.value }))} /></label>
                            <label style={{ minWidth: 260 }}>Nombre<input value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} /></label>
                            <label style={{ minWidth: 240 }}>Correo principal<input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="correo@universidad.edu.co" /></label>
                            <label style={{ minWidth: 240 }}>Correo 2 (admin)<input value={form.email2} onChange={(e) => setForm((p) => ({ ...p, email2: e.target.value }))} placeholder="correo@universidad.edu" /></label>
                            <label>Campus<input value={form.campus} onChange={(e) => setForm((p) => ({ ...p, campus: e.target.value }))} /></label>
                            <label>Region<input value={form.region} onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))} /></label>
                            <label>Centro costo<input value={form.costCenter} onChange={(e) => setForm((p) => ({ ...p, costCenter: e.target.value }))} /></label>
                            <label style={{ minWidth: 220 }}>Coordinacion<input value={form.coordination} onChange={(e) => setForm((p) => ({ ...p, coordination: e.target.value }))} /></label>
                            <Button variant="primary" size="sm" onClick={() => void saveTeacher()} disabled={saving} loading={saving}>
                              Guardar cambios
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setEditingTeacherId(null); setForm(EMPTY_FORM); }}>
                              Cancelar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                  );
                })}
                {!result.items.length ? (
                  <tr>
                    <td colSpan={10}>No hay docentes para este filtro.</td>
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
        <Button variant="primary" size="sm" onClick={() => void loadCoordinators()} disabled={coordinatorsLoading} loading={coordinatorsLoading}>
          Actualizar coordinadores
        </Button>
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
                  <Fragment key={item.id}>
                    <tr style={editingCoordinatorId === item.id ? { background: 'var(--surface-2, #f0f4ff)' } : undefined}>
                      <td>{item.programId}</td>
                      <td>{item.fullName}</td>
                      <td>{item.email}</td>
                      <td>{item.campus ?? '-'}</td>
                      <td>{item.region ?? '-'}</td>
                      <td>{item.sourceSheet ?? '-'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Button
                          variant={editingCoordinatorId === item.id ? 'danger' : 'primary'}
                          size="sm"
                          onClick={() => {
                            if (editingCoordinatorId === item.id) {
                              setEditingCoordinatorId(null);
                              setCoordinatorForm(EMPTY_COORDINATOR_FORM);
                            } else {
                              setEditingCoordinatorId(item.id);
                              setCoordinatorForm({
                                id: item.id,
                                programId: item.programId,
                                fullName: item.fullName,
                                email: item.email,
                                campus: item.campus ?? '',
                                region: item.region ?? '',
                              });
                            }
                          }}
                        >
                          {editingCoordinatorId === item.id ? 'Cancelar' : 'Editar'}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          style={{ marginLeft: 4 }}
                          onClick={() => void deleteCoordinator(item.id, item.fullName)}
                          disabled={coordinatorsLoading}
                        >
                          Eliminar
                        </Button>
                      </td>
                    </tr>
                    {editingCoordinatorId === item.id ? (
                      <tr>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <div className="controls" style={{ padding: '12px 16px', background: 'var(--primary-light)', borderLeft: '3px solid var(--primary)', margin: 0 }}>
                            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 8, color: 'var(--primary)' }}>
                              Editando: {item.fullName}
                            </div>
                            <label style={{ minWidth: 260 }}>Programa<input value={coordinatorForm.programId} onChange={(e) => setCoordinatorForm((p) => ({ ...p, programId: e.target.value }))} /></label>
                            <label style={{ minWidth: 260 }}>Nombre<input value={coordinatorForm.fullName} onChange={(e) => setCoordinatorForm((p) => ({ ...p, fullName: e.target.value }))} /></label>
                            <label style={{ minWidth: 260 }}>Correo<input value={coordinatorForm.email} onChange={(e) => setCoordinatorForm((p) => ({ ...p, email: e.target.value }))} /></label>
                            <label>Campus<input value={coordinatorForm.campus} onChange={(e) => setCoordinatorForm((p) => ({ ...p, campus: e.target.value }))} /></label>
                            <label>Region<input value={coordinatorForm.region} onChange={(e) => setCoordinatorForm((p) => ({ ...p, region: e.target.value }))} /></label>
                            <Button variant="primary" size="sm" onClick={() => void saveCoordinator()} disabled={savingCoordinator} loading={savingCoordinator}>
                              Guardar cambios
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setEditingCoordinatorId(null); setCoordinatorForm(EMPTY_COORDINATOR_FORM); }}>
                              Cancelar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
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
        {editingTeacherId ? `Editando docente: ${form.fullName || form.id}` : '2) Agregar / Editar docente'}
      </div>
      <div className="controls">
        <Button
          variant={editingTeacherId ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => {
            if (!editingTeacherId) setShowTeacherForm((v) => !v);
          }}
        >
          {editingTeacherId ? 'Formulario abierto (modo edición)' : showTeacherForm ? 'Cerrar formulario' : '+ Agregar docente nuevo'}
        </Button>
        {editingTeacherId && (
          <Button variant="danger" size="sm" onClick={() => { setEditingTeacherId(null); setForm(EMPTY_FORM); }}>
            Cancelar edición
          </Button>
        )}
      </div>

      {(showTeacherForm || editingTeacherId) && (
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: 16, marginTop: 8 }}>
          {/* IDENTIDAD */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Identidad
          </div>
          <div className="controls" style={{ marginBottom: 12 }}>
            <label>ID docente
              <input value={form.id} onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))} />
            </label>
            <label>sourceId
              <input value={form.sourceId} onChange={(e) => setForm((p) => ({ ...p, sourceId: e.target.value }))} />
            </label>
            <label>Cédula
              <input value={form.documentId} onChange={(e) => setForm((p) => ({ ...p, documentId: e.target.value }))} />
            </label>
            <label style={{ minWidth: 280 }}>Nombre completo
              <input value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} />
            </label>
            <label style={{ minWidth: 240 }}>Correo principal
              <input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="correo@uniminuto.edu.co" />
            </label>
            <label style={{ minWidth: 240 }}>Correo 2 (admin)
              <input value={form.email2} onChange={(e) => setForm((p) => ({ ...p, email2: e.target.value }))} placeholder="correo@uniminuto.edu" />
            </label>
          </div>

          {/* UBICACIÓN Y PROGRAMA */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Ubicación y programa
          </div>
          <div className="controls" style={{ marginBottom: 12 }}>
            <label>Sede / Campus
              <input value={form.campus} onChange={(e) => setForm((p) => ({ ...p, campus: e.target.value }))} />
            </label>
            <label>Región
              <input value={form.region} onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))} />
            </label>
            <label>Centro costo
              <input value={form.costCenter} onChange={(e) => setForm((p) => ({ ...p, costCenter: e.target.value }))} />
            </label>
            <label style={{ minWidth: 240 }}>Coordinación
              <input value={form.coordination} onChange={(e) => setForm((p) => ({ ...p, coordination: e.target.value }))} />
            </label>
            <label style={{ minWidth: 200 }}>Programa académico
              <input value={form.programaAcademico} onChange={(e) => setForm((p) => ({ ...p, programaAcademico: e.target.value }))} />
            </label>
            <label>Código programa
              <input value={form.programaCodigo} onChange={(e) => setForm((p) => ({ ...p, programaCodigo: e.target.value }))} placeholder="ej. AEMD" />
            </label>
          </div>

          {/* VINCULACIÓN CONTRACTUAL */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Vinculación contractual
          </div>
          <div className="controls" style={{ marginBottom: 12 }}>
            <label>Escalafón
              <select value={form.escalafon} onChange={(e) => setForm((p) => ({ ...p, escalafon: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                <option value="PROFESOR HORA CATEDRA">Profesor hora cátedra</option>
                <option value="PROFESOR INSTRUCTOR 1">Profesor instructor 1</option>
                <option value="PROFESOR INSTRUCTOR 2">Profesor instructor 2</option>
                <option value="PROFESOR I">Profesor I</option>
                <option value="PROFESOR ASISTENTE 1">Profesor asistente 1</option>
                <option value="PROFESOR ASISTENTE 2">Profesor asistente 2</option>
                <option value="PROFESOR ASOCIADO 1">Profesor asociado 1</option>
                <option value="PROFESOR ASOCIADO 2">Profesor asociado 2</option>
              </select>
            </label>
            <label>Dedicación
              <select value={form.dedicacion} onChange={(e) => setForm((p) => ({ ...p, dedicacion: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                <option value="TIEMPO COMPLETO">Tiempo completo</option>
                <option value="MEDIO TIEMPO">Medio tiempo</option>
                <option value="TIEMPO PARCIAL">Tiempo parcial</option>
              </select>
            </label>
            <label>Tipo contrato
              <select value={form.tipoContrato} onChange={(e) => setForm((p) => ({ ...p, tipoContrato: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                <option value="TERMINO FIJO">Término fijo</option>
                <option value="ANUALIZADO">Anualizado</option>
                <option value="INDEFINIDO">Indefinido</option>
              </select>
            </label>
            <label>Fecha inicio
              <input type="date" value={form.fechaInicio} onChange={(e) => setForm((p) => ({ ...p, fechaInicio: e.target.value }))} />
            </label>
            <label>Fecha fin
              <input type="date" value={form.fechaFin} onChange={(e) => setForm((p) => ({ ...p, fechaFin: e.target.value }))} />
            </label>
            <label style={{ minWidth: 240 }}>Antigüedad (texto libre)
              <input value={form.antiguedadText} onChange={(e) => setForm((p) => ({ ...p, antiguedadText: e.target.value }))} placeholder="ej. 2 AÑOS, 3 MESES" />
            </label>
          </div>

          {/* HISTORIAL */}
          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
              <input
                type="checkbox"
                checked={form.previousEmployment}
                onChange={(e) => setForm((p) => ({ ...p, previousEmployment: e.target.checked }))}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                Ya trabajó antes en UNIMINUTO (regreso a la institución)
              </span>
            </label>
            <p style={{ margin: '6px 0 0 26px', fontSize: 11, color: '#78350f' }}>
              Si está marcado, el docente cuenta como ANTIGUO desde el primer día sin importar la fecha de inicio.
              Útil para docentes que retornan tras un periodo de inactividad.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="sm" onClick={() => void saveTeacher()} disabled={saving} loading={saving}>
              {editingTeacherId ? 'Guardar cambios' : 'Crear docente'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditingTeacherId(null); setForm(EMPTY_FORM); setShowTeacherForm(false); }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="subtitle" style={{ marginTop: 14 }}>
        2.1) Agregar / Editar coordinador
      </div>
      <div className="controls">
        <Button variant={coordinatorForm.id ? 'secondary' : 'primary'} size="sm" onClick={() => setShowCoordinatorForm((v) => !v)}>
          {coordinatorForm.id
            ? `Editando: ${coordinatorForm.fullName || coordinatorForm.id}`
            : showCoordinatorForm ? 'Cerrar formulario' : '+ Agregar coordinador nuevo'}
        </Button>
        {coordinatorForm.id && (
          <Button variant="danger" size="sm" onClick={() => setCoordinatorForm(EMPTY_COORDINATOR_FORM)}>
            Cancelar edición
          </Button>
        )}
      </div>

      {(showCoordinatorForm || coordinatorForm.id) && (
        <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 8, padding: 16, marginTop: 8 }}>
          <div className="controls">
            <label>ID coordinador
              <input
                value={coordinatorForm.id}
                onChange={(e) => setCoordinatorForm((p) => ({ ...p, id: e.target.value }))}
                placeholder="Automático al crear"
              />
            </label>
            <label style={{ minWidth: 220 }}>Programa (programId)
              <input value={coordinatorForm.programId} onChange={(e) => setCoordinatorForm((p) => ({ ...p, programId: e.target.value }))} />
            </label>
            <label style={{ minWidth: 280 }}>Nombre
              <input value={coordinatorForm.fullName} onChange={(e) => setCoordinatorForm((p) => ({ ...p, fullName: e.target.value }))} />
            </label>
            <label style={{ minWidth: 280 }}>Correo
              <input value={coordinatorForm.email} onChange={(e) => setCoordinatorForm((p) => ({ ...p, email: e.target.value }))} />
            </label>
            <label>Campus
              <input value={coordinatorForm.campus} onChange={(e) => setCoordinatorForm((p) => ({ ...p, campus: e.target.value }))} />
            </label>
            <label>Región
              <input value={coordinatorForm.region} onChange={(e) => setCoordinatorForm((p) => ({ ...p, region: e.target.value }))} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" size="sm" onClick={() => void saveCoordinator()} disabled={savingCoordinator} loading={savingCoordinator}>
              {coordinatorForm.id ? 'Guardar cambios' : 'Crear coordinador'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setCoordinatorForm(EMPTY_COORDINATOR_FORM); setShowCoordinatorForm(false); }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* SECCIÓN 3: IMPORTAR Y MANTENIMIENTO (consolidación de antiguas 2.5, 2.8 y 3) */}
      <div className="subtitle" style={{ marginTop: 14 }}>
        3) Importar y mantenimiento
      </div>
      <div className="actions">
        Acciones masivas: importar desde archivo (CSV/Excel) o limpiar la base.
      </div>
      <div className="controls">
        <Button variant={showMaintenance ? 'danger' : 'primary'} size="sm" onClick={() => setShowMaintenance((v) => !v)}>
          {showMaintenance ? 'Ocultar herramientas' : 'Mostrar herramientas de importación / limpieza'}
        </Button>
      </div>

      {showMaintenance && (<>
      <div className="subtitle" style={{ marginTop: 14, fontSize: 14 }}>
        3.1) Depuración y consolidación de docentes
      </div>
      <div className="actions">
        Encuentra y fusiona docentes duplicados (mismo sourceId Banner). Util para limpiar la base antes de sincronizar.
      </div>
      <div className="controls" style={{ marginTop: 6 }}>
        <Button variant="primary" size="sm" onClick={() => void loadDedupPreview()} disabled={dedupLoading} loading={dedupLoading}>
          Analizar duplicados
        </Button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={dedupRemoveOrphans} onChange={(e) => setDedupRemoveOrphans(e.target.checked)} />
          Eliminar tambien docentes sin cursos asignados
        </label>
      </div>

      {dedupPreviewResult ? (
        <div style={{ marginTop: 10, padding: '12px 16px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8 }}>
          <div className="badges" style={{ marginBottom: 10 }}>
            <StatusPill tone="neutral">Total: {dedupPreviewResult.totalTeachers}</StatusPill>
            <StatusPill tone="neutral">Grupos: {dedupPreviewResult.duplicateGroupCount}</StatusPill>
            <StatusPill tone={dedupPreviewResult.teachersThatWouldBeDeleted > 0 ? 'warn' : 'ok'}>
              Eliminarían: {dedupPreviewResult.teachersThatWouldBeDeleted}
            </StatusPill>
            <StatusPill tone="neutral">Sin cursos: {dedupPreviewResult.orphansWithNoCourses}</StatusPill>
            <StatusPill tone="ok">Resultado estimado: {dedupPreviewResult.estimatedAfterMerge}</StatusPill>
          </div>
          {dedupPreviewResult.duplicateGroupCount > 0 ? (
            <>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                Primeros {Math.min(dedupPreviewResult.groups.length, 10)} grupos (se conserva el de mas cursos):
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
                <table className="fast-table" style={{ fontSize: '0.78rem' }}>
                  <thead><tr><th>sourceId</th><th>Conservar</th><th>Duplicados</th><th>Cursos</th></tr></thead>
                  <tbody>
                    {dedupPreviewResult.groups.slice(0, 10).map((g) => (
                      <tr key={g.sourceId ?? g.keepId}>
                        <td style={{ fontFamily: 'monospace' }}>{g.sourceId}</td>
                        <td>{g.keepName}</td>
                        <td>{g.teachers.slice(1).map((t) => t.fullName).join(', ')}</td>
                        <td>{g.teachers[0].courseCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="controls" style={{ marginTop: 10 }}>
                <Button variant="danger" size="sm" onClick={() => void applyDedup()} disabled={dedupApplying} loading={dedupApplying}>
                  Consolidar duplicados ({dedupPreviewResult.teachersThatWouldBeDeleted} registros)
                </Button>
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--green, #16a34a)', fontSize: '0.85rem' }}>
              No se encontraron duplicados por sourceId. La base esta limpia.
            </div>
          )}
        </div>
      ) : null}

      {dedupApplyResult ? (
        <div className="badges" style={{ marginTop: 8 }}>
          <StatusPill tone="neutral">Fusionados: {dedupApplyResult.mergedGroups}</StatusPill>
          <StatusPill tone="warn">Eliminados: {dedupApplyResult.deletedTeachers}</StatusPill>
          <StatusPill tone="neutral">Cursos reasignados: {dedupApplyResult.coursesReassigned}</StatusPill>
          {dedupApplyResult.orphansDeleted > 0 ? <StatusPill tone="warn">Huérfanos: {dedupApplyResult.orphansDeleted}</StatusPill> : null}
          <StatusPill tone="ok">Total ahora: {dedupApplyResult.finalTeacherCount}</StatusPill>
        </div>
      ) : null}

      <div className="subtitle" style={{ marginTop: 14, fontSize: 14 }}>
        3.2) Limpiar base — conservar solo docentes del lote Banner actual
      </div>
      <div className="actions">
        Elimina todos los docentes que NO aparecen como <span className="code">ENCONTRADO</span> en el ultimo CSV exportado por Banner. Util para dejar solo los docentes activos del semestre en curso.
      </div>
      <div className="controls" style={{ marginTop: 6 }}>
        <Button variant="primary" size="sm" onClick={() => void loadBannerKeepPreview()} disabled={bannerKeepLoading || bannerKeepApplying} loading={bannerKeepLoading}>
          Analizar (usar lote Banner actual)
        </Button>
      </div>

      {bannerKeepPreview ? (
        <div style={{ marginTop: 10, padding: '12px 16px', background: 'var(--amber-light)', border: '1px solid var(--amber)', borderRadius: 8 }}>
          <div className="badges" style={{ marginBottom: 10 }}>
            <StatusPill tone="ok">Conservar: {bannerKeepPreview.toKeepCount}</StatusPill>
            <StatusPill tone={bannerKeepPreview.toDeleteCount > 0 ? 'warn' : 'ok'}>
              Eliminar: {bannerKeepPreview.toDeleteCount}
            </StatusPill>
            <StatusPill tone="neutral">Sin docente: {bannerKeepPreview.coursesToUnlink}</StatusPill>
            <StatusPill tone="neutral">En lote: {bannerKeepPreview.uniqueTeachersInBatch}</StatusPill>
          </div>
          <div style={{ fontSize: '0.78rem', color: '#78716c', marginBottom: 8 }}>
            Fuente: <span style={{ fontFamily: 'monospace' }}>{bannerKeepPreview.csvFile}</span>
          </div>
          {bannerKeepPreview.samples.length > 0 ? (
            <>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                Muestra de docentes que se eliminarian ({bannerKeepPreview.samples.length} de {bannerKeepPreview.toDeleteCount}):
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
                <table className="fast-table" style={{ fontSize: '0.78rem' }}>
                  <thead>
                    <tr><th>Nombre</th><th>sourceId</th><th>Cursos vinculados</th></tr>
                  </thead>
                  <tbody>
                    {bannerKeepPreview.samples.map((s) => (
                      <tr key={s.id}>
                        <td>{s.fullName}</td>
                        <td style={{ fontFamily: 'monospace', color: s.sourceId ? undefined : '#9ca3af' }}>{s.sourceId ?? '(sin sourceId)'}</td>
                        <td style={{ textAlign: 'center', color: s.courseCount > 0 ? '#b45309' : '#9ca3af' }}>{s.courseCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {bannerKeepPreview.toDeleteCount > 0 ? (
            <div className="controls" style={{ marginTop: 12 }}>
              <Button variant="danger" size="sm" onClick={() => void applyBannerKeep()} disabled={bannerKeepApplying} loading={bannerKeepApplying}>
                Aplicar limpieza (eliminar {bannerKeepPreview.toDeleteCount} docentes)
              </Button>
            </div>
          ) : (
            <div style={{ color: 'var(--green, #16a34a)', fontSize: '0.85rem', marginTop: 8 }}>
              Todos los docentes en la base ya estan en el lote Banner. No hay nada que limpiar.
            </div>
          )}
        </div>
      ) : null}

      {bannerKeepResult ? (
        <div className="badges" style={{ marginTop: 8 }}>
          <StatusPill tone="warn">Eliminados: {bannerKeepResult.deletedTeachers}</StatusPill>
          <StatusPill tone="neutral">Desvinculados: {bannerKeepResult.unlinkedCourses}</StatusPill>
          <StatusPill tone="ok">Total ahora: {bannerKeepResult.finalTeacherCount}</StatusPill>
          <StatusPill tone="neutral">En lote: {bannerKeepResult.uniqueTeachersInBatch}</StatusPill>
        </div>
      ) : null}

      <div className="subtitle" style={{ marginTop: 14, fontSize: 14 }}>
        3.3) Importar docentes y coordinadores desde archivo
      </div>
      <div className="actions">
        Un solo CSV sirve para docentes y coordinadores. Agrega la columna <span className="code">tipo</span> con valor <span className="code">DOCENTE</span> o <span className="code">COORDINADOR</span> (si la omites, se trata como docente). Los coordinadores necesitan la columna <span className="code">programa_id</span>. Los docentes pueden tener <span className="code">correo</span> (académico, .edu.co) y <span className="code">correo2</span> (administrativo, .edu).
        También puedes usar un Excel maestro con hojas separadas.
      </div>

      <div style={{ marginTop: 10, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <strong style={{ fontSize: 13 }}>Opción A — CSV unificado</strong>
        <div className="controls" style={{ marginTop: 8 }}>
          <label style={{ minWidth: 340 }}>
            Archivo(s) CSV
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={(event) => setCsvFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const csv = 'tipo,id,cedula,nombre,correo,correo2,sede,region,centrocosto,coordinacion,programa_id\n'
                + 'DOCENTE,12345,1001234567,Juan Pérez García,jperez@universidad.edu.co,jperez@universidad.edu,Bogotá,Centro,CC-001,Ingeniería de Sistemas,\n'
                + 'COORDINADOR,,,María López Ruiz,mlopez@universidad.edu,,Bogotá,Centro,,,Ingeniería de Sistemas\n';
              const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'plantilla_docentes_coordinadores.csv';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Plantilla CSV
          </Button>
          <Button variant="primary" size="sm" onClick={() => void importUnifiedCsv()} disabled={importing} loading={importing}>
            Importar CSV
          </Button>
        </div>
        {csvFiles.length ? (
          <div className="actions">Archivos seleccionados: <span className="code">{csvFiles.map(f => f.name).join(", ")}</span></div>
        ) : null}
        {importResult ? (
          <div className="badges" style={{ marginTop: 8 }}>
            <StatusPill tone="neutral">Filas: {importResult.totalRows}</StatusPill>
            <StatusPill tone="ok">Nuevos: {importResult.created}</StatusPill>
            <StatusPill tone="neutral">Actualizados: {importResult.updated}</StatusPill>
            <StatusPill tone="neutral">Omitidos: {importResult.skipped}</StatusPill>
          </div>
        ) : null}
        {importResult?.errors?.length ? (
          <div className="actions" style={{ marginTop: 6, color: "var(--red)" }}>
            Errores: {importResult.errors.slice(0, 5).join(" | ")}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 10, padding: "10px 14px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8 }}>
        <strong style={{ fontSize: 13 }}>Opción B — Excel maestro (.xlsx)</strong>
        <div className="controls" style={{ marginTop: 8 }}>
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220 }}>
            <input
              type="checkbox"
              checked={includeCoordinators}
              onChange={(event) => setIncludeCoordinators(event.target.checked)}
            />
            Incluir coordinadores
          </label>
          <Button variant="primary" size="sm" onClick={() => void importWorkbook()} disabled={importingWorkbook} loading={importingWorkbook}>
            Importar Excel
          </Button>
        </div>
        {workbookFile ? (
          <div className="actions">Archivo: <span className="code">{workbookFile.name}</span></div>
        ) : null}
        {workbookImportResult ? (
          <>
            <div className="badges" style={{ marginTop: 8 }}>
              <StatusPill tone="ok">Docentes nuevos: {workbookImportResult.createdTeachers}</StatusPill>
              <StatusPill tone="neutral">Actualizados: {workbookImportResult.updatedTeachers}</StatusPill>
              <StatusPill tone="neutral">Omitidos: {workbookImportResult.skippedRows}</StatusPill>
              <StatusPill tone="ok">Coordinadores nuevos: {workbookImportResult.createdCoordinators}</StatusPill>
              <StatusPill tone="neutral">Coordinadores actualizados: {workbookImportResult.updatedCoordinators}</StatusPill>
            </div>
          </>
        ) : null}
      </div>
      </>)}

      {message ? <AlertBox tone="info">{message}</AlertBox> : null}
      </div>

      {detailTeacher && (() => {
        const t = detailTeacher;
        const status = classifyTeacher(t.fechaInicio, t.previousEmployment);
        const sb = statusBadge(status);
        const weeks = weeksSince(t.fechaInicio);
        const daysToEnd = daysUntilContractEnd(t.fechaFin);
        const matchedCoord = coordinatorsResult?.items
          ? findCoordinatorMatch(t, coordinatorsResult.items)
          : null;
        const fields: { label: string; value: string | null; warn?: boolean }[] = [
          { label: 'ID', value: t.id },
          { label: 'Cédula', value: t.documentId },
          { label: 'Correo institucional', value: t.email },
          { label: 'Correo administrativo', value: t.email2 },
          { label: 'Sede', value: t.campus },
          { label: 'Región', value: t.region },
          { label: 'Coordinación', value: t.coordination },
          { label: 'Centro de costo', value: t.costCenter },
          { label: 'Programa académico', value: t.programaAcademico },
          { label: 'Código programa', value: t.programaCodigo },
        ];
        const contractFields: { label: string; value: string | null; warn?: boolean; danger?: boolean }[] = [
          { label: 'Escalafón', value: t.escalafon },
          { label: 'Dedicación', value: t.dedicacion },
          { label: 'Tipo de contrato', value: t.tipoContrato },
          { label: 'Fecha inicio', value: t.fechaInicio ? formatDate(t.fechaInicio) : null },
          {
            label: 'Fecha fin',
            value: t.fechaFin ? formatDate(t.fechaFin) : null,
            warn: daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= 30,
            danger: daysToEnd !== null && daysToEnd < 0,
          },
          { label: 'Antigüedad', value: t.antiguedadText },
        ];
        return (
          <Modal
            open
            onClose={() => setDetailTeacher(null)}
            size="lg"
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {t.fullName}
                <span style={{ padding: '2px 9px', borderRadius: 999, background: sb.bg, color: sb.color, border: `1px solid ${sb.border}`, fontSize: 10, fontWeight: 700 }}>{sb.label}</span>
                {weeks !== null && (
                  <span style={{ padding: '2px 9px', borderRadius: 999, background: '#eef2ff', color: '#1e40af', fontSize: 10, fontWeight: 600 }}>
                    {weeks} semana{weeks !== 1 ? 's' : ''} en la institución
                  </span>
                )}
              </span>
            }
            footer={
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setEditingTeacherId(t.id);
                  setForm({
                    id: t.id,
                    sourceId: t.sourceId ?? '',
                    documentId: t.documentId ?? '',
                    fullName: t.fullName,
                    email: t.email ?? '',
                    email2: t.email2 ?? '',
                    campus: t.campus ?? '',
                    region: t.region ?? '',
                    costCenter: t.costCenter ?? '',
                    coordination: t.coordination ?? '',
                    escalafon: t.escalafon ?? '',
                    dedicacion: t.dedicacion ?? '',
                    tipoContrato: t.tipoContrato ?? '',
                    fechaInicio: t.fechaInicio ? t.fechaInicio.slice(0, 10) : '',
                    fechaFin: t.fechaFin ? t.fechaFin.slice(0, 10) : '',
                    antiguedadText: t.antiguedadText ?? '',
                    programaAcademico: t.programaAcademico ?? '',
                    programaCodigo: t.programaCodigo ?? '',
                    previousEmployment: t.previousEmployment ?? false,
                  });
                  setShowTeacherForm(true);
                  setDetailTeacher(null);
                  setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
                }}
              >
                Editar este docente
              </Button>
            }
          >
                <h3 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5 }}>Información general</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 24 }}>
                  {fields.map((f) => (
                    <div key={f.label} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: 6 }}>
                      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 }}>{f.label}</div>
                      <div style={{ fontSize: 14, color: f.value ? '#0f172a' : '#dc2626', fontStyle: f.value ? 'normal' : 'italic', fontWeight: f.value ? 500 : 400 }}>
                        {f.value || 'Sin información'}
                      </div>
                    </div>
                  ))}
                </div>

                <h3 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5 }}>Vinculación contractual</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 24 }}>
                  {contractFields.map((f) => {
                    const bg = f.danger ? '#fee2e2' : f.warn ? '#fef3c7' : 'transparent';
                    const fg = f.danger ? '#991b1b' : f.warn ? '#92400e' : f.value ? '#0f172a' : '#dc2626';
                    return (
                      <div key={f.label} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: 6, paddingLeft: bg !== 'transparent' ? 8 : 0, background: bg, borderRadius: bg !== 'transparent' ? 4 : 0 }}>
                        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 }}>{f.label}</div>
                        <div style={{ fontSize: 14, color: fg, fontStyle: f.value ? 'normal' : 'italic', fontWeight: f.value ? 500 : 400 }}>
                          {f.value || 'Sin información'}
                          {f.label === 'Fecha fin' && daysToEnd !== null && (
                            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700 }}>
                              {daysToEnd < 0 ? `(vencido hace ${Math.abs(daysToEnd)} días)` : daysToEnd <= 30 ? `(termina en ${daysToEnd} días)` : `(${daysToEnd} días restantes)`}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Coordinador asignado */}
                {matchedCoord && (
                  <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: '#166534', textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 700 }}>Coordinador asignado</div>
                    <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, marginTop: 4 }}>{matchedCoord.fullName}</div>
                    <div style={{ fontSize: 12, color: '#166534' }}>{matchedCoord.email}</div>
                  </div>
                )}
                {!matchedCoord && (
                  <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12, color: '#92400e' }}>
                    ⚠ No se encontró coordinador asignado para esta coordinación.
                  </div>
                )}

                {/* Indicador regreso institución */}
                {t.previousEmployment && (
                  <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 12, color: '#1e40af' }}>
                    🔁 <strong>Docente que regresó a la institución.</strong> Cuenta como ANTIGUO desde el primer día.
                  </div>
                )}

                {/* Política de evaluación */}
                <div style={{ background: '#f1f5f9', borderRadius: 8, padding: 12, fontSize: 12, color: '#334155', borderLeft: '4px solid #1e40af', marginBottom: 12 }}>
                  <strong>Política de evaluación según estado:</strong>
                  <ul style={{ margin: '6px 0 0 0', paddingLeft: 20 }}>
                    {status === 'NUEVO' && (
                      <>
                        <li>Si obtiene calificación insatisfactoria → <strong>plan de inducción y acompañamiento</strong> (sin sanción).</li>
                        <li>Pasa a ANTIGUO al cumplir ≥8 semanas + completar un momento de evaluación.</li>
                      </>
                    )}
                    {status === 'ANTIGUO' && (
                      <li>Si obtiene calificación insatisfactoria → <strong style={{ color: '#991b1b' }}>se genera evento significativo</strong> en hoja de vida.</li>
                    )}
                    {status === 'SIN_CONTRATO' && (
                      <li>Sin información contractual disponible — completar fecha de inicio para clasificar.</li>
                    )}
                  </ul>
                </div>

          </Modal>
        );
      })()}

    </article>
  );
}
