'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type EvaluationSummary = {
  alistamientoScore: number | null;
  ejecucionScore: number | null;
  latestPhase: string | null;
  latestScore: number | null;
  latestObservations: string | null;
  latestComputedAt: string | null;
  latestReplicatedFromCourseId: string | null;
};

type SelectedSampleGroup = {
  id: string;
  moment: string;
  template: string;
  programCode: string;
  modality: string;
};

type CourseItem = {
  id: string;
  nrc: string;
  period: { code: string; semester?: number | null };
  campusCode?: string | null;
  moment: string | null;
  subjectName: string | null;
  programCode: string | null;
  programName: string | null;
  teacherId: string | null;
  teacher:
    | {
        id: string;
        sourceId: string | null;
        documentId: string | null;
        fullName: string;
      }
    | null;
  moodleCheck:
    | {
        status: string;
        detectedTemplate: string | null;
        moodleCourseUrl?: string | null;
        moodleCourseId?: string | null;
        resolvedModality?: string | null;
      }
    | null;
  bannerReviewStatus?: string | null;
  reviewExcluded?: boolean;
  reviewExcludedReason?: string | null;
  selectedForChecklist?: boolean;
  selectedSampleGroups?: SelectedSampleGroup[];
  checklistTemporal?: {
    active: boolean;
    reason: string | null;
    at: string | null;
  };
  moodleSidecarMetrics?: {
    participants: number | null;
    participantsDetected: boolean | null;
    updatedAt: string | null;
  };
  enrolledCount?: number | null;
  evaluationSummary?: EvaluationSummary | null;
};

type CoursesListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: CourseItem[];
};

type NrcGlobalPanelProps = {
  apiBase: string;
};

type CourseDetailResponse = CourseItem & {
  bannerStartDate?: string | null;
  bannerEndDate?: string | null;
  evaluations: Array<{
    id: string;
    phase: string;
    score: number;
    observations: string | null;
    computedAt: string;
    replicatedFromCourseId: string | null;
    replicatedFromNrc?: string | null;
    evaluationType?: 'MANUAL' | 'REPLICADA';
  }>;
  selectedSampleGroups?: Array<
    SelectedSampleGroup & {
      selectionSeed?: string;
      createdAt?: string;
    }
  >;
};

type OverrideFormState = {
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  score: string;
  observations: string;
  saving: boolean;
  status: string;
};

type OutboxPreviewResponse = {
  id: string;
  subject: string;
  htmlBody: string;
  recipientName: string | null;
  recipientEmail: string | null;
  status: string;
  phase: string;
  moment: string;
  audience: string;
  periodCode: string;
  periodLabel: string;
  updatedAt: string;
  courseId?: string;
  nrc?: string;
  teacherId?: string | null;
  teacherName?: string | null;
};

type PendingPreviewSend = {
  courseId: string;
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  nrc: string;
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildSearchText(item: CourseItem): string {
  return normalizeText(
    [
      item.nrc,
      item.period.code,
      item.moment ?? '',
      item.subjectName ?? '',
      item.programCode ?? '',
      item.programName ?? '',
      item.teacherId ?? '',
      item.teacher?.id ?? '',
      item.teacher?.sourceId ?? '',
      item.teacher?.documentId ?? '',
      item.teacher?.fullName ?? '',
      item.bannerReviewStatus ?? '',
      item.moodleCheck?.status ?? '',
      item.moodleCheck?.detectedTemplate ?? '',
      item.evaluationSummary?.alistamientoScore ?? '',
      item.evaluationSummary?.ejecucionScore ?? '',
      item.reviewExcludedReason ?? '',
      item.checklistTemporal?.active ? 'temporal' : '',
      item.checklistTemporal?.reason ?? '',
    ].join(' '),
  );
}

function scoreItem(item: CourseItem, query: string): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 1;

  const searchText = buildSearchText(item);
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const compactNrc = item.nrc.toLowerCase().replace(/[^a-z0-9]/g, '');
  let score = 0;

  if (item.nrc.toLowerCase() === query.trim().toLowerCase()) score += 120;
  if (compactNrc === compactQuery) score += 110;
  if (item.nrc.toLowerCase().includes(query.trim().toLowerCase())) score += 90;
  if (compactNrc.includes(compactQuery)) score += 80;
  if (searchText.includes(normalizedQuery)) score += 55;

  const tokens = normalizedQuery.split(' ').filter(Boolean);
  for (const token of tokens) {
    if (searchText.includes(token)) score += 12;
  }

  return score;
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function NrcGlobalPanel({ apiBase }: NrcGlobalPanelProps) {
  const [items, setItems] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [teacherIdQuery, setTeacherIdQuery] = useState('');
  const [teacherNameQuery, setTeacherNameQuery] = useState('');
  const [periodFilter, setPeriodFilter] = useState('TODOS');
  const [semesterFilter, setSemesterFilter] = useState('TODOS');
  const [momentFilter, setMomentFilter] = useState('TODOS');
  const [programFilter, setProgramFilter] = useState('TODOS');
  const [campusFilter, setCampusFilter] = useState('TODOS');
  const [teacherFilter, setTeacherFilter] = useState('TODOS');
  const [bannerFilter, setBannerFilter] = useState('TODOS');
  const [reviewableFilter, setReviewableFilter] = useState('TODOS');
  const [templateFilter, setTemplateFilter] = useState('TODOS');
  const [participantsFilter, setParticipantsFilter] = useState('TODOS');
  const [enrolledFilter, setEnrolledFilter] = useState('TODOS');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailById, setDetailById] = useState<Record<string, CourseDetailResponse>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [overrideById, setOverrideById] = useState<Record<string, OverrideFormState>>({});
  const [deletingById, setDeletingById] = useState<Record<string, boolean>>({});
  const [batchDeactivating, setBatchDeactivating] = useState(false);
  const [bannerVerifying, setBannerVerifying] = useState(false);
  const [taggingTemporalById, setTaggingTemporalById] = useState<Record<string, boolean>>({});
  const [momentEditById, setMomentEditById] = useState<Record<string, string>>({});
  const [savingMomentById, setSavingMomentById] = useState<Record<string, boolean>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSending, setPreviewSending] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData] = useState<OutboxPreviewResponse | null>(null);
  const [pendingPreviewSend, setPendingPreviewSend] = useState<PendingPreviewSend | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setMessage('');
        const data = await fetchJson<CoursesListResponse>(`${apiBase}/courses?limit=5000`);
        setItems(data.items ?? []);
      } catch (error) {
        setMessage(`No fue posible cargar NRC globales: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [apiBase]);

  const periods = useMemo(
    () => ['TODOS', ...Array.from(new Set(items.map((item) => item.period.code))).sort((a, b) => a.localeCompare(b, 'es'))],
    [items],
  );

  const semesters = useMemo(
    () =>
      [
        'TODOS',
        ...Array.from(
          new Set(
            items
              .map((item) => item.period.semester)
              .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
          ),
        )
          .sort((a, b) => a - b)
          .map((value) => String(value)),
      ],
    [items],
  );

  const moments = useMemo(
    () => ['TODOS', ...Array.from(new Set(items.map((item) => item.moment ?? '-'))).sort((a, b) => a.localeCompare(b, 'es'))],
    [items],
  );

  const programs = useMemo(
    () =>
      [
        'TODOS',
        ...Array.from(new Set(items.map((item) => item.programName ?? item.programCode ?? '-'))).sort((a, b) =>
          a.localeCompare(b, 'es'),
        ),
      ],
    [items],
  );

  const campuses = useMemo(
    () =>
      [
        'TODOS',
        ...Array.from(new Set(items.map((item) => item.campusCode ?? '-'))).sort((a, b) => a.localeCompare(b, 'es')),
      ],
    [items],
  );

  const templates = useMemo(
    () =>
      [
        'TODOS',
        ...Array.from(new Set(items.map((item) => item.moodleCheck?.detectedTemplate ?? '-'))).sort((a, b) =>
          a.localeCompare(b, 'es'),
        ),
      ],
    [items],
  );

  const filteredItems = useMemo(() => {
    const normalizedTeacherIdQuery = teacherIdQuery.trim().toLowerCase();
    const normalizedTeacherNameQuery = normalizeText(teacherNameQuery);

    return items
      .map((item) => ({
        item,
        score: scoreItem(item, query),
      }))
      .filter(({ item, score }) => {
        if (query.trim() && score <= 0) return false;
        if (periodFilter !== 'TODOS' && item.period.code !== periodFilter) return false;
        if (semesterFilter !== 'TODOS' && String(item.period.semester ?? '-') !== semesterFilter) return false;
        if (momentFilter !== 'TODOS' && (item.moment ?? '-') !== momentFilter) return false;
        if (programFilter !== 'TODOS' && (item.programName ?? item.programCode ?? '-') !== programFilter) return false;
        if (campusFilter !== 'TODOS' && (item.campusCode ?? '-') !== campusFilter) return false;
        if (teacherFilter === 'CON_DOCENTE' && !item.teacherId) return false;
        if (teacherFilter === 'SIN_DOCENTE' && item.teacherId) return false;
        if (normalizedTeacherIdQuery) {
          const teacherIds = [
            item.teacherId ?? '',
            item.teacher?.id ?? '',
            item.teacher?.sourceId ?? '',
            item.teacher?.documentId ?? '',
          ]
            .map((value) => value.toLowerCase())
            .filter(Boolean);
          if (!teacherIds.some((value) => value.includes(normalizedTeacherIdQuery))) return false;
        }
        if (normalizedTeacherNameQuery) {
          const normalizedName = normalizeText(item.teacher?.fullName ?? '');
          if (!normalizedName.includes(normalizedTeacherNameQuery)) return false;
        }
        if (bannerFilter === 'SIN_DATO' && item.bannerReviewStatus) return false;
        if (bannerFilter !== 'TODOS' && bannerFilter !== 'SIN_DATO' && item.bannerReviewStatus !== bannerFilter) return false;
        if (reviewableFilter === 'SOLO_REVISABLES' && item.reviewExcluded) return false;
        if (reviewableFilter === 'SOLO_EXCLUIDOS' && !item.reviewExcluded) return false;
        if (templateFilter !== 'TODOS' && (item.moodleCheck?.detectedTemplate ?? '-') !== templateFilter) return false;
        if (participantsFilter === 'SIN_PARTICIPANTES' && typeof item.moodleSidecarMetrics?.participants === 'number' && item.moodleSidecarMetrics.participants > 0) return false;
        if (participantsFilter === 'SIN_PARTICIPANTES' && item.moodleSidecarMetrics?.participants == null) {
          // null/undefined = sin dato; mostrar como sin participantes
        }
        if (participantsFilter === 'CON_PARTICIPANTES' && (item.moodleSidecarMetrics?.participants == null || item.moodleSidecarMetrics.participants <= 0)) return false;
        if (enrolledFilter === 'SIN_INSCRITOS' && typeof item.enrolledCount === 'number' && item.enrolledCount > 0) return false;
        if (enrolledFilter === 'CON_INSCRITOS' && (item.enrolledCount == null || item.enrolledCount <= 0)) return false;
        return true;
      })
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const periodCompare = left.item.period.code.localeCompare(right.item.period.code, 'es');
        if (periodCompare !== 0) return periodCompare;
        return left.item.nrc.localeCompare(right.item.nrc, 'es');
      })
      .map(({ item }) => item);
  }, [bannerFilter, campusFilter, enrolledFilter, items, momentFilter, participantsFilter, periodFilter, programFilter, query, reviewableFilter, semesterFilter, teacherFilter, teacherIdQuery, teacherNameQuery, templateFilter]);

  const totalWithTeacher = useMemo(() => items.filter((item) => item.teacherId).length, [items]);
  const totalWithoutTeacher = useMemo(() => items.filter((item) => !item.teacherId).length, [items]);
  const totalBannerSinDocente = useMemo(
    () => items.filter((item) => item.bannerReviewStatus === 'SIN_DOCENTE').length,
    [items],
  );
  const totalBannerNoEncontrado = useMemo(
    () => items.filter((item) => item.bannerReviewStatus === 'NO_ENCONTRADO').length,
    [items],
  );
  const totalReviewExcluded = useMemo(() => items.filter((item) => item.reviewExcluded).length, [items]);
  const totalGradoPractica = useMemo(
    () => items.filter((item) => item.reviewExcludedReason === 'OPCION_GRADO_PRACTICA').length,
    [items],
  );
  const totalSelectedChecklist = useMemo(
    () => items.filter((item) => item.selectedForChecklist).length,
    [items],
  );
  const filteredParticipantsCourses = useMemo(
    () => filteredItems.filter((item) => typeof item.moodleSidecarMetrics?.participants === 'number').length,
    [filteredItems],
  );
  const filteredParticipants = useMemo(
    () =>
      filteredItems.reduce(
        (sum, item) =>
          sum + (typeof item.moodleSidecarMetrics?.participants === 'number' ? item.moodleSidecarMetrics.participants : 0),
        0,
      ),
    [filteredItems],
  );

  function formatScore(value: number | null | undefined) {
    if (value == null || Number.isNaN(value)) return '-';
    return Number(value).toFixed(1).replace(/\.0$/, '');
  }

  function formatDate(value: string | null | undefined) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('es-CO');
  }

  function formatPhaseScore(item: CourseItem) {
    const al = item.evaluationSummary?.alistamientoScore ?? null;
    const ej = item.evaluationSummary?.ejecucionScore ?? null;
    if (al == null && ej == null) return '-';
    if (al != null && ej == null) return `A: ${formatScore(al)}`;
    if (al == null && ej != null) return `E: ${formatScore(ej)}`;
    return `A: ${formatScore(al)} | E: ${formatScore(ej)}`;
  }

  function mergeDetailIntoList(detail: CourseDetailResponse) {
    const alistamiento = detail.evaluations.find((evaluation) => evaluation.phase === 'ALISTAMIENTO') ?? null;
    const ejecucion = detail.evaluations.find((evaluation) => evaluation.phase === 'EJECUCION') ?? null;
    const latest = detail.evaluations[0] ?? null;

    setItems((previous) =>
      previous.map((item) =>
        item.id !== detail.id
          ? item
          : {
              ...item,
              teacherId: detail.teacherId,
              teacher: detail.teacher,
              moodleCheck: detail.moodleCheck,
              bannerReviewStatus: detail.bannerReviewStatus,
              selectedForChecklist: detail.selectedForChecklist,
              selectedSampleGroups: detail.selectedSampleGroups?.map((group) => ({
                id: group.id,
                moment: group.moment,
                template: group.template,
                programCode: group.programCode,
                modality: group.modality,
              })),
              checklistTemporal: detail.checklistTemporal,
              moodleSidecarMetrics: detail.moodleSidecarMetrics,
              reviewExcluded: detail.reviewExcluded,
              reviewExcludedReason: detail.reviewExcludedReason,
              evaluationSummary: {
                alistamientoScore: alistamiento?.score ?? null,
                ejecucionScore: ejecucion?.score ?? null,
                latestPhase: latest?.phase ?? null,
                latestScore: latest?.score ?? null,
                latestObservations: latest?.observations ?? null,
                latestComputedAt: latest?.computedAt ?? null,
                latestReplicatedFromCourseId: latest?.replicatedFromCourseId ?? null,
              },
            },
      ),
    );
  }

  async function loadCourseDetail(courseId: string) {
    try {
      setLoadingDetailId(courseId);
      const response = await fetch(`${apiBase}/courses/${courseId}`, { cache: 'no-store' });
      const data = (await response.json()) as CourseDetailResponse & { message?: string | string[] };
      if (!response.ok) {
        const text = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? `HTTP ${response.status}`);
        throw new Error(text);
      }
      setDetailById((previous) => ({
        ...previous,
        [courseId]: data,
      }));
      mergeDetailIntoList(data);

      setOverrideById((previous) => {
        const scoreByPhase = {
          ALISTAMIENTO: data.evaluations.find((evaluation) => evaluation.phase === 'ALISTAMIENTO')?.score ?? '',
          EJECUCION: data.evaluations.find((evaluation) => evaluation.phase === 'EJECUCION')?.score ?? '',
        };
        const obsByPhase = {
          ALISTAMIENTO: data.evaluations.find((evaluation) => evaluation.phase === 'ALISTAMIENTO')?.observations ?? '',
          EJECUCION: data.evaluations.find((evaluation) => evaluation.phase === 'EJECUCION')?.observations ?? '',
        };
        const current = previous[courseId];
        if (current) {
          // Ya existe: actualiza score y observaciones con los valores confirmados del servidor
          // (mantiene la fase seleccionada por el usuario)
          return {
            ...previous,
            [courseId]: {
              ...current,
              score: scoreByPhase[current.phase] === '' ? '' : String(scoreByPhase[current.phase]),
              observations: obsByPhase[current.phase],
              saving: false,
            },
          };
        }
        // Primera carga: inicializa el formulario
        const initialPhase = (data.evaluationSummary?.latestPhase === 'EJECUCION' ? 'EJECUCION' : 'ALISTAMIENTO') as
          | 'ALISTAMIENTO'
          | 'EJECUCION';
        return {
          ...previous,
          [courseId]: {
            phase: initialPhase,
            score: scoreByPhase[initialPhase] === '' ? '' : String(scoreByPhase[initialPhase]),
            observations: obsByPhase[initialPhase],
            saving: false,
            status: '',
          },
        };
      });
    } catch (error) {
      setMessage(`No fue posible cargar detalle NRC: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingDetailId((previous) => (previous === courseId ? null : previous));
    }
  }

  async function deactivateCourse(course: CourseItem) {
    const confirmed = window.confirm(
      `Se va a excluir el NRC ${course.nrc} de reportes y correos del docente. Esta accion requiere regenerar/reenviar reporte para verse reflejada. ¿Deseas continuar?`,
    );
    if (!confirmed) return;

    setDeletingById((previous) => ({
      ...previous,
      [course.id]: true,
    }));
    updateOverrideState(course.id, (current) => ({
      ...current,
      status: '',
    }));

    try {
      const response = await fetch(`${apiBase}/courses/${course.id}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        message?: string | string[];
        reassignment?: {
          groupsReassigned?: number;
          groupsWithoutReplacement?: number;
          replacementCourses?: Array<{ nrc: string }>;
        };
      };
      if (!response.ok) {
        const text = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? `HTTP ${response.status}`);
        throw new Error(text);
      }

      await loadCourseDetail(course.id);

      const replacementNrcs = (data.reassignment?.replacementCourses ?? [])
        .map((item) => item.nrc)
        .filter(Boolean);
      const replacementText = replacementNrcs.length
        ? ` NRC revisado reasignado a: ${replacementNrcs.join(', ')}.`
        : '';
      const groupsWithoutReplacement = data.reassignment?.groupsWithoutReplacement ?? 0;
      const warningText =
        groupsWithoutReplacement > 0
          ? ` ${groupsWithoutReplacement} grupo(s) quedaron sin NRC revisado y no apareceran en reporte hasta seleccionar uno nuevo.`
          : '';

      updateOverrideState(course.id, (current) => ({
        ...current,
        status: `NRC ${course.nrc} excluido manualmente de reportes.${replacementText}${warningText}`,
      }));
    } catch (error) {
      updateOverrideState(course.id, (current) => ({
        ...current,
        status: `No fue posible eliminar NRC: ${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setDeletingById((previous) => ({
        ...previous,
        [course.id]: false,
      }));
    }
  }

  async function setChecklistTemporal(course: CourseItem, active: boolean) {
    const actionLabel = active ? 'agregar' : 'quitar';
    const confirmed = window.confirm(
      `Se va a ${actionLabel} el NRC ${course.nrc} en la categoria temporal de checklist. ¿Deseas continuar?`,
    );
    if (!confirmed) return;

    setTaggingTemporalById((previous) => ({
      ...previous,
      [course.id]: true,
    }));
    updateOverrideState(course.id, (current) => ({
      ...current,
      status: '',
    }));

    try {
      const response = await fetch(`${apiBase}/courses/${course.id}/checklist-temporal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        message?: string | string[];
      };
      if (!response.ok) {
        const text = Array.isArray(data?.message)
          ? data.message.join('; ')
          : (data?.message ?? `HTTP ${response.status}`);
        throw new Error(text);
      }

      await loadCourseDetail(course.id);
      updateOverrideState(course.id, (current) => ({
        ...current,
        status: active
          ? `NRC ${course.nrc} agregado a categoria temporal de checklist.`
          : `NRC ${course.nrc} retirado de categoria temporal de checklist.`,
      }));
    } catch (error) {
      updateOverrideState(course.id, (current) => ({
        ...current,
        status: `No fue posible actualizar categoria temporal: ${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setTaggingTemporalById((previous) => ({
        ...previous,
        [course.id]: false,
      }));
    }
  }

  async function saveMoment(course: CourseItem) {
    const newMoment = (momentEditById[course.id] ?? '').trim();
    if (!newMoment) return;

    setSavingMomentById((prev) => ({ ...prev, [course.id]: true }));
    try {
      const response = await fetch(`${apiBase}/courses/${course.id}/moment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moment: newMoment }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string | string[] };
      if (!response.ok) {
        const text = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? `HTTP ${response.status}`);
        throw new Error(text);
      }
      // Actualizar la lista en memoria con el nuevo momento
      setItems((prev) =>
        prev.map((item) => (item.id === course.id ? { ...item, moment: newMoment } : item)),
      );
      setMomentEditById((prev) => ({ ...prev, [course.id]: '' }));
      updateOverrideState(course.id, (s) => ({ ...s, status: `Momento actualizado a ${newMoment}.` }));
    } catch (error) {
      updateOverrideState(course.id, (s) => ({
        ...s,
        status: `No fue posible actualizar el momento: ${error instanceof Error ? error.message : String(error)}`,
      }));
    } finally {
      setSavingMomentById((prev) => ({ ...prev, [course.id]: false }));
    }
  }

  async function toggleExpanded(item: CourseItem) {
    if (expandedIds.has(item.id)) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      return;
    }
    setExpandedIds((prev) => new Set(prev).add(item.id));
    if (!detailById[item.id]) {
      await loadCourseDetail(item.id);
    }
  }

  function updateOverrideState(courseId: string, updater: (state: OverrideFormState) => OverrideFormState) {
    setOverrideById((previous) => {
      const current =
        previous[courseId] ??
        ({
          phase: 'ALISTAMIENTO',
          score: '',
          observations: '',
          saving: false,
          status: '',
        } as OverrideFormState);
      return {
        ...previous,
        [courseId]: updater(current),
      };
    });
  }

  function onOverridePhaseChange(courseId: string, phase: 'ALISTAMIENTO' | 'EJECUCION') {
    const detail = detailById[courseId];
    const existing = detail?.evaluations.find((evaluation) => evaluation.phase === phase);
    updateOverrideState(courseId, (current) => ({
      ...current,
      phase,
      score: existing?.score != null ? String(existing.score) : '',
      observations: existing?.observations ?? '',
      status: '',
    }));
  }

  function formatMomentLabel(value: string | null | undefined) {
    if (value === 'MD1') return 'M1';
    if (value === 'MD2') return 'M2';
    if (value === '1') return 'RYC';
    return value ?? '-';
  }

  function closePreviewModal() {
    setPreviewOpen(false);
    setPreviewLoading(false);
    setPreviewError('');
    setPreviewData(null);
    setPendingPreviewSend(null);
  }

  async function openPreviewForCourse(course: CourseItem, phase: 'ALISTAMIENTO' | 'EJECUCION') {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewData(null);
    setPendingPreviewSend({
      courseId: course.id,
      phase,
      nrc: course.nrc,
    });

    try {
      const preview = await fetchJson<OutboxPreviewResponse>(`${apiBase}/outbox/preview-by-course`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id,
          phase,
        }),
      });
      setPreviewData(preview);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmPreviewSend() {
    if (!pendingPreviewSend) return;

    try {
      setPreviewSending(true);
      setPreviewError('');
      const resendData = await fetchJson<{
        ok?: boolean;
        sendResult?: {
          sentCount?: number;
          failedCount?: number;
          failed?: Array<{ error?: string }>;
        };
      }>(`${apiBase}/outbox/resend-by-course`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: pendingPreviewSend.courseId,
          phase: pendingPreviewSend.phase,
        }),
      });

      const sentCount = resendData.sendResult?.sentCount ?? 0;
      const failedCount = resendData.sendResult?.failedCount ?? 0;
      const statusMessage =
        sentCount > 0 && failedCount === 0
          ? 'Reporte reenviado al docente.'
          : sentCount > 0 && failedCount > 0
            ? `Reenvio parcial (${sentCount} enviado(s), ${failedCount} fallido(s)).`
            : failedCount > 0
              ? `El reenvio fallo: ${resendData.sendResult?.failed?.[0]?.error ?? 'Sin detalle.'}`
              : 'Reporte regenerado.';

      updateOverrideState(pendingPreviewSend.courseId, (current) => ({
        ...current,
        status: `${current.status ? `${current.status} ` : ''}${statusMessage}`.trim(),
      }));

      closePreviewModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPreviewError(message);
      updateOverrideState(pendingPreviewSend.courseId, (current) => ({
        ...current,
        status: `${current.status ? `${current.status} ` : ''}No fue posible reenviar: ${message}`.trim(),
      }));
    } finally {
      setPreviewSending(false);
    }
  }

  async function saveManualOverride(
    course: CourseItem,
    options: { replicateToGroup: boolean; resendReport: boolean },
  ) {
    const state = overrideById[course.id];
    if (!state) return;
    const { replicateToGroup, resendReport } = options;

    const parsedScore = Number(state.score);
    if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 50) {
      updateOverrideState(course.id, (current) => ({
        ...current,
        status: 'La calificacion debe estar entre 0 y 50.',
      }));
      return;
    }

    updateOverrideState(course.id, (current) => ({
      ...current,
      saving: true,
      status: '',
    }));

    try {
      const response = await fetch(`${apiBase}/evaluation/manual-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id,
          phase: state.phase,
          score: parsedScore,
          observations: state.observations,
          replicateToGroup,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        message?: string | string[];
        replication?: { replicatedCourses: number };
      };
      if (!response.ok) {
        const text = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? `HTTP ${response.status}`);
        throw new Error(text);
      }

      await loadCourseDetail(course.id);

      if (replicateToGroup) {
        const originGroupIds = course.selectedSampleGroups?.map((g) => g.id) ?? [];
        if (originGroupIds.length > 0) {
          const groupMates = items.filter(
            (item) =>
              item.id !== course.id &&
              item.selectedSampleGroups?.some((g) => originGroupIds.includes(g.id)),
          );
          await Promise.all(groupMates.map((mate) => loadCourseDetail(mate.id)));
        }
      }

      const replicated = data.replication?.replicatedCourses ?? 0;
      let statusMessage = replicateToGroup
        ? `Ajuste guardado y replicado a ${replicated} NRC.`
        : 'Ajuste guardado para este NRC.';

      if (resendReport) {
        try {
          await openPreviewForCourse(course, state.phase);
          statusMessage += ' Preview listo. Revisa el correo y confirma el envio.';
        } catch (previewError) {
          statusMessage += ` Ajuste guardado, pero no fue posible generar preview: ${previewError instanceof Error ? previewError.message : String(previewError)}`;
        }
      }

      updateOverrideState(course.id, (current) => ({
        ...current,
        saving: false,
        status: statusMessage,
      }));
    } catch (error) {
      updateOverrideState(course.id, (current) => ({
        ...current,
        saving: false,
        status: `No fue posible guardar el ajuste: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  }

  function exportCsv() {
    const header = [
      'periodo',
      'semestre',
      'nrc',
      'momento',
      'campus',
      'programa_codigo',
      'programa_nombre',
      'asignatura',
      'teacher_id',
      'teacher_name',
      'banner_status',
      'moodle_status',
      'template',
      'participantes_sidecar',
      'participantes_detectados',
      'inscritos_genesis',
      'score_alistamiento',
      'score_ejecucion',
      'checklist_selected',
      'review_excluded',
      'review_excluded_reason',
    ];
    const lines = [header.join(',')];
    for (const item of filteredItems) {
      lines.push(
        [
          item.period.code,
          item.period.semester ?? '',
          item.nrc,
          item.moment ?? '',
          item.campusCode ?? '',
          item.programCode ?? '',
          item.programName ?? '',
          item.subjectName ?? '',
          item.teacherId ?? '',
          item.teacher?.fullName ?? '',
          item.bannerReviewStatus ?? '',
          item.moodleCheck?.status ?? '',
          item.moodleCheck?.detectedTemplate ?? '',
          item.moodleSidecarMetrics?.participants ?? '',
          item.moodleSidecarMetrics?.participantsDetected == null
            ? ''
            : item.moodleSidecarMetrics.participantsDetected
              ? 'SI'
              : 'NO',
          item.enrolledCount ?? '',
          item.evaluationSummary?.alistamientoScore ?? '',
          item.evaluationSummary?.ejecucionScore ?? '',
          item.selectedForChecklist ? 'SI' : 'NO',
          item.reviewExcluded ? 'SI' : 'NO',
          item.reviewExcludedReason ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    downloadFile('nrc_globales_filtrados.csv', lines.join('\n'), 'text/csv;charset=utf-8');
  }

  function exportTxt() {
    const lines = filteredItems.map((item) => item.nrc);
    downloadFile('nrc_globales_filtrados.txt', lines.join('\n'), 'text/plain;charset=utf-8');
  }

  return (
    <article className="panel">
      <h2>Listado global de NRC</h2>
      <div className="actions">
        Consulta centralizada de NRC para buscar, filtrar, exportar y preparar lotes para Banner.
      </div>

      <div className="saved-nrc-block">
        <div className="saved-nrc-kpis">
          <span className="badge">Total NRC: {items.length}</span>
          <span className="badge">Con docente: {totalWithTeacher}</span>
          <span className="badge">Sin docente: {totalWithoutTeacher}</span>
          <span className="badge">Banner SIN_DOCENTE: {totalBannerSinDocente}</span>
          <span className="badge">Banner NO_ENCONTRADO: {totalBannerNoEncontrado}</span>
          <span className="badge">Seleccionados checklist: {totalSelectedChecklist}</span>
          <span className="badge">Excluidos: {totalReviewExcluded}</span>
          <span className="badge">Opcion de Grado / Practica: {totalGradoPractica}</span>
          <span className="badge">Cursos con participantes visibles: {filteredParticipantsCourses}</span>
          <span className="badge">Total estudiantes visibles: {filteredParticipants}</span>
          <span className="badge">Resultado filtro: {filteredItems.length}</span>
          {selectedIds.size > 0 && (
            <span className="badge" style={{ background: '#2563eb', color: '#fff' }}>Seleccionados: {selectedIds.size}</span>
          )}
        </div>
      </div>

      <div className="controls" style={{ marginTop: 10 }}>
        <label style={{ minWidth: 280 }}>
          Buscar por similitud
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="NRC, docente, programa, asignatura, periodo..."
          />
        </label>
        <label>
          ID docente
          <input
            value={teacherIdQuery}
            onChange={(event) => setTeacherIdQuery(event.target.value)}
            placeholder="ID, sourceId o cedula"
          />
        </label>
        <label style={{ minWidth: 240 }}>
          Nombre docente
          <input
            value={teacherNameQuery}
            onChange={(event) => setTeacherNameQuery(event.target.value)}
            placeholder="Nombre y apellidos"
          />
        </label>
        <label>
          Periodo
          <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
            {periods.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
        </label>
        <label>
          Semestre
          <select value={semesterFilter} onChange={(event) => setSemesterFilter(event.target.value)}>
            {semesters.map((semester) => (
              <option key={semester} value={semester}>
                {semester}
              </option>
            ))}
          </select>
        </label>
        <label>
          Momento
          <select value={momentFilter} onChange={(event) => setMomentFilter(event.target.value)}>
            {moments.map((moment) => (
              <option key={moment} value={moment}>
                {moment}
              </option>
            ))}
          </select>
        </label>
        <label>
          Programa
          <select value={programFilter} onChange={(event) => setProgramFilter(event.target.value)}>
            {programs.map((program) => (
              <option key={program} value={program}>
                {program}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sede
          <select value={campusFilter} onChange={(event) => setCampusFilter(event.target.value)}>
            {campuses.map((campus) => (
              <option key={campus} value={campus}>
                {campus}
              </option>
            ))}
          </select>
        </label>
        <label>
          Docente
          <select value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)}>
            <option value="TODOS">Todos</option>
            <option value="CON_DOCENTE">Con docente</option>
            <option value="SIN_DOCENTE">Sin docente</option>
          </select>
        </label>
        <label>
          Banner
          <select value={bannerFilter} onChange={(event) => setBannerFilter(event.target.value)}>
            <option value="TODOS">Todos</option>
            <option value="SIN_DATO">Sin dato</option>
            <option value="SIN_DOCENTE">SIN_DOCENTE</option>
            <option value="NO_ENCONTRADO">NO_ENCONTRADO</option>
            <option value="ENCONTRADO">ENCONTRADO</option>
          </select>
        </label>
        <label>
          Revisables
          <select value={reviewableFilter} onChange={(event) => setReviewableFilter(event.target.value)}>
            <option value="TODOS">Todos</option>
            <option value="SOLO_REVISABLES">Solo revisables</option>
            <option value="SOLO_EXCLUIDOS">Solo excluidos</option>
          </select>
        </label>
        <label>
          Plantilla
          <select value={templateFilter} onChange={(event) => setTemplateFilter(event.target.value)}>
            {templates.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Participantes Moodle
          <select value={participantsFilter} onChange={(event) => setParticipantsFilter(event.target.value)}>
            <option value="TODOS">Todos</option>
            <option value="SIN_PARTICIPANTES">Sin participantes</option>
            <option value="CON_PARTICIPANTES">Con participantes</option>
          </select>
        </label>
        <label>
          Inscritos Genesis
          <select value={enrolledFilter} onChange={(event) => setEnrolledFilter(event.target.value)}>
            <option value="TODOS">Todos</option>
            <option value="SIN_INSCRITOS">Sin inscritos (0)</option>
            <option value="CON_INSCRITOS">Con inscritos</option>
          </select>
        </label>
        <button type="button" onClick={exportCsv} disabled={!filteredItems.length}>
          Descargar CSV
        </button>
        <button type="button" onClick={exportTxt} disabled={!filteredItems.length}>
          Descargar NRC
        </button>
        <button
          type="button"
          style={{ background: '#b91c1c', color: '#fff', fontWeight: 600 }}
          disabled={!filteredItems.length || batchDeactivating}
          onClick={async () => {
            const pool = selectedIds.size > 0
              ? filteredItems.filter((item) => selectedIds.has(item.id))
              : filteredItems;
            const revisable = pool.filter((item) => !item.reviewExcluded);
            if (!revisable.length) {
              setMessage('No hay cursos revisables en la seleccion actual para desactivar.');
              return;
            }
            const label = selectedIds.size > 0 ? 'seleccionados' : 'del filtro actual';
            const reason = window.prompt(
              `Se van a desactivar ${revisable.length} cursos revisables ${label}.\n\nEscribe la razon de desactivacion:`,
              'Curso vacio: sin contenido, sin participantes ni inscritos en Genesis.',
            );
            if (!reason) return;
            try {
              setBatchDeactivating(true);
              setMessage(`Desactivando ${revisable.length} cursos...`);
              const response = await fetch(`${apiBase}/courses/deactivate-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  courseIds: revisable.map((item) => item.id),
                  reason,
                  confirm: true,
                }),
              });
              const data = (await response.json()) as {
                ok?: boolean;
                deactivated?: number;
                failed?: number;
                message?: string | string[];
              };
              if (!response.ok) {
                const text = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? `HTTP ${response.status}`);
                throw new Error(text);
              }
              setMessage(`Desactivados: ${data.deactivated ?? 0}. Fallidos: ${data.failed ?? 0}.`);
              setSelectedIds(new Set());
              const refreshed = await fetchJson<CoursesListResponse>(`${apiBase}/courses?limit=5000`);
              setItems(refreshed.items ?? []);
            } catch (error) {
              setMessage(`Error al desactivar lote: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
              setBatchDeactivating(false);
            }
          }}
        >
          {batchDeactivating
            ? 'Desactivando...'
            : selectedIds.size > 0
              ? `Desactivar seleccionados (${filteredItems.filter((i) => selectedIds.has(i.id) && !i.reviewExcluded).length})`
              : `Desactivar filtrados (${filteredItems.filter((i) => !i.reviewExcluded).length})`}
        </button>
        {selectedIds.size > 0 && (
          <button
            type="button"
            style={{ background: '#6b7280', color: '#fff' }}
            onClick={() => setSelectedIds(new Set())}
          >
            Deseleccionar todo
          </button>
        )}
        {selectedIds.size > 0 && (
          <button
            type="button"
            style={{ background: '#1e40af', color: '#fff', fontWeight: 600 }}
            disabled={bannerVerifying || batchDeactivating}
            onClick={async () => {
              const selected = filteredItems.filter((item) => selectedIds.has(item.id));
              if (!selected.length) {
                setMessage('No hay cursos seleccionados para re-verificar.');
                return;
              }
              if (!window.confirm(
                `Se van a enviar ${selected.length} NRC a la automatizacion Banner para re-verificarlos.\n\n` +
                'Asegurate de tener una sesion de Banner activa en Automatizacion > Banner.\n\n' +
                '¿Continuar?'
              )) return;
              try {
                setBannerVerifying(true);
                setMessage(`Enviando ${selected.length} NRC a Banner para re-verificacion...`);
                const response = await fetch('/api/banner/followup/start', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    courseIds: selected.map((item) => item.id),
                    queryName: 'reverificar-nrc-globales',
                    workers: 1,
                  }),
                });
                const data = (await response.json()) as {
                  ok?: boolean;
                  message?: string | string[];
                  result?: { batch?: { total?: number } };
                };
                if (!response.ok) {
                  const text = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? `HTTP ${response.status}`);
                  throw new Error(text);
                }
                const total = data.result?.batch?.total ?? selected.length;
                setMessage(
                  `Lote Banner iniciado con ${total} NRC. ` +
                  'Ve a Automatizacion > Banner para monitorear el progreso. ' +
                  'Al terminar, importa los resultados y recarga esta pagina.'
                );
              } catch (error) {
                setMessage(`Error al enviar a Banner: ${error instanceof Error ? error.message : String(error)}`);
              } finally {
                setBannerVerifying(false);
              }
            }}
          >
            {bannerVerifying ? 'Enviando a Banner...' : `Re-verificar en Banner (${selectedIds.size})`}
          </button>
        )}
        {selectedIds.size === 1 && (() => {
          const item = filteredItems.find((i) => selectedIds.has(i.id));
          if (!item) return null;
          return (
            <button
              type="button"
              style={{ background: '#0e7490', color: '#fff', fontWeight: 600 }}
              disabled={bannerVerifying || batchDeactivating}
              onClick={async () => {
                try {
                  setBannerVerifying(true);
                  setMessage(`Buscando NRC ${item.nrc} (periodo ${item.period.code}) directamente en Banner...`);
                  const response = await fetch('/api/banner/actions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'start',
                      payload: {
                        command: 'lookup',
                        nrc: item.nrc,
                        period: item.period.code,
                        queryName: 'lookup-nrc-globales',
                      },
                    }),
                  });
                  const data = (await response.json()) as {
                    ok?: boolean;
                    message?: string | string[];
                  };
                  if (!response.ok) {
                    const text = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? `HTTP ${response.status}`);
                    throw new Error(text);
                  }
                  setMessage(
                    `Busqueda del NRC ${item.nrc} iniciada en Banner. ` +
                    'Ve a Automatizacion > Banner para ver el resultado.'
                  );
                } catch (error) {
                  setMessage(`Error al buscar en Banner: ${error instanceof Error ? error.message : String(error)}`);
                } finally {
                  setBannerVerifying(false);
                }
              }}
            >
              {bannerVerifying ? 'Buscando...' : `Buscar NRC ${item.nrc} en Banner`}
            </button>
          );
        })()}
      </div>

      {loading ? <div className="message">Cargando listado global...</div> : null}
      {message ? <div className="message">{message}</div> : null}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id))}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setSelectedIds(new Set(filteredItems.map((item) => item.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  title="Seleccionar / deseleccionar todos"
                />
              </th>
              <th>Periodo</th>
              <th>NRC</th>
              <th>Momento</th>
              <th>Programa</th>
              <th>Asignatura</th>
              <th>Docente</th>
              <th>Banner</th>
              <th>Moodle</th>
              <th>Plantilla</th>
              <th>Particip.</th>
              <th>Inscritos</th>
              <th>Calificacion</th>
              <th>Checklist</th>
              <th>Revision</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => {
              const isExpanded = expandedIds.has(item.id);
              const detail = detailById[item.id];
              const override = overrideById[item.id];
              return (
                <Fragment key={item.id}>
                  <tr style={selectedIds.has(item.id) ? { background: 'rgba(37, 99, 235, 0.08)' } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={(event) => {
                          const next = new Set(selectedIds);
                          if (event.target.checked) {
                            next.add(item.id);
                          } else {
                            next.delete(item.id);
                          }
                          setSelectedIds(next);
                        }}
                      />
                    </td>
                    <td>{item.period.code}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void toggleExpanded(item)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#0a5972',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          padding: 0,
                          fontWeight: 700,
                        }}
                        title="Ver detalle NRC"
                      >
                        {item.nrc}
                      </button>
                    </td>
                    <td>
                      {item.moment
                        ? /^RY/.test(item.moment)
                          ? <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>{item.moment}</span>
                          : item.moment
                        : '-'}
                    </td>
                    <td>{item.programName ?? item.programCode ?? '-'}</td>
                    <td>{item.subjectName ?? '-'}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{item.teacher?.fullName ?? 'Sin docente'}</div>
                      {(item.teacher?.sourceId || item.teacher?.documentId) && (
                        <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
                          {item.teacher.sourceId ?? item.teacher.documentId}
                        </div>
                      )}
                    </td>
                    <td>{item.bannerReviewStatus ?? '-'}</td>
                    <td>{item.moodleCheck?.status ?? 'SIN_CHECK'}</td>
                    <td>{item.moodleCheck?.detectedTemplate ?? '-'}</td>
                    <td>{item.moodleSidecarMetrics?.participants ?? '-'}</td>
                    <td>{item.enrolledCount ?? '-'}</td>
                    <td>{formatPhaseScore(item)}</td>
                    <td>
                      {item.selectedForChecklist ? (
                        <span className="badge">Seleccionado</span>
                      ) : item.checklistTemporal?.active ? (
                        <span className="badge">Temporal</span>
                      ) : item.evaluationSummary?.latestReplicatedFromCourseId ? (
                        <span className="badge">Replica</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {item.reviewExcluded
                        ? item.reviewExcludedReason === 'OPCION_GRADO_PRACTICA'
                          ? 'Excluido: Opcion de Grado / Practica'
                          : item.reviewExcludedReason === 'EXCLUIDO_MANUAL'
                            ? 'Excluido manualmente'
                          : item.reviewExcludedReason === 'NO_MATRICULADO'
                            ? 'Excluido: No matriculado'
                            : item.reviewExcludedReason === 'VACIO_SIN_ESTUDIANTES'
                              ? 'Excluido: Vacio sin estudiantes'
                              : item.reviewExcludedReason === 'MOODLE_SIN_ACCESO'
                                ? 'Excluido: Moodle sin acceso'
                                : `Excluido por Banner (${item.bannerReviewStatus ?? 'SIN_DATO'})`
                        : 'Revisable'}
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr>
                      <td colSpan={15}>
                        <div
                          style={{
                            background: 'rgba(255,255,255,0.9)',
                            border: '1px solid #d6dde6',
                            borderRadius: 10,
                            padding: 12,
                          }}
                        >
                          {loadingDetailId === item.id && !detail ? (
                            <div className="muted">Cargando detalle...</div>
                          ) : null}
                          {detail ? (
                            <>
                              <div className="saved-nrc-kpis" style={{ marginBottom: 10 }}>
                                <span className="badge">NRC: {detail.nrc}</span>
                                <span className="badge">Periodo: {detail.period.code}</span>
                                <span className="badge">Momento: {detail.moment ?? '-'}</span>
                                <span className="badge">
                                  Checklist: {detail.selectedForChecklist ? 'Seleccionado' : 'No seleccionado'}
                                </span>
                                <span className="badge">
                                  Ult. calificacion: {formatScore(detail.evaluationSummary?.latestScore)}
                                </span>
                                <span className="badge">
                                  Participantes sidecar: {detail.moodleSidecarMetrics?.participants ?? '-'}
                                </span>
                                {detail.bannerStartDate ? (
                                  <span className="badge">
                                    Inicio Banner: {detail.bannerStartDate}
                                  </span>
                                ) : null}
                                {detail.bannerEndDate ? (
                                  <span className="badge">
                                    Fin Banner: {detail.bannerEndDate}
                                  </span>
                                ) : null}
                              </div>

                              {detail.selectedSampleGroups?.length ? (
                                <div className="muted" style={{ marginBottom: 8 }}>
                                  NRC seleccionado en grupos de checklist:{' '}
                                  {detail.selectedSampleGroups
                                    .map((group) => `${group.moment} / ${group.template} / ${group.programCode}`)
                                    .join(' | ')}
                                </div>
                              ) : null}

                              <div className="controls" style={{ marginTop: 10, marginBottom: 10 }}>
                                <div className="actions" style={{ flex: '1 1 420px' }}>
                                  <strong>URL Moodle:</strong>{' '}
                                  {detail.moodleCheck?.moodleCourseUrl ? (
                                    <>
                                      <a
                                        href={detail.moodleCheck.moodleCourseUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: '#0a5972', textDecoration: 'underline', wordBreak: 'break-all' }}
                                      >
                                        {detail.moodleCheck.moodleCourseUrl}
                                      </a>
                                      <br />
                                      <span className="code">
                                        Course ID: {detail.moodleCheck.moodleCourseId ?? '-'} | Modalidad:{' '}
                                        {detail.moodleCheck.resolvedModality ?? '-'}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="code">Sin URL Moodle resuelta todavia para este NRC.</span>
                                  )}
                                </div>
                              </div>

                              <div className="controls" style={{ marginBottom: 10 }}>
                                <label>
                                  Momento actual
                                  <input
                                    readOnly
                                    value={item.moment ?? '-'}
                                    style={{ width: 100, background: 'var(--n-50)', color: 'var(--n-500)' }}
                                  />
                                </label>
                                <label>
                                  Nuevo momento
                                  <input
                                    value={momentEditById[item.id] ?? ''}
                                    onChange={(e) =>
                                      setMomentEditById((prev) => ({ ...prev, [item.id]: e.target.value.toUpperCase() }))
                                    }
                                    placeholder="Ej: MD2, MD1, RYC1"
                                    style={{ width: 120 }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  disabled={
                                    savingMomentById[item.id] ||
                                    !(momentEditById[item.id] ?? '').trim()
                                  }
                                  onClick={() => void saveMoment(item)}
                                  style={{ background: 'var(--primary)', color: '#fff' }}
                                >
                                  {savingMomentById[item.id] ? 'Guardando...' : 'Cambiar momento'}
                                </button>
                              </div>

                              <div style={{ overflowX: 'auto' }}>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Fase</th>
                                      <th>Calificacion</th>
                                      <th>Tipo evaluacion</th>
                                      <th>Replica desde NRC</th>
                                      <th>Fecha</th>
                                      <th>Observaciones</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {detail.evaluations.map((evaluation) => (
                                      <tr key={evaluation.id}>
                                        <td>{evaluation.phase}</td>
                                        <td>{formatScore(evaluation.score)}</td>
                                        <td>{evaluation.evaluationType ?? (evaluation.replicatedFromCourseId ? 'REPLICADA' : 'MANUAL')}</td>
                                        <td>{evaluation.replicatedFromNrc ?? '-'}</td>
                                        <td>{formatDate(evaluation.computedAt)}</td>
                                        <td>{evaluation.observations?.trim() || '-'}</td>
                                      </tr>
                                    ))}
                                    {!detail.evaluations.length ? (
                                      <tr>
                                        <td colSpan={6}>Sin evaluaciones registradas.</td>
                                      </tr>
                                    ) : null}
                                  </tbody>
                                </table>
                              </div>

                              <div className="controls" style={{ marginTop: 10, alignItems: 'stretch' }}>
                                <label>
                                  Fase
                                  <select
                                    value={override?.phase ?? 'ALISTAMIENTO'}
                                    onChange={(event) =>
                                      onOverridePhaseChange(item.id, event.target.value as 'ALISTAMIENTO' | 'EJECUCION')
                                    }
                                  >
                                    <option value="ALISTAMIENTO">ALISTAMIENTO</option>
                                    <option value="EJECUCION">EJECUCION</option>
                                  </select>
                                </label>
                                <label>
                                  Calificacion (0-50)
                                  <input
                                    type="number"
                                    min={0}
                                    max={50}
                                    step={0.1}
                                    value={override?.score ?? ''}
                                    onChange={(event) =>
                                      updateOverrideState(item.id, (current) => ({
                                        ...current,
                                        score: event.target.value,
                                        status: '',
                                      }))
                                    }
                                  />
                                </label>
                                <label style={{ minWidth: 340 }}>
                                  Observaciones / felicitaciones
                                  <input
                                    value={override?.observations ?? ''}
                                    onChange={(event) =>
                                      updateOverrideState(item.id, (current) => ({
                                        ...current,
                                        observations: event.target.value,
                                        status: '',
                                      }))
                                    }
                                    placeholder="Texto que vera el docente en el reporte"
                                  />
                                </label>
                                <button
                                  type="button"
                                  disabled={override?.saving || deletingById[item.id] || taggingTemporalById[item.id]}
                                  onClick={() =>
                                    void saveManualOverride(item, { replicateToGroup: false, resendReport: false })
                                  }
                                  style={{ background: '#1e40af', color: '#fff' }}
                                >
                                  {override?.saving ? 'Guardando...' : 'Guardar solo NRC'}
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    override?.saving ||
                                    deletingById[item.id] ||
                                    taggingTemporalById[item.id] ||
                                    !detail.selectedForChecklist
                                  }
                                  onClick={() =>
                                    void saveManualOverride(item, { replicateToGroup: true, resendReport: false })
                                  }
                                  title={
                                    detail.selectedForChecklist
                                      ? 'Aplica ajuste al NRC origen y sus replicas'
                                      : 'Solo disponible para NRC seleccionado en checklist'
                                  }
                                  style={{ background: '#1d4ed8', color: '#fff' }}
                                >
                                  {override?.saving ? 'Guardando...' : 'Guardar NRC + replicas'}
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    override?.saving ||
                                    deletingById[item.id] ||
                                    taggingTemporalById[item.id] ||
                                    !item.teacherId
                                  }
                                  onClick={() =>
                                    void saveManualOverride(item, {
                                      replicateToGroup: Boolean(detail.selectedForChecklist),
                                      resendReport: true,
                                    })
                                  }
                                  title={
                                    item.teacherId
                                      ? detail.selectedForChecklist
                                        ? 'Guarda, replica, abre preview y luego confirma el reenvio del reporte'
                                        : 'Guarda, abre preview y luego confirma el reenvio del reporte'
                                      : 'No disponible para NRC sin docente vinculado'
                                  }
                                  style={{ background: '#4f46e5', color: '#fff' }}
                                >
                                  {override?.saving ? 'Guardando...' : 'Guardar + preview + reenviar'}
                                </button>
                                <button
                                  type="button"
                                  disabled={override?.saving || deletingById[item.id] || taggingTemporalById[item.id]}
                                  onClick={() => void deactivateCourse(item)}
                                  style={{
                                    background: '#9f1239',
                                    color: '#fff',
                                  }}
                                  title="Excluye este NRC de reportes y correos; requiere confirmacion"
                                >
                                  {deletingById[item.id] ? 'Eliminando...' : 'Eliminar NRC'}
                                </button>
                                <button
                                  type="button"
                                  disabled={override?.saving || deletingById[item.id] || taggingTemporalById[item.id]}
                                  onClick={() =>
                                    void setChecklistTemporal(item, !(detail.checklistTemporal?.active ?? false))
                                  }
                                  style={{
                                    background: '#155e75',
                                    color: '#fff',
                                  }}
                                  title="Agrega o retira este NRC de la categoria temporal de checklist"
                                >
                                  {taggingTemporalById[item.id]
                                    ? 'Actualizando...'
                                    : detail.checklistTemporal?.active
                                      ? 'Quitar de temporal'
                                      : 'Enviar a temporal checklist'}
                                </button>
                              </div>
                              {override?.status ? <div className="message">{override.status}</div> : null}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!filteredItems.length && !loading ? (
              <tr>
                <td colSpan={12}>No hay NRC para ese filtro.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {previewOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !previewSending) closePreviewModal(); }}
        >
          <div
            className="panel"
            style={{
              width: 'min(1180px, 96vw)',
              maxHeight: '92vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              margin: 0,
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '4px 0' }}>
              <div>
                <strong>Preview antes de reenviar</strong>
                {previewData ? ` — ${previewData.subject}` : ''}
              </div>
              <button
                type="button"
                onClick={closePreviewModal}
                disabled={previewSending}
                style={{
                  background: 'transparent',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  padding: '4px 10px',
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: 'pointer',
                  color: '#374151',
                }}
                title="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="actions" style={{ marginBottom: 8 }}>
              El correo no se envia hasta que confirmes con <strong>Enviar correo real</strong>.
            </div>

            {previewLoading ? <div className="message">Generando preview...</div> : null}
            {previewError ? <div className="message">No fue posible cargar el preview: {previewError}</div> : null}

            {previewData ? (
              <>
                <div className="outbox-mail-kv-grid" style={{ marginBottom: 10 }}>
                  <div><strong>Docente:</strong> {previewData.recipientName ?? previewData.teacherName ?? 'Sin nombre'}</div>
                  <div><strong>Correo:</strong> {previewData.recipientEmail ?? 'sin-correo@invalid.local'}</div>
                  <div><strong>NRC origen:</strong> {previewData.nrc ?? pendingPreviewSend?.nrc ?? '-'}</div>
                  <div><strong>Periodo:</strong> {previewData.periodCode}</div>
                  <div><strong>Fase:</strong> {previewData.phase}</div>
                  <div><strong>Momento:</strong> {formatMomentLabel(previewData.moment)} ({previewData.moment})</div>
                </div>
                <iframe
                  title={`preview-course-${previewData.id}`}
                  srcDoc={previewData.htmlBody}
                  style={{
                    width: '100%',
                    minHeight: '68vh',
                    border: '1px solid #d4d7dd',
                    borderRadius: 12,
                    background: '#fff',
                  }}
                  sandbox="allow-popups allow-same-origin"
                />
                <div className="controls" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={closePreviewModal} disabled={previewSending}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn-next-action"
                    onClick={() => void confirmPreviewSend()}
                    disabled={previewSending || previewLoading}
                  >
                    {previewSending ? 'Enviando...' : 'Enviar correo real'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
