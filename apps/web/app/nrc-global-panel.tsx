'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';

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
  period: { code: string };
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
  moodleCheck: { status: string; detectedTemplate: string | null } | null;
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
  const [momentFilter, setMomentFilter] = useState('TODOS');
  const [teacherFilter, setTeacherFilter] = useState('TODOS');
  const [bannerFilter, setBannerFilter] = useState('TODOS');
  const [reviewableFilter, setReviewableFilter] = useState('TODOS');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, CourseDetailResponse>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [overrideById, setOverrideById] = useState<Record<string, OverrideFormState>>({});
  const [deletingById, setDeletingById] = useState<Record<string, boolean>>({});
  const [taggingTemporalById, setTaggingTemporalById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setMessage('');
        const response = await fetch(`${apiBase}/courses?limit=5000`, {
          cache: 'no-store',
        });
        const data = (await response.json()) as CoursesListResponse & { message?: string | string[] };
        if (!response.ok) {
          const text = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? `HTTP ${response.status}`);
          throw new Error(text);
        }
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

  const moments = useMemo(
    () => ['TODOS', ...Array.from(new Set(items.map((item) => item.moment ?? '-'))).sort((a, b) => a.localeCompare(b, 'es'))],
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
        if (momentFilter !== 'TODOS' && (item.moment ?? '-') !== momentFilter) return false;
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
        return true;
      })
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const periodCompare = left.item.period.code.localeCompare(right.item.period.code, 'es');
        if (periodCompare !== 0) return periodCompare;
        return left.item.nrc.localeCompare(right.item.nrc, 'es');
      })
      .map(({ item }) => item);
  }, [bannerFilter, items, momentFilter, periodFilter, query, reviewableFilter, teacherFilter, teacherIdQuery, teacherNameQuery]);

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
        if (previous[courseId]) return previous;
        const initialPhase = (data.evaluationSummary?.latestPhase === 'EJECUCION' ? 'EJECUCION' : 'ALISTAMIENTO') as
          | 'ALISTAMIENTO'
          | 'EJECUCION';
        const scoreByPhase = {
          ALISTAMIENTO: data.evaluations.find((evaluation) => evaluation.phase === 'ALISTAMIENTO')?.score ?? '',
          EJECUCION: data.evaluations.find((evaluation) => evaluation.phase === 'EJECUCION')?.score ?? '',
        };
        const obsByPhase = {
          ALISTAMIENTO:
            data.evaluations.find((evaluation) => evaluation.phase === 'ALISTAMIENTO')?.observations ?? '',
          EJECUCION: data.evaluations.find((evaluation) => evaluation.phase === 'EJECUCION')?.observations ?? '',
        };
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

  async function toggleExpanded(item: CourseItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
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

      const replicated = data.replication?.replicatedCourses ?? 0;
      let statusMessage = replicateToGroup
        ? `Ajuste guardado y replicado a ${replicated} NRC.`
        : 'Ajuste guardado para este NRC.';

      if (resendReport) {
        try {
          const resendResponse = await fetch(`${apiBase}/outbox/resend-by-course`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              courseId: course.id,
              phase: state.phase,
            }),
          });
          const resendData = (await resendResponse.json()) as {
            ok?: boolean;
            message?: string | string[];
            sendResult?: {
              sentCount?: number;
              failedCount?: number;
              failed?: Array<{ error?: string }>;
            };
          };
          if (!resendResponse.ok) {
            const text = Array.isArray(resendData?.message)
              ? resendData.message.join('; ')
              : (resendData?.message ?? `HTTP ${resendResponse.status}`);
            throw new Error(text);
          }

          const sentCount = resendData.sendResult?.sentCount ?? 0;
          const failedCount = resendData.sendResult?.failedCount ?? 0;
          if (sentCount > 0 && failedCount === 0) {
            statusMessage += ' Reporte reenviado al docente.';
          } else if (sentCount > 0 && failedCount > 0) {
            statusMessage += ` Reenvio parcial (${sentCount} enviado(s), ${failedCount} fallido(s)).`;
          } else if (failedCount > 0) {
            const failure = resendData.sendResult?.failed?.[0]?.error ?? 'Sin detalle.';
            statusMessage += ` Ajuste guardado, pero el reenvio fallo: ${failure}`;
          } else {
            statusMessage += ' Reporte regenerado.';
          }
        } catch (resendError) {
          statusMessage += ` Ajuste guardado, pero no fue posible reenviar: ${resendError instanceof Error ? resendError.message : String(resendError)}`;
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
      'nrc',
      'momento',
      'programa_codigo',
      'programa_nombre',
      'asignatura',
      'teacher_id',
      'teacher_name',
      'banner_status',
      'moodle_status',
      'template',
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
          item.nrc,
          item.moment ?? '',
          item.programCode ?? '',
          item.programName ?? '',
          item.subjectName ?? '',
          item.teacherId ?? '',
          item.teacher?.fullName ?? '',
          item.bannerReviewStatus ?? '',
          item.moodleCheck?.status ?? '',
          item.moodleCheck?.detectedTemplate ?? '',
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
          <span className="badge">Resultado filtro: {filteredItems.length}</span>
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
        <button type="button" onClick={exportCsv} disabled={!filteredItems.length}>
          Descargar CSV
        </button>
        <button type="button" onClick={exportTxt} disabled={!filteredItems.length}>
          Descargar NRC
        </button>
      </div>

      {loading ? <div className="message">Cargando listado global...</div> : null}
      {message ? <div className="message">{message}</div> : null}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Periodo</th>
              <th>NRC</th>
              <th>Momento</th>
              <th>Programa</th>
              <th>Asignatura</th>
              <th>Docente</th>
              <th>Banner</th>
              <th>Moodle</th>
              <th>Plantilla</th>
              <th>Calificacion</th>
              <th>Checklist</th>
              <th>Revision</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => {
              const isExpanded = expandedId === item.id;
              const detail = detailById[item.id];
              const override = overrideById[item.id];
              return (
                <Fragment key={item.id}>
                  <tr>
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
                    <td>{item.moment ?? '-'}</td>
                    <td>{item.programName ?? item.programCode ?? '-'}</td>
                    <td>{item.subjectName ?? '-'}</td>
                    <td>{item.teacher?.fullName ?? 'Sin docente'}</td>
                    <td>{item.bannerReviewStatus ?? '-'}</td>
                    <td>{item.moodleCheck?.status ?? 'SIN_CHECK'}</td>
                    <td>{item.moodleCheck?.detectedTemplate ?? '-'}</td>
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
                      <td colSpan={12}>
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
                              </div>

                              {detail.selectedSampleGroups?.length ? (
                                <div className="muted" style={{ marginBottom: 8 }}>
                                  NRC seleccionado en grupos de checklist:{' '}
                                  {detail.selectedSampleGroups
                                    .map((group) => `${group.moment} / ${group.template} / ${group.programCode}`)
                                    .join(' | ')}
                                </div>
                              ) : null}

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
                                        ? 'Guarda, replica y reenvia el reporte del docente'
                                        : 'Guarda y reenvia el reporte del docente'
                                      : 'No disponible para NRC sin docente vinculado'
                                  }
                                >
                                  {override?.saving ? 'Guardando...' : 'Guardar + reenviar reporte'}
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
    </article>
  );
}
