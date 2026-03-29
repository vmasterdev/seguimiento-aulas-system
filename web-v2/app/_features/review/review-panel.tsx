'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  buildCourseScheduleInfo,
  buildExecutionExpectations,
  formatCourseWindowLabel,
  scoreAlistamiento,
  scoreEjecucion,
} from '@seguimiento/shared';

type ChecklistState = Record<string, boolean | number>;

type ReviewItem = {
  sampleGroupId: string;
  teacherName: string;
  periodCode: string;
  programCode: string;
  modality: string;
  moment: string;
  template: string;
  selectedCourse: {
    id: string;
    nrc: string;
    subjectName: string | null;
    bannerStartDate: string | null;
    bannerEndDate: string | null;
    enrolledCount: number | null;
    moodleStatus: string | null;
    detectedTemplate: string | null;
    moodleCourseUrl: string | null;
    moodleCourseId: string | null;
    resolvedModality: string | null;
    resolvedBaseUrl: string | null;
    searchQuery: string | null;
  };
  evaluation: {
    id: string;
    score: number;
    observations: string | null;
    computedAt: string;
    replicatedFromCourseId: string | null;
    checklist: Record<string, unknown>;
  } | null;
  done: boolean;
};

type ReviewQueueResponse = {
  ok: boolean;
  periodCode: string;
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  moment: string | null;
  category?: 'MUESTREO' | 'TEMPORAL';
  executionPolicy: 'APPLIES' | 'AUTO_PASS';
  total: number;
  done: number;
  pending: number;
  progress: {
    totalNrcInPeriod: number;
    reviewedNrcInPeriod: number;
    pendingNrcInPeriod: number;
    reviewedPercent: number;
    pendingPercent: number;
  };
  items: ReviewItem[];
};

type ReviewPanelProps = {
  apiBase: string;
  compact?: boolean;
  initialPeriodCode?: string;
  initialMoment?: string;
  initialPhase?: 'ALISTAMIENTO' | 'EJECUCION';
  initialCategory?: 'MUESTREO' | 'TEMPORAL';
  initialMoodleUrlTemplate?: string;
};

const TEMPLATE_OPTIONS = ['VACIO', 'CRIBA', 'INNOVAME', 'D4', 'UNKNOWN'] as const;

const CRIBA_ITEMS = [
  ['criba_b', 'B - Bienvenida'],
  ['criba_i', 'I - Introduccion'],
  ['criba_o', 'O - Objetivos'],
  ['criba_t', 'T - Temario'],
  ['criba_c', 'C - Calendario'],
  ['criba_e', 'E - Evaluacion'],
  ['criba_bib', 'BIB - Bibliografia'],
  ['criba_fp', 'FP - Foro presentacion'],
  ['criba_aa', 'AA - Actualizacion actividades'],
] as const;

const DEPRECATED_CRIBA_KEYS = ['criba_it', 'criba_r', 'criba_exa', 'criba_s'] as const;

const CHECKLIST_WINDOW_NAME = 'reviewChecklist';
let narrowPopupRef: Window | null = null;

function openChecklistPopupWindow(targetUrl: string, width: number, height: number, left: number, top: number): Window | null {
  const features = [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'location=no',
    'toolbar=no',
    'menubar=no',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');

  const popup = window.open('', CHECKLIST_WINDOW_NAME, features);
  if (!popup || popup.closed) return null;

  try {
    popup.name = CHECKLIST_WINDOW_NAME;
    popup.resizeTo?.(width, height);
    popup.moveTo?.(left, top);
    popup.location.replace(targetUrl);
    popup.focus();
  } catch {
    // ignore
  }

  return popup;
}

function toPhase(value: string | undefined): 'ALISTAMIENTO' | 'EJECUCION' {
  return value === 'EJECUCION' ? 'EJECUCION' : 'ALISTAMIENTO';
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'si', 'sí', 'true', 'ok', 'x', 'cumple'].includes(normalized);
  }
  return false;
}

function normalizeChecklistAliases(checklist: ChecklistState, template: string): ChecklistState {
  const next: ChecklistState = { ...checklist };

  // ingresos puede llegar como número (complianceRate de apply-teacher-access).
  // Se preserva el valor numérico para que el puntaje proporcional se mantenga al guardar.
  // NO convertir a boolean aquí — scoreEjecucion ya maneja ambos tipos.

  const asistencia = toBool(next.asistencia) || toBool(next.asis);
  if ('asistencia' in next || 'asis' in next) {
    next.asistencia = asistencia;
    next.asis = asistencia;
  }

  const actualizacion = toBool(next.actualizacion_actividades) || toBool(next.aa);
  if ('actualizacion_actividades' in next || 'aa' in next) {
    next.actualizacion_actividades = actualizacion;
    next.aa = actualizacion;
  }

  if (template === 'INNOVAME' || template === 'D4') {
    const presentacion = toBool(next.presentacion) || (toBool(next.fp) && toBool(next.fn));
    if ('presentacion' in next || 'fp' in next || 'fn' in next) {
      next.presentacion = presentacion;
      if (toBool(next.presentacion)) {
        next.fp = true;
        next.fn = true;
      }
    }
  }

  if (template === 'CRIBA') {
    for (const key of DEPRECATED_CRIBA_KEYS) {
      delete next[key];
    }
  }

  return next;
}

function normalizeChecklist(raw: unknown): ChecklistState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  return Object.entries(source).reduce<ChecklistState>((acc, [key, value]) => {
    // ingresos puede ser número (complianceRate de apply-teacher-access).
    // Se preserva para mantener el puntaje proporcional al guardar.
    if (key === 'ingresos' && typeof value === 'number') {
      acc[key] = value;
    } else {
      acc[key] = toBool(value);
    }
    return acc;
  }, {});
}

function resolveItemTemplate(item: ReviewItem | null): string {
  if (!item) return 'UNKNOWN';
  return (item.selectedCourse.detectedTemplate ?? item.template ?? 'UNKNOWN').toUpperCase();
}

function formatCalendarStateLabel(state: 'UNKNOWN' | 'UPCOMING' | 'ACTIVE' | 'ENDED'): string | null {
  if (state === 'UPCOMING') return 'Por iniciar';
  if (state === 'ACTIVE') return 'Activo';
  if (state === 'ENDED') return 'Finalizado';
  return null;
}

type CalendarFilter = 'ALL' | 'ACTIVE' | 'SHORT' | 'URGENTE';

type CalendarStats = { active: number; short: number; urgente: number; upcoming: number; unknown: number };

function CalendarPriorityPanel({
  stats,
  filter,
  sortByPriority,
  visibleCount,
  totalCount,
  onFilterChange,
  onSortToggle,
}: {
  stats: CalendarStats;
  filter: CalendarFilter;
  sortByPriority: boolean;
  visibleCount: number;
  totalCount: number;
  onFilterChange: (f: CalendarFilter) => void;
  onSortToggle: () => void;
}) {
  const FILTER_CONFIG: { value: CalendarFilter; label: string; count: number; color: string }[] = [
    { value: 'ALL', label: 'Todos', count: totalCount, color: '#1f5f99' },
    { value: 'ACTIVE', label: 'Activos hoy', count: stats.active, color: '#1b7a3e' },
    { value: 'SHORT', label: 'Cortos \u226428d', count: stats.short, color: '#b36200' },
    { value: 'URGENTE', label: 'Urgentes \u22647d', count: stats.urgente, color: '#c0392b' },
  ];

  return (
    <div
      style={{
        border: '1px solid #d0d7e3',
        borderRadius: 6,
        padding: '10px 14px',
        marginTop: 10,
        background: '#f8fafc',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Vista calendario
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {FILTER_CONFIG.map(({ value, label, count, color }) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              style={{
                fontSize: 12,
                padding: '3px 10px',
                borderRadius: 4,
                border: `1px solid ${active ? 'transparent' : '#c8d0dc'}`,
                background: active ? color : '#fff',
                color: active ? '#fff' : '#333',
                fontWeight: active ? 700 : 400,
                cursor: 'pointer',
              }}
              onClick={() => onFilterChange(value)}
            >
              {label}{count > 0 ? ` · ${count}` : ''}
            </button>
          );
        })}

        <button
          type="button"
          style={{
            fontSize: 12,
            padding: '3px 10px',
            borderRadius: 4,
            border: `1px solid ${sortByPriority ? 'transparent' : '#c8d0dc'}`,
            background: sortByPriority ? '#5b2d8e' : '#fff',
            color: sortByPriority ? '#fff' : '#333',
            fontWeight: sortByPriority ? 700 : 400,
            cursor: 'pointer',
            marginLeft: 4,
          }}
          onClick={onSortToggle}
        >
          {sortByPriority ? '↑ Prioridad activa' : '↑ Ordenar por prioridad'}
        </button>
      </div>

      {(filter !== 'ALL' || sortByPriority) && (
        <div style={{ fontSize: 11, color: '#666' }}>
          Mostrando {visibleCount} de {totalCount} NRC
          {stats.upcoming > 0 && <span style={{ marginLeft: 8 }}>· Por iniciar: {stats.upcoming}</span>}
          {stats.unknown > 0 && <span style={{ marginLeft: 8 }}>· Sin fechas: {stats.unknown}</span>}
        </div>
      )}
    </div>
  );
}

function applyCalendarFilterSort(
  items: ReviewItem[],
  filter: CalendarFilter,
  sortPriority: boolean,
): ReviewItem[] {
  const today = new Date();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  let result = items;

  if (filter !== 'ALL') {
    result = result.filter((item) => {
      const info = buildCourseScheduleInfo({
        startDate: item.selectedCourse.bannerStartDate,
        endDate: item.selectedCourse.bannerEndDate,
      });
      if (filter === 'ACTIVE') return info.calendarState === 'ACTIVE';
      if (filter === 'SHORT') return info.isShortCourse;
      if (filter === 'URGENTE') {
        if (!info.endIsoDate || info.calendarState !== 'ACTIVE') return false;
        const endMs = new Date(info.endIsoDate + 'T00:00:00Z').getTime();
        return Math.ceil((endMs - todayMs) / 86400000) <= 7;
      }
      return true;
    });
  }

  if (sortPriority) {
    result = [...result].sort((a, b) => {
      const getScore = (item: ReviewItem): number => {
        const info = buildCourseScheduleInfo({
          startDate: item.selectedCourse.bannerStartDate,
          endDate: item.selectedCourse.bannerEndDate,
        });
        const donePenalty = item.done ? 10000 : 0;
        if (info.calendarState !== 'ACTIVE') return donePenalty + 5000;
        if (!info.endIsoDate) return donePenalty + 4000;
        const endMs = new Date(info.endIsoDate + 'T00:00:00Z').getTime();
        const remaining = Math.ceil((endMs - todayMs) / 86400000);
        return donePenalty + Math.max(0, remaining);
      };
      return getScore(a) - getScore(b);
    });
  }

  return result;
}

function buildChecklistDefaults(phase: 'ALISTAMIENTO' | 'EJECUCION', template: string): ChecklistState {
  if (phase === 'EJECUCION') {
    return {
      acuerdo: false,
      grabaciones: false,
      ingresos: false,
      calificacion: false,
      asistencia: false,
      foro_fp: false,
      foro_fn: false,
    };
  }

  if (template === 'CRIBA') {
    const next: ChecklistState = {
      plantilla: false,
      fp: false,
      fn: false,
      asistencia: false,
      asis: false,
    };
    for (const [key] of CRIBA_ITEMS) next[key] = false;
    return next;
  }

  if (template === 'INNOVAME' || template === 'D4') {
    return {
      plantilla: false,
      asistencia: false,
      asis: false,
      presentacion: false,
      fp: false,
      fn: false,
      actualizacion_actividades: false,
      aa: false,
    };
  }

  return {};
}

export function ReviewPanel({
  apiBase,
  compact = false,
  initialPeriodCode = '202615',
  initialMoment = 'MD1',
  initialPhase = 'ALISTAMIENTO',
  initialCategory = 'MUESTREO',
  initialMoodleUrlTemplate = '',
}: ReviewPanelProps) {
  const [periodCode, setPeriodCode] = useState(initialPeriodCode);
  const [moment, setMoment] = useState(initialMoment);
  const [phase, setPhase] = useState<'ALISTAMIENTO' | 'EJECUCION'>(toPhase(initialPhase));
  const [queueCategory, setQueueCategory] = useState<'MUESTREO' | 'TEMPORAL'>(initialCategory);
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [lastReplication, setLastReplication] = useState<{ groupsMatched: number; replicatedCourses: number } | null>(
    null,
  );
  const [checklist, setChecklist] = useState<ChecklistState>({});
  const [draftChecklistByCourseId, setDraftChecklistByCourseId] = useState<Record<string, ChecklistState>>({});
  const [moodleUrlTemplate, setMoodleUrlTemplate] = useState(initialMoodleUrlTemplate);
  const [editableTemplate, setEditableTemplate] = useState<string>('UNKNOWN');
  const [nrcSearch, setNrcSearch] = useState('');
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('ALL');
  const [sortByPriority, setSortByPriority] = useState(false);
  const [nrcTableOpen, setNrcTableOpen] = useState(true);

  useLayoutEffect(() => {
    if (compact) {
      // Asegura que la ventana de checklist tenga un nombre fijo y no se reutilice como Moodle.
      window.name = CHECKLIST_WINDOW_NAME;
    }
  }, [compact]);

  useEffect(() => {
    const saved = localStorage.getItem('moodle_url_template');
    if (saved && !initialMoodleUrlTemplate) setMoodleUrlTemplate(saved);
  }, [initialMoodleUrlTemplate]);

  useEffect(() => {
    if (moodleUrlTemplate) {
      localStorage.setItem('moodle_url_template', moodleUrlTemplate);
    }
  }, [moodleUrlTemplate]);

  const processedItems = useMemo(
    () => applyCalendarFilterSort(queue?.items ?? [], calendarFilter, sortByPriority),
    [queue, calendarFilter, sortByPriority],
  );

  const calendarStats = useMemo(() => {
    const items = queue?.items ?? [];
    const today = new Date();
    const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    let active = 0, short = 0, urgente = 0, upcoming = 0, unknown = 0;
    for (const item of items) {
      const info = buildCourseScheduleInfo({
        startDate: item.selectedCourse.bannerStartDate,
        endDate: item.selectedCourse.bannerEndDate,
      });
      if (info.calendarState === 'ACTIVE') {
        active++;
        if (info.isShortCourse) short++;
        if (info.endIsoDate) {
          const endMs = new Date(info.endIsoDate + 'T00:00:00Z').getTime();
          if (Math.ceil((endMs - todayMs) / 86400000) <= 7) urgente++;
        }
      } else if (info.calendarState === 'UPCOMING') {
        upcoming++;
      } else if (info.calendarState === 'UNKNOWN') {
        unknown++;
      }
    }
    return { active, short, urgente, upcoming, unknown };
  }, [queue]);

  const current = useMemo(() => {
    if (!processedItems.length) return null;
    return processedItems[index] ?? null;
  }, [processedItems, index]);

  const currentTemplate = useMemo(() => resolveItemTemplate(current), [current]);

  const effectiveTemplate = useMemo(() => editableTemplate.toUpperCase(), [editableTemplate]);

  const savedNrcItems = useMemo(
    () => (queue?.items ?? []).filter((item) => !!item.evaluation && item.done),
    [queue],
  );

  const filteredSavedNrcItems = useMemo(() => {
    const query = nrcSearch.trim().toLowerCase();
    if (!query) return savedNrcItems;
    return savedNrcItems.filter((item) => item.selectedCourse.nrc.toLowerCase().includes(query));
  }, [nrcSearch, savedNrcItems]);

  const normalizedChecklist = useMemo(
    () => normalizeChecklistAliases(checklist, effectiveTemplate),
    [checklist, effectiveTemplate],
  );

  const currentScheduleInfo = useMemo(
    () =>
      buildCourseScheduleInfo({
        startDate: current?.selectedCourse.bannerStartDate,
        endDate: current?.selectedCourse.bannerEndDate,
      }),
    [current?.selectedCourse.bannerEndDate, current?.selectedCourse.bannerStartDate],
  );

  const executionExpectations = useMemo(
    () => buildExecutionExpectations(currentScheduleInfo),
    [currentScheduleInfo],
  );

  const daysRemaining = useMemo(() => {
    if (!currentScheduleInfo.endIsoDate) return null;
    if (currentScheduleInfo.calendarState === 'ENDED') return 0;
    const today = new Date();
    const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const endMs = new Date(currentScheduleInfo.endIsoDate + 'T00:00:00Z').getTime();
    return Math.ceil((endMs - todayMs) / 86400000);
  }, [currentScheduleInfo.endIsoDate, currentScheduleInfo.calendarState]);

  const liveScore = useMemo(() => {
    if (!current) return 0;
    if (phase === 'EJECUCION') {
      return scoreEjecucion(normalizedChecklist, {
        executionPolicy: queue?.executionPolicy === 'AUTO_PASS' ? 'AUTO_PASS' : 'APPLIES',
        bannerStartDate: current.selectedCourse.bannerStartDate,
        bannerEndDate: current.selectedCourse.bannerEndDate,
      }).score;
    }
    return scoreAlistamiento(effectiveTemplate, normalizedChecklist).score;
  }, [current, effectiveTemplate, normalizedChecklist, phase, queue?.executionPolicy]);

  const savedScore = current?.evaluation?.score ?? null;

  function resolveChecklistForItem(
    item: ReviewItem,
    template: string,
    draftSource: Record<string, ChecklistState>,
  ): ChecklistState {
    const draft = draftSource[item.selectedCourse.id];
    if (draft) {
      return normalizeChecklistAliases(
        {
          ...buildChecklistDefaults(phase, template),
          ...draft,
        },
        template,
      );
    }

    const persisted = normalizeChecklist(item.evaluation?.checklist);
    if (Object.keys(persisted).length > 0) {
      return normalizeChecklistAliases(
        {
          ...buildChecklistDefaults(phase, template),
          ...persisted,
        },
        template,
      );
    }

    return buildChecklistDefaults(phase, template);
  }

  function selectItemByIndex(
    nextIndex: number,
    sourceQueueOrItems: ReviewQueueResponse | ReviewItem[] | null = null,
    draftSource: Record<string, ChecklistState> = draftChecklistByCourseId,
  ) {
    const items: ReviewItem[] = Array.isArray(sourceQueueOrItems)
      ? sourceQueueOrItems
      : (sourceQueueOrItems?.items ?? processedItems);

    if (!items.length) {
      setIndex(0);
      setChecklist({});
      setEditableTemplate('UNKNOWN');
      return;
    }

    const boundedIndex = Math.min(Math.max(0, nextIndex), items.length - 1);
    const item = items[boundedIndex];
    const template = resolveItemTemplate(item);
    const nextChecklist = resolveChecklistForItem(item, template, draftSource);

    setIndex(boundedIndex);
    setEditableTemplate(template);
    setChecklist(nextChecklist);
  }

  useEffect(() => {
    if (!current) return;
    setEditableTemplate(currentTemplate);
  }, [current, currentTemplate]);

  function buildMoodleUrl(nrc: string): string {
    const source = moodleUrlTemplate.trim();
    if (!source) return '';
    if (source.includes('{nrc}')) return source.replaceAll('{nrc}', encodeURIComponent(nrc));
    const separator = source.includes('?') ? '&' : '?';
    return `${source}${separator}search=${encodeURIComponent(nrc)}`;
  }

  function isChecklistWindow(target: Window | null): boolean {
    if (!target) return false;
    if (target === window) return true;
    try {
      return target.name === CHECKLIST_WINDOW_NAME;
    } catch {
      return false;
    }
  }

  function openNrcInMoodle(nrc: string, directUrl?: string | null, reservedTab?: Window | null) {
    const url = (directUrl ?? '').trim() || buildMoodleUrl(nrc);
    if (!url) {
      setMessage('Configura primero la URL base de Moodle.');
      return false;
    }

    if (reservedTab && !reservedTab.closed && !isChecklistWindow(reservedTab)) {
      try {
        reservedTab.location.href = url;
        reservedTab.focus();
        return true;
      } catch {
        // ignore and fallback
      }
    }

    const tryOpenTab = (host: Window): Window | null => {
      try {
        const tab = host.open(url, '_blank');
        if (tab && !tab.closed && !isChecklistWindow(tab)) {
          tab.focus();
          return tab;
        }
      } catch {
        // ignore
      }
      return null;
    };

    // Si estamos en modo compacto/angosto, prioriza abrir en la ventana principal del navegador.
    if (compact) {
      try {
        if (window.opener && !window.opener.closed) {
          const openedInMain = tryOpenTab(window.opener);
          if (openedInMain) return true;

          // Fallback: si el navegador bloquea la nueva pestaña, navegar la ventana principal.
          window.opener.location.href = url;
          window.opener.focus();
          return true;
        }
      } catch {
        // ignore
      }
    }

    const tab = tryOpenTab(window);
    if (tab) return true;

    setMessage('El navegador bloqueó la apertura. Permite popups para localhost.');
    return false;
  }

  function openFloatingTab() {
    const params = new URLSearchParams({ periodCode, moment, phase, category: queueCategory });
    const targetUrl = `/review?${params.toString()}`;
    const popup = openChecklistPopupWindow(targetUrl, 1180, 900, 40, 40);
    if (popup && !popup.closed) {
      try {
        popup.name = CHECKLIST_WINDOW_NAME;
        popup.focus();
      } catch {
        // ignore
      }
      return;
    }
    setMessage('El navegador bloqueó la ventana emergente. Permite pop-ups para localhost.');
  }

  function openFloatingNarrowWindow() {
    const params = new URLSearchParams({ periodCode, moment, phase, category: queueCategory });
    const targetUrl = `/review?${params.toString()}`;
    const existingPopup = narrowPopupRef && !narrowPopupRef.closed ? narrowPopupRef : null;
    const tab = existingPopup ?? openChecklistPopupWindow(targetUrl, 430, 920, 32, 32);
    if (tab && !tab.closed) {
      try {
        tab.name = CHECKLIST_WINDOW_NAME;
        narrowPopupRef = tab;
        tab.resizeTo?.(430, 920);
        tab.moveTo?.(32, 32);
        if (existingPopup) {
          tab.location.replace(targetUrl);
        }
        tab.focus();
      } catch {
        // ignore
      }
      return;
    }
    setMessage('El navegador bloqueó la ventana emergente. Permite pop-ups para localhost.');
  }

  async function loadQueue(): Promise<ReviewQueueResponse | null> {
    try {
      setLoading(true);
      setMessage('');
      const params = new URLSearchParams({
        periodCode,
        phase,
        category: queueCategory,
      });
      if (moment) params.set('moment', moment);

      const response = await fetch(`${apiBase}/sampling/review-queue?${params.toString()}`);
      const data = (await response.json()) as ReviewQueueResponse;

      setQueue(data);
      setNrcSearch('');

      const localItems = applyCalendarFilterSort(data.items, calendarFilter, sortByPriority);
      const nextPending = localItems.findIndex((item) => !item.done);
      const targetIndex = nextPending >= 0 ? nextPending : 0;
      const initialDrafts = data.items.reduce<Record<string, ChecklistState>>((acc, item) => {
        const parsed = normalizeChecklist(item.evaluation?.checklist);
        if (Object.keys(parsed).length > 0) {
          acc[item.selectedCourse.id] = parsed;
        }
        return acc;
      }, {});

      setDraftChecklistByCourseId(initialDrafts);
      selectItemByIndex(targetIndex, localItems, initialDrafts);
      return data;
    } catch {
      setMessage('No fue posible cargar la cola de revision.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function persistCurrentTemplate(template: string): Promise<boolean> {
    if (!current) return false;
    if (!TEMPLATE_OPTIONS.includes(template as (typeof TEMPLATE_OPTIONS)[number])) {
      setMessage(`Tipo de aula invalido: ${template}`);
      return false;
    }

    try {
      setSavingTemplate(true);
      setMessage('');
      const response = await fetch(`${apiBase}/courses/${current.selectedCourse.id}/manual`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detectedTemplate: template,
        }),
      });

      const data = (await response.json()) as {
        ok?: boolean;
        moodleCheck?: { detectedTemplate?: string | null };
        message?: string;
      };

      if (!response.ok || !data?.ok) {
        setMessage(data?.message || 'No se pudo actualizar el tipo de aula.');
        return false;
      }

      const nextTemplate = (data.moodleCheck?.detectedTemplate ?? template).toUpperCase();
      setEditableTemplate(nextTemplate);
      setQueue((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.selectedCourse.id === current.selectedCourse.id
              ? {
                  ...item,
                  selectedCourse: {
                    ...item.selectedCourse,
                    detectedTemplate: nextTemplate,
                  },
                }
              : item,
          ),
        };
      });

      const nextChecklist = buildChecklistDefaults(phase, nextTemplate);
      setChecklist(nextChecklist);
      setDraftChecklistByCourseId((prev) => ({
        ...prev,
        [current.selectedCourse.id]: nextChecklist,
      }));

      setMessage(`Tipo de aula actualizado a ${nextTemplate}.`);
      return true;
    } catch {
      setMessage('No se pudo actualizar el tipo de aula.');
      return false;
    } finally {
      setSavingTemplate(false);
    }
  }

  async function saveCurrent(goNext: boolean, openNextInMoodle = false, reservedTab?: Window | null) {
    if (!current) return;
    try {
      const templateToPersist = editableTemplate.toUpperCase();
      if (templateToPersist !== currentTemplate) {
        const synced = await persistCurrentTemplate(templateToPersist);
        if (!synced) {
          if (reservedTab && !reservedTab.closed) {
            try {
              reservedTab.close();
            } catch {
              // ignore
            }
          }
          return;
        }
      }

      setSaving(true);
      setMessage('');
      const payload = {
        courseId: current.selectedCourse.id,
        phase,
        replicateToGroup: true,
        checklist: normalizedChecklist,
      };
      const response = await fetch(`${apiBase}/evaluation/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        evaluation?: { score: number };
        replication?: { groupsMatched?: number; replicatedCourses?: number };
      };
      if (!response.ok || !data?.ok) {
        setMessage('No se pudo guardar la revision.');
        if (reservedTab && !reservedTab.closed) {
          try {
            reservedTab.close();
          } catch {
            // ignore
          }
        }
        return;
      }

      const replicatedCourses = data.replication?.replicatedCourses ?? 0;
      const groupsMatched = data.replication?.groupsMatched ?? 0;
      setLastReplication({ groupsMatched, replicatedCourses });
      const replicationText =
        replicatedCourses > 0
          ? ` Replicado a ${replicatedCourses} NRC.`
          : ' Sin NRC adicionales para replicar.';
      setMessage(`Revision guardada. Puntaje: ${data.evaluation?.score ?? 0}/50.${replicationText}`);
      const selectedCourseId = current.selectedCourse.id;
      const refreshed = await loadQueue();

      // loadQueue ya navega internamente al siguiente pendiente (goNext)
      // o re-selecciona el item actual (!goNext).
      if (!goNext && refreshed) {
        const refreshedProcessed = applyCalendarFilterSort(refreshed.items, calendarFilter, sortByPriority);
        const newIndex = refreshedProcessed.findIndex((item) => item.selectedCourse.id === selectedCourseId);
        if (newIndex >= 0) {
          selectItemByIndex(newIndex, refreshedProcessed, {});
        }
      }
    } catch {
      setMessage('Error guardando la revision.');
      if (reservedTab && !reservedTab.closed) {
        try {
          reservedTab.close();
        } catch {
          // ignore
        }
      }
    } finally {
      setSaving(false);
    }
  }

  function setChecked(key: string, value: boolean) {
    setChecklist((prev) => {
      const nextChecklist: ChecklistState = { ...prev, [key]: value };

      if (key === 'asistencia' || key === 'asis') {
        nextChecklist.asistencia = value;
        nextChecklist.asis = value;
      }

      if (key === 'actualizacion_actividades' || key === 'aa') {
        nextChecklist.actualizacion_actividades = value;
        nextChecklist.aa = value;
      }

      if ((effectiveTemplate === 'INNOVAME' || effectiveTemplate === 'D4') && key === 'presentacion') {
        nextChecklist.presentacion = value;
        nextChecklist.fp = value;
        nextChecklist.fn = value;
      }

      if ((effectiveTemplate === 'INNOVAME' || effectiveTemplate === 'D4') && (key === 'fp' || key === 'fn')) {
        nextChecklist.presentacion = toBool(nextChecklist.fp) && toBool(nextChecklist.fn);
      }

      const aliasedChecklist = normalizeChecklistAliases(nextChecklist, effectiveTemplate);
      if (current) {
        setDraftChecklistByCourseId((drafts) => ({
          ...drafts,
          [current.selectedCourse.id]: aliasedChecklist,
        }));
      }
      return aliasedChecklist;
    });
  }

  function renderChecklist() {
    if (!current) return null;

    if (phase === 'EJECUCION') {
      return (
        <>
          {executionExpectations.reviewHint ? (
            <p className="muted" style={{ marginBottom: 10 }}>
              {executionExpectations.reviewHint} {executionExpectations.shortCourseHint}
            </p>
          ) : null}
          <div className="form-grid">
            {[
              ['acuerdo', 'Acuerdo pedagogico'],
              ['grabaciones', 'Grabaciones'],
              ['ingresos', executionExpectations.ingresosLabel],
              ['calificacion', 'Calificaciones'],
              ['asistencia', 'Asistencia'],
              ['foro_fp', 'Foro presentacion'],
              ['foro_fn', 'Foro novedades'],
            ].map(([key, label]) => (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={!!checklist[key]}
                  onChange={(event) => setChecked(key, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </>
      );
    }

    if (effectiveTemplate === 'CRIBA') {
      return (
        <>
          <div className="form-grid">
            {[
              ['plantilla', 'Cargue de plantilla'],
              ['fp', 'Foro presentacion'],
              ['fn', 'Foro novedades'],
              ['asistencia', 'Asistencia'],
            ].map(([key, label]) => (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={!!checklist[key]}
                  onChange={(event) => setChecked(key, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="subtitle">Items CRIBA (10 puntos distribuidos en 9 criterios)</div>
          <div className="form-grid">
            {CRIBA_ITEMS.map(([key, label]) => (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={!!checklist[key]}
                  onChange={(event) => setChecked(key, event.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </>
      );
    }

    if (effectiveTemplate === 'INNOVAME' || effectiveTemplate === 'D4') {
      return (
        <div className="form-grid">
          {[
            ['plantilla', 'Cargue de plantilla (20)'],
            ['asistencia', 'Asistencia (10)'],
            ['presentacion', 'Presentacion (10)'],
            ['actualizacion_actividades', 'Actualizacion actividades (10)'],
          ].map(([key, label]) => (
            <label className="checkbox" key={key}>
              <input
                type="checkbox"
                checked={!!checklist[key]}
                onChange={(event) => setChecked(key, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      );
    }

    if (effectiveTemplate === 'VACIO') {
      if ((current.selectedCourse.enrolledCount ?? 0) > 0) {
        return (
          <p className="muted">
            Aula VACIA con estudiantes. Se guarda con calificacion 0 y se replica al grupo. No requiere checklist.
          </p>
        );
      }

      return <p className="muted">Esta aula es VACIA y no tiene estudiantes. No requiere checklist de alistamiento.</p>;
    }

    return <p className="muted">Esta aula no requiere checklist de alistamiento.</p>;
  }

  return (
    <article className={`panel ${compact ? 'panel-compact' : ''}`}>

      {/* ── HEADER ── */}
      <div className="panel-heading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Revision NRC</h2>
          {queue ? (
            <>
              <span className="chip chip-info">{queue.periodCode}</span>
              <span className="chip chip-primary">{queue.phase}</span>
              {queue.moment ? <span className="chip">{queue.moment}</span> : null}
              <span className="chip chip-ok">{queue.done}/{queue.total} hechos</span>
            </>
          ) : null}
        </div>
        <div className="toolbar">
          {!compact ? (
            <button type="button" onClick={openFloatingTab}>
              Abrir flotante
            </button>
          ) : null}
          <button type="button" onClick={() => void loadQueue()} disabled={loading} className="primary">
            {loading ? 'Cargando...' : 'Cargar cola'}
          </button>
        </div>
      </div>

      {/* ── CARGA DE COLA (colapsable) ── */}
      <details className="disclosure" style={{ marginTop: 8 }}>
        <summary>Cargar cola de revision</summary>
        <div className="disclosure-body">
          <div className="form-grid">
            <label>
              Periodo
              <input value={periodCode} onChange={(event) => setPeriodCode(event.target.value)} placeholder="202615" />
            </label>
            <label>
              Momento
              <select value={moment} onChange={(event) => setMoment(event.target.value)}>
                <option value="MD1">MD1 (RY1)</option>
                <option value="MD2">MD2 (RY2)</option>
                <option value="1">1 (RYC)</option>
              </select>
            </label>
            <label>
              Fase
              <select value={phase} onChange={(event) => setPhase(event.target.value as 'ALISTAMIENTO' | 'EJECUCION')}>
                <option value="ALISTAMIENTO">Alistamiento</option>
                <option value="EJECUCION">Ejecucion</option>
              </select>
            </label>
            <label>
              Categoria
              <select
                value={queueCategory}
                onChange={(event) => setQueueCategory(event.target.value as 'MUESTREO' | 'TEMPORAL')}
              >
                <option value="MUESTREO">Muestreo normal</option>
                <option value="TEMPORAL">Temporal (rezagados/casos)</option>
              </select>
            </label>
            <label className="wide">
              URL Moodle
              <input
                value={moodleUrlTemplate}
                onChange={(event) => setMoodleUrlTemplate(event.target.value)}
                placeholder="https://campus.../course/search.php?search={nrc}"
              />
            </label>
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" onClick={() => void loadQueue()} disabled={loading} className="primary">
              {loading ? 'Cargando...' : 'Cargar cola'}
            </button>
          </div>
        </div>
      </details>

      {/* ── BARRA DE PROGRESO ── */}
      {queue ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--n-500)', marginBottom: 4 }}>
            <span>Avance del periodo</span>
            <span>{queue.progress.reviewedNrcInPeriod} / {queue.progress.totalNrcInPeriod} NRC &mdash; {queue.progress.reviewedPercent}%</span>
          </div>
          <div className="progress-bar">
            <div
              className={`progress-bar-fill${queue.progress.reviewedPercent >= 80 ? ' ok' : queue.progress.reviewedPercent >= 40 ? ' warn' : ' danger'}`}
              style={{ width: `${queue.progress.reviewedPercent}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* ── COLA + FILTROS ── */}
      {queue ? (
        <div style={{ marginTop: 12 }}>
          <CalendarPriorityPanel
            stats={calendarStats}
            filter={calendarFilter}
            sortByPriority={sortByPriority}
            visibleCount={processedItems.length}
            totalCount={queue.items.length}
            onFilterChange={(f) => { setCalendarFilter(f); setIndex(0); }}
            onSortToggle={() => { setSortByPriority((prev) => !prev); setIndex(0); }}
          />

          {/* Lista de cola con altura fija */}
          <div
            className="issue-list"
            style={{ maxHeight: 420, overflowY: 'auto', marginTop: 10 }}
          >
            {processedItems.length === 0 ? (
              <p className="muted" style={{ padding: '10px 14px' }}>Sin items para este filtro.</p>
            ) : (
              processedItems.map((item, i) => {
                const isActive = i === index;
                const itemSchedule = buildCourseScheduleInfo({
                  startDate: item.selectedCourse.bannerStartDate,
                  endDate: item.selectedCourse.bannerEndDate,
                });
                return (
                  <button
                    key={item.sampleGroupId}
                    type="button"
                    onClick={() => selectItemByIndex(i, processedItems)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '7px 12px',
                      background: isActive ? 'var(--blue-light, #dbeafe)' : item.done ? 'var(--n-50)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--n-100)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      gap: 8,
                    }}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: isActive ? 700 : 500, fontSize: 13 }}>
                        NRC {item.selectedCourse.nrc}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--n-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.teacherName}
                        {item.selectedCourse.subjectName ? ` · ${item.selectedCourse.subjectName}` : ''}
                      </span>
                    </span>
                    <span style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                      {item.evaluation ? (
                        <span className="badge badge-green" style={{ fontSize: 10 }}>{item.evaluation.score}/50</span>
                      ) : null}
                      {item.done ? (
                        <span className="badge badge-gray" style={{ fontSize: 10 }}>Hecho</span>
                      ) : (
                        <span className="badge badge-amber" style={{ fontSize: 10 }}>Pendiente</span>
                      )}
                      {itemSchedule.calendarState === 'ACTIVE' && (() => {
                        if (!itemSchedule.endIsoDate) return null;
                        const today = new Date();
                        const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
                        const endMs = new Date(itemSchedule.endIsoDate + 'T00:00:00Z').getTime();
                        const days = Math.ceil((endMs - todayMs) / 86400000);
                        if (days <= 7) return <span className="badge badge-red" style={{ fontSize: 10 }}>!{days}d</span>;
                        return null;
                      })()}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* NRC guardados buscables */}
          <details className="disclosure" style={{ marginTop: 8 }}>
            <summary>NRC guardados ({savedNrcItems.length})</summary>
            <div className="disclosure-body">
              <div className="form-grid" style={{ marginBottom: 8 }}>
                <label>
                  Buscar NRC
                  <input
                    value={nrcSearch}
                    onChange={(event) => setNrcSearch(event.target.value)}
                    placeholder="Ej: 15234"
                  />
                </label>
              </div>
              <table className="compact-table">
                <thead>
                  <tr>
                    <th>NRC</th>
                    <th>Calificacion</th>
                    <th>Observaciones</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSavedNrcItems.length ? (
                    filteredSavedNrcItems.map((item) => (
                      <tr key={item.sampleGroupId}>
                        <td>{item.selectedCourse.nrc}</td>
                        <td>{item.evaluation?.score ?? 0}/50</td>
                        <td>{item.evaluation?.observations?.trim() || '-'}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => {
                              if (!queue?.items.length) return;
                              const targetIndex = queue.items.findIndex((qItem) => qItem.sampleGroupId === item.sampleGroupId);
                              if (targetIndex >= 0) selectItemByIndex(targetIndex);
                            }}
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="muted">No hay NRC guardados para ese filtro.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 12 }}>Carga una cola para iniciar la revision.</p>
      )}

      {/* ── PANEL DE CHECKLIST ACTIVO ── */}
      {!current ? (
        queue ? <p className="muted" style={{ marginTop: 10 }}>Sin registros de muestreo para este filtro.</p> : null
      ) : (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--n-200)', paddingTop: 14 }}>

          {/* Encabezado del NRC activo */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>
                  NRC {current.selectedCourse.nrc}
                </span>
                {currentScheduleInfo.calendarState === 'ACTIVE' && daysRemaining !== null && daysRemaining <= 7 && (
                  <span className="chip chip-alert">URGENTE {daysRemaining}d</span>
                )}
                {currentScheduleInfo.calendarState === 'ACTIVE' && currentScheduleInfo.isShortCourse && (daysRemaining === null || daysRemaining > 7) && (
                  <span className="chip chip-warn">CORTO</span>
                )}
                {currentScheduleInfo.calendarState === 'ACTIVE' && !currentScheduleInfo.isShortCourse && (daysRemaining === null || daysRemaining > 7) && (
                  <span className="chip chip-ok">ACTIVO</span>
                )}
                {currentScheduleInfo.calendarState === 'UPCOMING' && (
                  <span className="chip">POR INICIAR</span>
                )}
                {currentScheduleInfo.calendarState === 'ENDED' && (
                  <span className="chip chip-alert">FINALIZADO</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'var(--n-600)', marginTop: 2 }}>
                {current.selectedCourse.subjectName ?? '-'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--n-500)', marginTop: 1 }}>
                {current.teacherName} &middot; {current.programCode}
                {current.selectedCourse.enrolledCount != null ? ` · ${current.selectedCourse.enrolledCount} inscritos` : ''}
                {formatCourseWindowLabel(currentScheduleInfo) ? ` · ${formatCourseWindowLabel(currentScheduleInfo)}` : ''}
                {daysRemaining !== null && currentScheduleInfo.calendarState === 'ACTIVE' ? (
                  <span style={{ color: daysRemaining <= 7 ? '#c0392b' : daysRemaining <= 14 ? '#b36200' : undefined, fontWeight: daysRemaining <= 7 ? 700 : undefined }}>
                    {' · '}{daysRemaining}d restantes
                  </span>
                ) : null}
              </div>
            </div>

            {/* Boton Moodle prominent */}
            <button
              type="button"
              className="primary"
              style={{ flexShrink: 0 }}
              onClick={() => openNrcInMoodle(current.selectedCourse.nrc, current.selectedCourse.moodleCourseUrl)}
            >
              Abrir en Moodle {current.selectedCourse.moodleCourseUrl ? '(URL detectada)' : '(buscar)'}
            </button>
          </div>

          {/* Tipo de aula editable */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--n-500)' }}>Tipo aula:</span>
            <select
              value={editableTemplate}
              onChange={(event) => {
                const nextTemplate = event.target.value.toUpperCase();
                setEditableTemplate(nextTemplate);
                const nextChecklist = buildChecklistDefaults(phase, nextTemplate);
                setChecklist(nextChecklist);
                setDraftChecklistByCourseId((prev) => ({
                  ...prev,
                  [current.selectedCourse.id]: nextChecklist,
                }));
              }}
            >
              {TEMPLATE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { void persistCurrentTemplate(editableTemplate.toUpperCase()); }}
              disabled={savingTemplate || editableTemplate.toUpperCase() === currentTemplate}
            >
              {savingTemplate ? 'Guardando...' : 'Guardar tipo'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--n-400)' }}>
              Estado Moodle: {current.selectedCourse.moodleStatus ?? 'N/A'}
            </span>
          </div>

          {/* Checklist */}
          <div style={{ marginBottom: 14 }}>{renderChecklist()}</div>

          {/* Score display */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', padding: '10px 14px', background: 'var(--n-50)', borderRadius: 6, marginBottom: 14 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: liveScore >= 40 ? '#1b7a3e' : liveScore >= 20 ? '#b36200' : '#c0392b' }}>
                {liveScore}
              </div>
              <div style={{ fontSize: 11, color: 'var(--n-500)', marginTop: 2 }}>en progreso / 50</div>
            </div>
            {savedScore !== null ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--n-400)' }}>
                  {savedScore}
                </div>
                <div style={{ fontSize: 11, color: 'var(--n-500)', marginTop: 2 }}>guardado / 50</div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--n-400)' }}>Sin guardar</div>
            )}
            {lastReplication ? (
              <div style={{ fontSize: 11, color: 'var(--n-500)', marginLeft: 'auto' }}>
                Replicado a <strong>{lastReplication.replicatedCourses}</strong> NRC
              </div>
            ) : null}
          </div>

          {/* Toolbar de navegacion y acciones */}
          <div className="toolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              onClick={() => selectItemByIndex(Math.max(0, index - 1), processedItems)}
              disabled={index <= 0}
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => {
                if (!processedItems.length) return;
                selectItemByIndex(Math.min(processedItems.length - 1, index + 1), processedItems);
              }}
              disabled={!processedItems.length || index >= processedItems.length - 1}
            >
              Siguiente
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => void saveCurrent(false)}
              disabled={saving}
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                const nextPending = processedItems.find((item, i) => i !== index && !item.done);
                if (nextPending) {
                  openNrcInMoodle(nextPending.selectedCourse.nrc, nextPending.selectedCourse.moodleCourseUrl);
                }
                void saveCurrent(true, false);
              }}
              disabled={saving}
            >
              {saving ? 'Guardando...' : 'Guardar y siguiente (AUTO)'}
            </button>
          </div>
        </div>
      )}

      {message ? <div className="message" style={{ marginTop: 10 }}>{message}</div> : null}
    </article>
  );
}
