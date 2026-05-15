'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildCourseScheduleInfo } from '@seguimiento/shared';
import { Button, AlertBox, PaginationControls } from '../../_components/ui';
import type { PageSizeOption } from '../../_components/ui';
import { useFetch } from '../../_lib/use-fetch';

type CalendarFilter = 'ALL' | 'ACTIVE' | 'SHORT' | 'URGENTE';

type NrcItem = {
  id: string;
  nrc: string;
  subjectName: string | null;
  bannerStartDate: string | null;
  bannerEndDate: string | null;
  enrolledCount: number | null;
  moodleCourseUrl: string | null;
};

type ReviewItem = {
  sampleGroupId: string;
  teacherName: string;
  periodCode: string;
  programCode: string;
  modality: string;
  moment: string;
  template: string;
  selectedCourse: NrcItem;
  done: boolean;
};

type ReviewQueueResponse = {
  ok: boolean;
  periodCode: string;
  phase: string;
  moment: string | null;
  total: number;
  done: number;
  pending: number;
  items: ReviewItem[];
};

type CalendarStats = {
  active: number;
  short: number;
  urgente: number;
  upcoming: number;
  unknown: number;
};

function getCalendarStats(items: ReviewItem[]): CalendarStats {
  const today = new Date();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let active = 0, short = 0, urgente = 0, upcoming = 0, unknown = 0;
  for (const item of items) {
    const info = buildCourseScheduleInfo({
      startDate: item.selectedCourse.bannerStartDate,
      endDate: item.selectedCourse.bannerEndDate,
    });
    if (info.calendarState === 'UNKNOWN') { unknown++; continue; }
    if (info.calendarState === 'UPCOMING') { upcoming++; continue; }
    if (info.calendarState === 'ACTIVE') {
      active++;
      if (info.isShortCourse) short++;
      if (info.endIsoDate) {
        const endMs = new Date(info.endIsoDate + 'T00:00:00Z').getTime();
        if (Math.ceil((endMs - todayMs) / 86400000) <= 7) urgente++;
      }
    }
    if (info.calendarState === 'ENDED') {
      if (info.isShortCourse) short++;
    }
  }
  return { active, short, urgente, upcoming, unknown };
}

function applyFilterSort(items: ReviewItem[], filter: CalendarFilter, sortPriority: boolean): ReviewItem[] {
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
      const score = (item: ReviewItem): number => {
        const info = buildCourseScheduleInfo({
          startDate: item.selectedCourse.bannerStartDate,
          endDate: item.selectedCourse.bannerEndDate,
        });
        const donePenalty = item.done ? 10000 : 0;
        if (info.calendarState !== 'ACTIVE') return donePenalty + 5000;
        if (!info.endIsoDate) return donePenalty + 4000;
        const endMs = new Date(info.endIsoDate + 'T00:00:00Z').getTime();
        return donePenalty + Math.max(0, Math.ceil((endMs - todayMs) / 86400000));
      };
      return score(a) - score(b);
    });
  }

  return result;
}

function NrcBadge({ item }: { item: ReviewItem }) {
  const today = new Date();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const info = buildCourseScheduleInfo({
    startDate: item.selectedCourse.bannerStartDate,
    endDate: item.selectedCourse.bannerEndDate,
  });

  if (info.calendarState === 'UNKNOWN') {
    return <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#ddd', color: '#555' }}>SIN FECHAS</span>;
  }
  if (info.calendarState === 'UPCOMING') {
    return <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#e8f4fd', color: '#1f5f99', border: '1px solid #b0d0f0' }}>POR INICIAR</span>;
  }
  if (info.calendarState === 'ENDED') {
    return <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#f0f0f0', color: '#888' }}>FINALIZADO</span>;
  }

  if (info.calendarState === 'ACTIVE') {
    let daysLeft: number | null = null;
    if (info.endIsoDate) {
      const endMs = new Date(info.endIsoDate + 'T00:00:00Z').getTime();
      daysLeft = Math.ceil((endMs - todayMs) / 86400000);
    }

    if (daysLeft !== null && daysLeft <= 7) {
      return (
        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#fdecea', color: '#c0392b', border: '1px solid #f0b0aa', fontWeight: 700 }}>
          URGENTE · {daysLeft}d
        </span>
      );
    }
    if (info.isShortCourse) {
      return (
        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#fff4e5', color: '#b36200', border: '1px solid #f0cc80' }}>
          CORTO · {daysLeft !== null ? `${daysLeft}d` : 'ACTIVO'}
        </span>
      );
    }
    return (
      <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#edf7ee', color: '#1b7a3e', border: '1px solid #90d0a0' }}>
        ACTIVO · {daysLeft !== null ? `${daysLeft}d` : ''}
      </span>
    );
  }

  return null;
}

export function NrcPrioridadPanel({ apiBase }: { apiBase: string }) {
  const [periodCode, setPeriodCode] = useState('202615');
  const [moment, setMoment] = useState('MD1');
  const [phase, setPhase] = useState<'ALISTAMIENTO' | 'EJECUCION'>('EJECUCION');
  const [fetchUrl, setFetchUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState<CalendarFilter>('ALL');
  const [sortPriority, setSortPriority] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(100);

  const { data: queue, error, loading, refresh } = useFetch<ReviewQueueResponse>(fetchUrl);

  function loadQueue() {
    const url = `${apiBase}/review/queue?periodCode=${encodeURIComponent(periodCode)}&moment=${encodeURIComponent(moment)}&phase=${phase}&category=MUESTREO`;
    if (url === fetchUrl) {
      void refresh();
    } else {
      setFetchUrl(url);
    }
  }

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => getCalendarStats(queue?.items ?? []), [queue]);
  const items = useMemo(() => applyFilterSort(queue?.items ?? [], filter, sortPriority), [queue, filter, sortPriority]);

  useEffect(() => { setPage(1); }, [items]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const displayItems = items.slice((page - 1) * pageSize, page * pageSize);

  const FILTER_CONFIG: { value: CalendarFilter; label: string; count: number; color: string }[] = [
    { value: 'ALL', label: 'Todos', count: queue?.items.length ?? 0, color: '#1f5f99' },
    { value: 'ACTIVE', label: 'Activos hoy', count: stats.active, color: '#1b7a3e' },
    { value: 'SHORT', label: 'Cortos ≤28d', count: stats.short, color: '#b36200' },
    { value: 'URGENTE', label: 'Urgentes ≤7d', count: stats.urgente, color: '#c0392b' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controles de carga */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>Periodo</label>
          <input
            value={periodCode}
            onChange={(e) => setPeriodCode(e.target.value)}
            style={{ fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, width: 90 }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>Momento</label>
          <select
            value={moment}
            onChange={(e) => setMoment(e.target.value)}
            style={{ fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
          >
            <option value="MD1">MD1</option>
            <option value="MD2">MD2</option>
            <option value="1">Semestral</option>
            <option value="INTER">Intersemestral</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>Fase</label>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value as 'ALISTAMIENTO' | 'EJECUCION')}
            style={{ fontSize: 13, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4 }}
          >
            <option value="ALISTAMIENTO">Alistamiento</option>
            <option value="EJECUCION">Ejecucion</option>
          </select>
        </div>
        <Button variant="primary" size="sm" loading={loading} onClick={() => void loadQueue()}>
          {loading ? 'Cargando...' : 'Cargar cola'}
        </Button>
      </div>

      {error && <AlertBox tone="error">Error: {error}</AlertBox>}

      {queue && (
        <>
          {/* Resumen */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#555' }}>
              <strong>{queue.total}</strong> NRC totales · <strong>{queue.done}</strong> revisados · <strong>{queue.pending}</strong> pendientes
            </div>
          </div>

          {/* Filtros */}
          <div style={{ border: '1px solid #d0d7e3', borderRadius: 6, padding: '12px 14px', background: '#f8fafc' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Vista calendario
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {FILTER_CONFIG.map(({ value, label, count, color }) => {
                const active = filter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    style={{
                      fontSize: 12,
                      padding: '4px 12px',
                      borderRadius: 4,
                      border: `1px solid ${active ? 'transparent' : '#c8d0dc'}`,
                      background: active ? color : '#fff',
                      color: active ? '#fff' : '#333',
                      fontWeight: active ? 700 : 400,
                      cursor: 'pointer',
                    }}
                    onClick={() => setFilter(value)}
                  >
                    {label}{count > 0 ? ` · ${count}` : ''}
                  </button>
                );
              })}
              <button
                type="button"
                style={{
                  fontSize: 12,
                  padding: '4px 12px',
                  borderRadius: 4,
                  border: `1px solid ${sortPriority ? 'transparent' : '#c8d0dc'}`,
                  background: sortPriority ? '#5b2d8e' : '#fff',
                  color: sortPriority ? '#fff' : '#333',
                  fontWeight: sortPriority ? 700 : 400,
                  cursor: 'pointer',
                  marginLeft: 4,
                }}
                onClick={() => setSortPriority((p) => !p)}
              >
                {sortPriority ? '↑ Prioridad activa' : '↑ Ordenar por prioridad'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#666' }}>
              Mostrando {items.length} de {queue.items.length} NRC
              {stats.upcoming > 0 && <span style={{ marginLeft: 8 }}>· Por iniciar: {stats.upcoming}</span>}
              {stats.unknown > 0 && <span style={{ marginLeft: 8 }}>· Sin fechas: {stats.unknown}</span>}
            </div>
          </div>

          {/* Lista de NRC */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {displayItems.map((item, idx) => {
              const course = item.selectedCourse;
              const globalIdx = (page - 1) * pageSize + idx;
              return (
                <div
                  key={course.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    border: '1px solid #e0e6ef',
                    borderRadius: 5,
                    background: item.done ? '#f5f5f5' : '#fff',
                    opacity: item.done ? 0.7 : 1,
                  }}
                >
                  <span style={{ fontSize: 12, color: '#aaa', minWidth: 24, textAlign: 'right' }}>{globalIdx + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>{course.nrc}</span>
                      <NrcBadge item={item} />
                      {item.done && (
                        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#e8f4fd', color: '#1f5f99' }}>REVISADO</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.teacherName} · {course.subjectName ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                      {course.bannerStartDate ?? '?'} → {course.bannerEndDate ?? '?'}
                      {course.enrolledCount != null && <span style={{ marginLeft: 8 }}>{course.enrolledCount} inscritos</span>}
                    </div>
                  </div>
                  {course.moodleCourseUrl && (
                    <a
                      href={course.moodleCourseUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 11, color: '#1f5f99', textDecoration: 'none', whiteSpace: 'nowrap' }}
                    >
                      Moodle →
                    </a>
                  )}
                </div>
              );
            })}
            {items.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
                No hay NRC que coincidan con el filtro seleccionado.
              </div>
            )}
          </div>
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            totalItems={items.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            label="NRC"
          />
        </>
      )}
    </div>
  );
}
