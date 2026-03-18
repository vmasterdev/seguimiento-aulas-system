'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';

type ChecklistState = Record<string, boolean>;

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
  ['criba_it', 'IT - Items'],
  ['criba_aa', 'AA - Actualizacion actividades'],
  ['criba_r', 'R - Rubrica'],
  ['criba_exa', 'EXA - Examenes'],
  ['criba_s', 'S - Seguimiento'],
] as const;

const CHECKLIST_WINDOW_NAME = 'reviewChecklist';

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

  return next;
}

function calculateAlistamientoScore(template: string, checklist: ChecklistState): number {
  const normalizedTemplate = template.toUpperCase();

  if (normalizedTemplate === 'VACIO') return 0;

  if (normalizedTemplate === 'INNOVAME' || normalizedTemplate === 'D4') {
    const presentacionOk = toBool(checklist.presentacion) || (toBool(checklist.fp) && toBool(checklist.fn));
    const score =
      (toBool(checklist.plantilla) ? 20 : 0) +
      (toBool(checklist.asistencia) || toBool(checklist.asis) ? 10 : 0) +
      (presentacionOk ? 10 : 0) +
      (toBool(checklist.actualizacion_actividades) || toBool(checklist.aa) ? 10 : 0);
    return score;
  }

  if (normalizedTemplate === 'CRIBA') {
    const base =
      (toBool(checklist.plantilla) ? 20 : 0) +
      (toBool(checklist.fp) ? 5 : 0) +
      (toBool(checklist.fn) ? 5 : 0) +
      (toBool(checklist.asistencia) || toBool(checklist.asis) ? 10 : 0);
    const unit = 10 / CRIBA_ITEMS.length;
    const cribaScore = CRIBA_ITEMS.reduce((acc, [key]) => acc + (toBool(checklist[key]) ? unit : 0), 0);
    return Number((base + cribaScore).toFixed(2));
  }

  return 0;
}

function calculateEjecucionScore(checklist: ChecklistState, executionPolicy: 'APPLIES' | 'AUTO_PASS'): number {
  if (executionPolicy === 'AUTO_PASS') return 50;

  const core =
    (toBool(checklist.acuerdo) ? 10 : 0) +
    (toBool(checklist.grabaciones) ? 10 : 0) +
    (toBool(checklist.ingresos) ? 10 : 0) +
    (toBool(checklist.calificacion) ? 10 : 0) +
    (toBool(checklist.asistencia) ? 5 : 0);

  const forumWeights: Record<string, number> = {
    fp: 1.25,
    fd: 1.25,
    fn: 0.5,
    ft: 1.25,
  };

  const achievedForumWeight = Object.entries(forumWeights).reduce(
    (acc, [key, value]) => acc + (toBool(checklist[`foro_${key}`]) ? value : 0),
    0,
  );
  const totalForumWeight = Object.values(forumWeights).reduce((acc, item) => acc + item, 0);
  const forumScore = totalForumWeight === 0 ? 0 : (achievedForumWeight / totalForumWeight) * 5;

  return Number((core + forumScore).toFixed(2));
}

function normalizeChecklist(raw: unknown): ChecklistState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  return Object.entries(source).reduce<ChecklistState>((acc, [key, value]) => {
    acc[key] = toBool(value);
    return acc;
  }, {});
}

function resolveItemTemplate(item: ReviewItem | null): string {
  if (!item) return 'UNKNOWN';
  return (item.selectedCourse.detectedTemplate ?? item.template ?? 'UNKNOWN').toUpperCase();
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
      foro_fd: false,
      foro_fn: false,
      foro_ft: false,
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
  initialMoodleUrlTemplate = '',
}: ReviewPanelProps) {
  const [periodCode, setPeriodCode] = useState(initialPeriodCode);
  const [moment, setMoment] = useState(initialMoment);
  const [phase, setPhase] = useState<'ALISTAMIENTO' | 'EJECUCION'>(toPhase(initialPhase));
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

  const current = useMemo(() => {
    if (!queue?.items?.length) return null;
    return queue.items[index] ?? null;
  }, [queue, index]);

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

  const liveScore = useMemo(() => {
    if (!current) return 0;
    if (phase === 'EJECUCION') {
      return calculateEjecucionScore(normalizedChecklist, queue?.executionPolicy === 'AUTO_PASS' ? 'AUTO_PASS' : 'APPLIES');
    }
    return calculateAlistamientoScore(effectiveTemplate, normalizedChecklist);
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
    sourceQueue: ReviewQueueResponse | null = queue,
    draftSource: Record<string, ChecklistState> = draftChecklistByCourseId,
  ) {
    if (!sourceQueue?.items.length) {
      setIndex(0);
      setChecklist({});
      setEditableTemplate('UNKNOWN');
      return;
    }

    const boundedIndex = Math.min(Math.max(0, nextIndex), sourceQueue.items.length - 1);
    const item = sourceQueue.items[boundedIndex];
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
    const params = new URLSearchParams({ periodCode, moment, phase });
    // Abrir en pestana normal (no popup) para que Moodle tambien abra en pestanas normales.
    window.open(`/review?${params.toString()}`, '_blank');
  }

  function openFloatingNarrowWindow() {
    const params = new URLSearchParams({ periodCode, moment, phase });
    const targetUrl = `/review?${params.toString()}`;
    const tab = window.open(targetUrl, CHECKLIST_WINDOW_NAME);
    if (tab && !tab.closed) {
      try {
        tab.name = CHECKLIST_WINDOW_NAME;
        tab.focus();
      } catch {
        // ignore
      }
      return;
    }
    setMessage('El navegador bloqueó la pestaña angosta. Permite popups para localhost.');
  }

  async function loadQueue(): Promise<ReviewQueueResponse | null> {
    try {
      setLoading(true);
      setMessage('');
      const params = new URLSearchParams({
        periodCode,
        phase,
      });
      if (moment) params.set('moment', moment);

      const response = await fetch(`${apiBase}/sampling/review-queue?${params.toString()}`);
      const data = (await response.json()) as ReviewQueueResponse;

      setQueue(data);
      setNrcSearch('');

      const nextPending = data.items.findIndex((item) => !item.done);
      const targetIndex = nextPending >= 0 ? nextPending : 0;
      const initialDrafts = data.items.reduce<Record<string, ChecklistState>>((acc, item) => {
        const parsed = normalizeChecklist(item.evaluation?.checklist);
        if (Object.keys(parsed).length > 0) {
          acc[item.selectedCourse.id] = parsed;
        }
        return acc;
      }, {});

      setDraftChecklistByCourseId(initialDrafts);
      selectItemByIndex(targetIndex, data, initialDrafts);
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

      if (!goNext && refreshed) {
        const sameIndex = refreshed.items.findIndex((item) => item.selectedCourse.id === selectedCourseId);
        if (sameIndex >= 0) {
          selectItemByIndex(sameIndex, refreshed, {});
        }
      }

      if (goNext && openNextInMoodle && refreshed?.items?.length) {
        const nextPendingIndex = refreshed.items.findIndex((item) => !item.done);
        if (nextPendingIndex >= 0) {
          const nextCourse = refreshed.items[nextPendingIndex].selectedCourse;
          const nextUrl = (nextCourse.moodleCourseUrl ?? '').trim() || buildMoodleUrl(nextCourse.nrc);
          if (!nextUrl) {
            setMessage('No hay URL para el siguiente NRC. Verifica la configuración de URL Moodle.');
            if (reservedTab && !reservedTab.closed) {
              try {
                reservedTab.close();
              } catch {
                // ignore
              }
            }
            return;
          }
          openNrcInMoodle(nextCourse.nrc, nextCourse.moodleCourseUrl, reservedTab);
        } else if (reservedTab && !reservedTab.closed) {
          try {
            reservedTab.close();
          } catch {
            // ignore
          }
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
        <div className="form-grid">
          {[
            ['acuerdo', 'Acuerdo pedagogico'],
            ['grabaciones', 'Grabaciones'],
            ['ingresos', 'Ingresos (3 por semana)'],
            ['calificacion', 'Calificaciones'],
            ['asistencia', 'Asistencia'],
            ['foro_fp', 'Foro presentacion'],
            ['foro_fd', 'Foro dialogo'],
            ['foro_fn', 'Foro novedades'],
            ['foro_ft', 'Foro tematico'],
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
          <div className="subtitle">Items CRIBA (10 puntos distribuidos en 13 criterios)</div>
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

    return <p className="muted">Esta aula es VACIA o sin tipo definido. No requiere checklist de alistamiento.</p>;
  }

  return (
    <article className={`panel ${compact ? 'panel-compact' : ''}`}>
      <h2>Flujo de revision manual por muestreo</h2>
      <div className="controls">
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
        <button onClick={loadQueue} disabled={loading}>
          {loading ? 'Cargando...' : 'Cargar cola'}
        </button>
        {!compact ? (
          <>
            <button onClick={openFloatingTab} type="button">
              Abrir flotante (pestana)
            </button>
            <button onClick={openFloatingNarrowWindow} type="button">
              Abrir flotante angosto
            </button>
          </>
        ) : null}
      </div>
      {!compact ? (
        <div className="muted" style={{ marginTop: 6 }}>
          Puedes abrir el checklist en pestana normal o en ventana angosta, segun tu flujo de revision.
        </div>
      ) : null}

      <div className="controls" style={{ marginTop: 8 }}>
        <label style={{ minWidth: 360 }}>
          URL Moodle
          <input
            value={moodleUrlTemplate}
            onChange={(event) => setMoodleUrlTemplate(event.target.value)}
            placeholder="https://campus.../course/search.php?search={nrc}"
          />
        </label>
      </div>

      <div className="actions">
        {queue ? (
          <>
            Total grupos: <span className="code">{queue.total}</span> | Pendientes:{' '}
            <span className="code">{queue.pending}</span> | Hechos: <span className="code">{queue.done}</span>
          </>
        ) : (
          'Carga una cola para iniciar la revision.'
        )}
      </div>

      {queue ? (
        <div className="saved-nrc-block">
          <div className="saved-nrc-kpis">
            <span className="badge">NRC periodo: {queue.progress.totalNrcInPeriod}</span>
            <span className="badge">Guardados: {queue.progress.reviewedNrcInPeriod}</span>
            <span className="badge">Faltantes: {queue.progress.pendingNrcInPeriod}</span>
            <span className="badge">Avance: {queue.progress.reviewedPercent}%</span>
            <span className="badge">Falta: {queue.progress.pendingPercent}%</span>
          </div>

          <div className="controls" style={{ marginTop: 8 }}>
            <label style={{ minWidth: 240 }}>
              Buscar NRC guardado
              <input
                value={nrcSearch}
                onChange={(event) => setNrcSearch(event.target.value)}
                placeholder="Ej: 15234"
              />
            </label>
          </div>

          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>NRC</th>
                <th>Calificacion</th>
                <th>Observaciones</th>
                <th>Accion</th>
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
                          if (targetIndex >= 0) {
                            selectItemByIndex(targetIndex);
                          }
                        }}
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="muted">
                    No hay NRC guardados para ese filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {!current ? (
        <p className="muted">Sin registros de muestreo para este filtro.</p>
      ) : (
        <>
          <div className="review-header">
            <div>
              <div className="kpi-label">NRC seleccionado</div>
              <div className="kpi-value-sm">{current.selectedCourse.nrc}</div>
            </div>
            <div>
              <div className="kpi-label">Docente</div>
              <div>{current.teacherName}</div>
            </div>
            <div>
              <div className="kpi-label">Programa</div>
              <div>{current.programCode}</div>
            </div>
            <div>
              <div className="kpi-label">Tipo aula (editable)</div>
              <div className="controls">
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
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    void persistCurrentTemplate(editableTemplate.toUpperCase());
                  }}
                  disabled={savingTemplate || editableTemplate.toUpperCase() === currentTemplate}
                >
                  {savingTemplate ? 'Guardando...' : 'Guardar tipo'}
                </button>
              </div>
            </div>
          </div>
          <div className="muted">
            {current.selectedCourse.subjectName ?? '-'} | Estado Moodle: {current.selectedCourse.moodleStatus ?? 'N/A'}
            {current.selectedCourse.moodleCourseUrl ? (
              <>
                {' '}
                | URL detectada: <span className="code">SI</span>{' '}
                <button
                  type="button"
                  style={{
                    marginLeft: 8,
                    border: 'none',
                    background: 'transparent',
                    color: '#1f5f99',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  onClick={() => openNrcInMoodle(current.selectedCourse.nrc, current.selectedCourse.moodleCourseUrl)}
                >
                  Abrir URL detectada
                </button>
              </>
            ) : (
              <>
                {' '}
                | URL detectada: <span className="code">NO</span>
              </>
            )}
          </div>

          <div className="score-board">
            <div>
              <div className="kpi-label">Calificacion en progreso</div>
              <div className="kpi-value-sm">{liveScore}/50</div>
            </div>
            <div>
              <div className="kpi-label">Calificacion guardada</div>
              <div className="kpi-value-sm">{savedScore !== null ? `${savedScore}/50` : 'Sin guardar'}</div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>{renderChecklist()}</div>

          <div className="controls" style={{ marginTop: 14 }}>
            <button
              onClick={() => {
                const previous = Math.max(0, index - 1);
                selectItemByIndex(previous);
                const previousItem = queue?.items[previous];
                if (previousItem) {
                  openNrcInMoodle(previousItem.selectedCourse.nrc, previousItem.selectedCourse.moodleCourseUrl);
                }
              }}
              disabled={index <= 0}
            >
              Anterior
            </button>
            <button
              onClick={() => {
                if (!queue?.items.length) return;
                const next = Math.min(queue.items.length - 1, index + 1);
                selectItemByIndex(next);
                const nextItem = queue.items[next];
                if (nextItem) {
                  openNrcInMoodle(nextItem.selectedCourse.nrc, nextItem.selectedCourse.moodleCourseUrl);
                }
              }}
              disabled={!queue?.items.length || index >= queue.items.length - 1}
            >
              Siguiente
            </button>
            <button onClick={() => saveCurrent(false)} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={() => saveCurrent(true)} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar y replicar al grupo'}
            </button>
            <button
              onClick={() => {
                openNrcInMoodle(current.selectedCourse.nrc, current.selectedCourse.moodleCourseUrl);
              }}
              type="button"
            >
              Abrir NRC en Moodle
            </button>
            <button
              className="btn-next-action"
              style={{
                background: '#1b9a59',
                borderColor: '#1b9a59',
                color: '#ffffff',
                fontWeight: 700,
                boxShadow: '0 0 0 2px rgba(27,154,89,0.35) inset',
              }}
              onClick={() => {
                const reservedTab = window.open('about:blank', '_blank');
                void saveCurrent(true, true, reservedTab);
              }}
              disabled={saving}
            >
              {saving ? 'Guardando...' : 'Guardar y abrir siguiente NRC (AUTO)'}
            </button>
          </div>

          {lastReplication ? (
            <div className="actions" style={{ marginTop: 8 }}>
              Ultima replicacion: <span className="code">{lastReplication.replicatedCourses}</span> NRC |
              Grupos coincidentes: <span className="code">{lastReplication.groupsMatched}</span>
            </div>
          ) : null}
        </>
      )}

      {message ? <div className="message">{message}</div> : null}
    </article>
  );
}
