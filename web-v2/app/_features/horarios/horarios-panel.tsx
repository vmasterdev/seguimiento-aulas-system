'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, PageHero, AlertBox, useConfirm, PaginationControls } from '../../_components/ui';
import type { PageSizeOption } from '../../_components/ui';
import { useFetch } from '../../_lib/use-fetch';

type Item = {
  id: string;
  nrc: string;
  periodCode: string | null;
  moment: string | null;
  programCode: string | null;
  programName: string | null;
  subjectName: string | null;
  teacherId: string | null;
  teacherName: string | null;
  teacherEmail: string | null;
  teacherEmail2: string | null;
  campus: string | null;
  edificio: string | null;
  salon: string | null;
  horaInicio: string | null;
  horaFin: string | null;
  dias: boolean[];
  diasLabels: string[];
  moodleUrl: string | null;
  modalityType: string | null;
  detectedTemplate: string | null;
};

const TABS = ['estudiante', 'docente', 'coordinacion', 'academica', 'salones'] as const;
type Tab = typeof TABS[number];

const DIA_KEYS = ['L', 'M', 'I', 'J', 'V', 'S', 'D'] as const;
const DIA_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

function getCurrentDayIndex(): number {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function currentHHMM(): string {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
}

function fmtHHMM(value: string | null | undefined): string {
  if (!value) return '—';
  const v = String(value).padStart(4, '0');
  return v.slice(0, 2) + ':' + v.slice(2, 4);
}

function classroomStatus(item: Item, nowHHMM: string): 'PROXIMO' | 'EN_CURSO' | 'TERMINADO' | 'SIN_HORA' {
  if (!item.horaInicio || !item.horaFin) return 'SIN_HORA';
  if (nowHHMM < item.horaInicio) return 'PROXIMO';
  if (nowHHMM <= item.horaFin) return 'EN_CURSO';
  return 'TERMINADO';
}

export function HorariosPanel({ apiBase }: { apiBase: string }) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('docente');
  const [filters, setFilters] = useState({
    periodCode: '202615',
    moment: '',
    teacherId: '',
    teacherEmail: '',
    programCode: '',
    campus: '',
    nrc: '',
  });
  const [scheduleUrl, setScheduleUrl] = useState<string>(() => {
    const params = new URLSearchParams();
    params.set('periodCode', '202615');
    return `${apiBase}/schedule?${params}`;
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(100);
  const [salonFilters, setSalonFilters] = useState({
    template: 'D4',
    dayIndex: getCurrentDayIndex(),
    onlyFromNow: true,
    hideVirtual: false,
  });
  const [nowHHMM, setNowHHMM] = useState<string>(currentHHMM());

  const { data: scheduleData, loading, refresh: refreshSchedule } = useFetch<{ items: Item[] }>(scheduleUrl);
  const items = scheduleData?.items ?? [];

  useEffect(() => {
    if (tab !== 'salones') return;
    const id = setInterval(() => setNowHHMM(currentHHMM()), 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [emailMessage, setEmailMessage] = useState('');
  const [sending, setSending] = useState(false);

  function load() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    const url = `${apiBase}/schedule?${params}`;
    setPage(1);
    if (url === scheduleUrl) {
      void refreshSchedule();
    } else {
      setScheduleUrl(url);
    }
  }

  // Auto-filtrar por tab
  const filtered = useMemo(() => {
    if (tab === 'estudiante') {
      // Estudiante: solo si hay NRC o programa
      if (!filters.nrc && !filters.programCode) return [];
      return items;
    }
    if (tab === 'docente') {
      if (!filters.teacherId && !filters.teacherEmail) return items;
      return items;
    }
    return items;
  }, [items, tab, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const displayItems = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  // Agrupaciones por tab
  const byTeacher = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of displayItems) {
      const key = i.teacherId ?? '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return map;
  }, [displayItems]);

  const byProgram = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of displayItems) {
      const key = i.programCode ?? '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return map;
  }, [displayItems]);

  const byCenter = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of displayItems) {
      const key = i.campus ?? '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return map;
  }, [displayItems]);

  const salonItems = useMemo(() => {
    if (tab !== 'salones') return [] as Item[];
    return items.filter((i) => {
      if (salonFilters.template && salonFilters.template !== 'TODOS' && i.detectedTemplate !== salonFilters.template) return false;
      if (filters.campus && i.campus !== filters.campus) return false;
      if (!i.dias?.[salonFilters.dayIndex]) return false;
      if (salonFilters.onlyFromNow && i.horaFin && i.horaFin < nowHHMM) return false;
      if (salonFilters.hideVirtual && (i.edificio === 'VIRTU' || !i.salon)) return false;
      return true;
    });
  }, [items, tab, filters.campus, salonFilters, nowHHMM]);

  const salonStats = useMemo(() => {
    const total = salonItems.length;
    let enCurso = 0;
    let proximo = 0;
    let terminado = 0;
    let virtual = 0;
    for (const i of salonItems) {
      if (i.edificio === 'VIRTU' || !i.salon) virtual += 1;
      const st = classroomStatus(i, nowHHMM);
      if (st === 'EN_CURSO') enCurso += 1;
      else if (st === 'PROXIMO') proximo += 1;
      else if (st === 'TERMINADO') terminado += 1;
    }
    return { total, enCurso, proximo, terminado, virtual, presenciales: total - virtual };
  }, [salonItems, nowHHMM]);

  const groupedBySalon = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of salonItems) {
      const key = i.edificio === 'VIRTU' || !i.salon
        ? '💻 VIRTUAL'
        : `${i.edificio ?? ''} ${i.salon}`.trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.horaInicio ?? '').localeCompare(b.horaInicio ?? ''));
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '💻 VIRTUAL') return 1;
      if (b === '💻 VIRTUAL') return -1;
      return a.localeCompare(b);
    });
  }, [salonItems]);

  function exportSalonesCsv() {
    const header = ['NRC','Edificio','Salon','Inicia','Termina','Asignatura','Docente','Programa','Estado'];
    const rows = salonItems.map((i) => {
      const st = classroomStatus(i, nowHHMM);
      return [
        i.nrc,
        i.edificio ?? '',
        i.salon ?? '',
        fmtHHMM(i.horaInicio),
        fmtHHMM(i.horaFin),
        i.subjectName ?? '',
        i.teacherName ?? '',
        i.programCode ?? '',
        st,
      ].map((v) => `"${String(v).replace(/"/g,'""')}"`).join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salones-${salonFilters.template}-${filters.campus || 'TODOS'}-${DIA_KEYS[salonFilters.dayIndex]}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printSalones() {
    const w = window.open('', '_blank');
    if (!w) return;
    const rowsHtml = groupedBySalon.map(([salon, list]) => {
      const itemsHtml = list.map((i) => {
        const st = classroomStatus(i, nowHHMM);
        const stColor = st === 'EN_CURSO' ? '#16a34a' : st === 'PROXIMO' ? '#2563eb' : st === 'TERMINADO' ? '#9ca3af' : '#6b7280';
        return `<tr><td style="padding:4px 8px;font-family:monospace;">${i.nrc}</td><td style="padding:4px 8px;">${fmtHHMM(i.horaInicio)} - ${fmtHHMM(i.horaFin)}</td><td style="padding:4px 8px;">${i.subjectName ?? ''}</td><td style="padding:4px 8px;font-size:11px;color:#6b7280;">${i.teacherName ?? ''}</td><td style="padding:4px 8px;color:${stColor};font-weight:700;font-size:11px;">${st}</td></tr>`;
      }).join('');
      return `<div style="margin-bottom:16px;page-break-inside:avoid;"><h3 style="margin:0;background:#0f172a;color:#fff;padding:6px 10px;font-size:13px;">${salon} <span style="float:right;font-weight:400;font-size:11px;">${list.length} NRC</span></h3><table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #e5e7eb;">${itemsHtml}</table></div>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recorrido Salones ${salonFilters.template}</title><style>body{font-family:Segoe UI,Arial;color:#0f172a;padding:20px;}h1{font-size:18px;margin:0 0 4px;}h2{font-size:13px;margin:0 0 16px;color:#64748b;font-weight:400;}@media print{h3{break-inside:avoid;}}</style></head><body><h1>Recorrido Salones ${salonFilters.template} - ${filters.campus || 'TODAS LAS SEDES'}</h1><h2>${DIA_LABELS[salonFilters.dayIndex]} - Generado ${new Date().toLocaleString('es-CO')} - ${salonItems.length} NRC</h2>${rowsHtml}</body></html>`;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  async function sendEmailToTeacher(teacherId: string, audience: 'SEMESTRE' | 'PRE_MOMENTO') {
    if (!filters.periodCode) { setEmailMessage('Periodo requerido.'); return; }
    if (!await confirm({ title: 'Enviar correo a docente', message: `Enviar correo (${audience}) al docente para ${filters.periodCode}${filters.moment ? `/${filters.moment}` : ''}.`, confirmLabel: 'Enviar', tone: 'primary' })) return;
    setSending(true);
    try {
      const r = await fetch(`${apiBase}/teacher-schedule-email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodCode: filters.periodCode,
          moment: filters.moment || undefined,
          teacherId,
          audience,
        }),
      });
      const j = await r.json();
      setEmailMessage(r.ok ? `✓ Encolado: ${j.queued} correo(s)` : `Error: ${j.error}`);
    } finally { setSending(false); }
  }

  async function sendEmailToAll(audience: 'SEMESTRE' | 'PRE_MOMENTO') {
    if (!filters.periodCode) { setEmailMessage('Periodo requerido.'); return; }
    if (!await confirm({ title: 'Envío masivo de correos', message: `Se enviarán correos a TODOS los docentes del periodo ${filters.periodCode}${filters.moment ? `/${filters.moment}` : ''}. Esto encolará correos masivos.`, confirmLabel: 'Enviar a todos', tone: 'danger' })) return;
    setSending(true);
    try {
      const r = await fetch(`${apiBase}/teacher-schedule-email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodCode: filters.periodCode,
          moment: filters.moment || undefined,
          audience,
        }),
      });
      const j = await r.json();
      setEmailMessage(r.ok ? `✓ Encolado: ${j.queued} correo(s) a ${j.totalTeachers} docentes` : `Error: ${j.error}`);
    } finally { setSending(false); }
  }

  async function previewTeacher(teacherId: string) {
    if (!filters.periodCode) return;
    const r = await fetch(`${apiBase}/teacher-schedule-email/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodCode: filters.periodCode, moment: filters.moment || undefined, teacherId, audience: 'SEMESTRE' }),
    });
    const j = await r.json();
    if (j.html) {
      const w = window.open('', '_blank');
      if (w) { w.document.write(j.html); w.document.close(); }
    }
  }

  return (
    <article className="premium-card">
      <PageHero
        title="Horarios"
        description="Consulta de horarios por docente, coordinación, centro académico, estudiante o salón."
      />

      <div className="panel-body">
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {TABS.map((t) => (
          <Button key={t} variant={tab === t ? 'primary' : 'ghost'} size="sm" onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>{t}</Button>
        ))}
      </div>

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label>Periodo<input value={filters.periodCode} onChange={(e) => setFilters((p) => ({ ...p, periodCode: e.target.value }))} /></label>
        <label>Momento<input value={filters.moment} onChange={(e) => setFilters((p) => ({ ...p, moment: e.target.value }))} placeholder="MD1, MD2, 1" /></label>
        {tab === 'estudiante' && (
          <>
            <label>NRC<input value={filters.nrc} onChange={(e) => setFilters((p) => ({ ...p, nrc: e.target.value }))} /></label>
            <label>Programa<input value={filters.programCode} onChange={(e) => setFilters((p) => ({ ...p, programCode: e.target.value }))} /></label>
          </>
        )}
        {tab === 'docente' && (
          <>
            <label>Docente ID<input value={filters.teacherId} onChange={(e) => setFilters((p) => ({ ...p, teacherId: e.target.value }))} /></label>
            <label>Docente email<input value={filters.teacherEmail} onChange={(e) => setFilters((p) => ({ ...p, teacherEmail: e.target.value }))} /></label>
          </>
        )}
        {tab === 'coordinacion' && (
          <label>Programa<input value={filters.programCode} onChange={(e) => setFilters((p) => ({ ...p, programCode: e.target.value }))} /></label>
        )}
        {tab === 'academica' && (
          <label>Centro<input value={filters.campus} onChange={(e) => setFilters((p) => ({ ...p, campus: e.target.value }))} placeholder="IBA, NVA..." /></label>
        )}
        {tab === 'salones' && (
          <>
            <label>Sede (CU)<input value={filters.campus} onChange={(e) => setFilters((p) => ({ ...p, campus: e.target.value.toUpperCase() }))} placeholder="IBA, NVA, GAR..." /></label>
            <label>Plantilla
              <select value={salonFilters.template} onChange={(e) => setSalonFilters((p) => ({ ...p, template: e.target.value }))}>
                <option value="TODOS">Todas</option>
                <option value="D4">Distancia 4.0 (D4)</option>
                <option value="CRIBA">CRIBA</option>
                <option value="INNOVAME">INNOVAME</option>
                <option value="VACIO">VACIO</option>
                <option value="UNKNOWN">UNKNOWN</option>
              </select>
            </label>
            <label>Día
              <select value={salonFilters.dayIndex} onChange={(e) => setSalonFilters((p) => ({ ...p, dayIndex: Number(e.target.value) }))}>
                {DIA_LABELS.map((d, i) => <option key={d} value={i}>{d}{i === getCurrentDayIndex() ? ' (hoy)' : ''}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={salonFilters.onlyFromNow} onChange={(e) => setSalonFilters((p) => ({ ...p, onlyFromNow: e.target.checked }))} />
              Solo desde ahora ({fmtHHMM(nowHHMM)})
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={salonFilters.hideVirtual} onChange={(e) => setSalonFilters((p) => ({ ...p, hideVirtual: e.target.checked }))} />
              Ocultar virtuales
            </label>
          </>
        )}
        <div className="toolbar wide">
          <Button variant="primary" size="sm" onClick={() => void load()} disabled={loading} loading={loading}>Buscar</Button>
          {tab === 'docente' && (
            <>
              <Button variant="secondary" size="sm" onClick={() => void sendEmailToAll('SEMESTRE')} disabled={sending} loading={sending}>Enviar inicio semestre (todos)</Button>
              <Button variant="secondary" size="sm" onClick={() => void sendEmailToAll('PRE_MOMENTO')} disabled={sending} loading={sending}>Enviar pre-momento (todos)</Button>
            </>
          )}
        </div>
      </div>

      {emailMessage && <AlertBox tone="info" style={{ marginBottom: 8 }}>{emailMessage}</AlertBox>}
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Mostrando {displayItems.length} de {filtered.length} NRC.</div>

      {tab === 'docente' && (
        <>
          {[...byTeacher.entries()].map(([tid, list]) => {
            const t = list[0];
            return (
              <div key={tid} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <strong>{t.teacherName ?? 'Sin docente'}</strong>{' '}
                    <span className="muted" style={{ fontSize: 11 }}>{t.teacherEmail ?? ''}{t.teacherEmail2 ? ` · ${t.teacherEmail2}` : ''}</span>
                    <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>centro={t.campus ?? '—'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Button variant="ghost" size="sm" onClick={() => void previewTeacher(tid)}>Preview email</Button>
                    <Button variant="secondary" size="sm" onClick={() => void sendEmailToTeacher(tid, 'SEMESTRE')} disabled={sending} loading={sending}>Enviar semestre</Button>
                    <Button variant="secondary" size="sm" onClick={() => void sendEmailToTeacher(tid, 'PRE_MOMENTO')} disabled={sending} loading={sending}>Enviar pre-momento</Button>
                  </div>
                </div>
                <ScheduleTable items={list} />
              </div>
            );
          })}
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            label="NRC"
          />
        </>
      )}

      {tab === 'coordinacion' && (
        <>
          {[...byProgram.entries()].map(([prog, list]) => (
            <div key={prog} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <strong>Programa {prog}</strong> <span className="muted" style={{ fontSize: 11 }}>({list.length} NRC, {new Set(list.map((i) => i.teacherId)).size} docentes)</span>
              <ScheduleTable items={list} showTeacher />
            </div>
          ))}
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            label="NRC"
          />
        </>
      )}

      {tab === 'academica' && (
        <>
          {[...byCenter.entries()].map(([centro, list]) => (
            <div key={centro} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <strong>Centro {centro}</strong> <span className="muted" style={{ fontSize: 11 }}>({list.length} NRC, {new Set(list.map((i) => i.teacherId)).size} docentes)</span>
              <ScheduleTable items={list} showTeacher />
            </div>
          ))}
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            label="NRC"
          />
        </>
      )}

      {tab === 'estudiante' && (
        filtered.length === 0
          ? <p className="muted">Ingresa NRC o programa para buscar.</p>
          : <>
              <ScheduleTable items={displayItems} showTeacher />
              <PaginationControls
                currentPage={page}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={pageSize}
                onPageChange={(p) => setPage(p)}
                onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
                label="NRC"
              />
            </>
      )}

      {tab === 'salones' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
            <div style={{ padding: 10, background: '#f8fafc', borderRadius: 6, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Total NRC</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{salonStats.total}</div>
            </div>
            <div style={{ padding: 10, background: '#dcfce7', borderRadius: 6, border: '1px solid #86efac' }}>
              <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>En curso</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#166534' }}>{salonStats.enCurso}</div>
            </div>
            <div style={{ padding: 10, background: '#dbeafe', borderRadius: 6, border: '1px solid #93c5fd' }}>
              <div style={{ fontSize: 11, color: '#1e40af', fontWeight: 600 }}>Próximos</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1e40af' }}>{salonStats.proximo}</div>
            </div>
            <div style={{ padding: 10, background: '#f3f4f6', borderRadius: 6, border: '1px solid #d1d5db' }}>
              <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Terminados</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#6b7280' }}>{salonStats.terminado}</div>
            </div>
            <div style={{ padding: 10, background: '#fef3c7', borderRadius: 6, border: '1px solid #fcd34d' }}>
              <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600 }}>Presenciales</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#92400e' }}>{salonStats.presenciales}</div>
            </div>
            <div style={{ padding: 10, background: '#ede9fe', borderRadius: 6, border: '1px solid #c4b5fd' }}>
              <div style={{ fontSize: 11, color: '#5b21b6', fontWeight: 600 }}>Virtuales</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#5b21b6' }}>{salonStats.virtual}</div>
            </div>
          </div>

          <div className="toolbar" style={{ marginBottom: 12 }}>
            <button type="button" onClick={exportSalonesCsv} style={{ background: '#16a34a', color: '#fff' }}>Exportar CSV</button>
            <button type="button" onClick={printSalones} style={{ background: '#2563eb', color: '#fff' }}>Imprimir recorrido</button>
          </div>

          {groupedBySalon.length === 0 ? (
            <p className="muted">Sin NRC para el filtro actual. Ajusta sede / plantilla / día.</p>
          ) : (
            groupedBySalon.map(([salon, list]) => (
              <div key={salon} style={{ border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 12, overflow: 'hidden' }}>
                <div style={{ background: '#0f172a', color: '#fff', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{salon}</strong>
                  <span style={{ fontSize: 11 }}>{list.length} NRC</span>
                </div>
                <table className="table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>NRC</th>
                      <th>Inicia</th>
                      <th>Termina</th>
                      <th>Asignatura</th>
                      <th>Docente</th>
                      <th>Programa</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((i) => {
                      const st = classroomStatus(i, nowHHMM);
                      const stColor = st === 'EN_CURSO' ? '#16a34a' : st === 'PROXIMO' ? '#2563eb' : st === 'TERMINADO' ? '#9ca3af' : '#6b7280';
                      return (
                        <tr key={i.id}>
                          <td><strong>{i.nrc}</strong></td>
                          <td style={{ fontFamily: 'monospace' }}>{fmtHHMM(i.horaInicio)}</td>
                          <td style={{ fontFamily: 'monospace' }}>{fmtHHMM(i.horaFin)}</td>
                          <td>{i.subjectName ?? '—'}</td>
                          <td style={{ fontSize: 12 }}>{i.teacherName ?? '—'}</td>
                          <td>{i.programCode ?? '—'}</td>
                          <td style={{ color: stColor, fontWeight: 700, fontSize: 11 }}>{st}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      )}
      </div>{/* /panel-body */}
    </article>
  );
}

function ScheduleTable({ items, showTeacher }: { items: Item[]; showTeacher?: boolean }) {
  return (
    <table className="fast-table">
      <thead>
        <tr>
          <th>NRC</th>
          {showTeacher && <th>Docente</th>}
          <th>Asignatura</th>
          <th>Programa</th>
          <th>Momento</th>
          <th>Tipo</th>
          <th>Dias</th>
          <th>Horario</th>
          <th>Salon</th>
          <th>Moodle</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id}>
            <td><strong>{i.nrc}</strong></td>
            {showTeacher && <td>{i.teacherName ?? '—'}<br /><span style={{ fontSize: 11, color: '#6b7280' }}>{i.teacherEmail ?? ''}</span></td>}
            <td>{i.subjectName ?? '—'}</td>
            <td>{i.programCode ?? '—'}</td>
            <td>{i.moment ?? '—'}</td>
            <td>{i.detectedTemplate ?? '—'}</td>
            <td>{i.diasLabels.join(', ') || '—'}</td>
            <td>{i.horaInicio ?? '—'} — {i.horaFin ?? '—'}</td>
            <td>{i.edificio ?? ''} {i.salon ?? ''}</td>
            <td>{i.moodleUrl ? <a href={i.moodleUrl} target="_blank" rel="noreferrer">abrir</a> : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
