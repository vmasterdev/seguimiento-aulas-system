'use client';

import { useEffect, useMemo, useState } from 'react';

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

const TABS = ['estudiante', 'docente', 'coordinacion', 'academica'] as const;
type Tab = typeof TABS[number];

export function HorariosPanel({ apiBase }: { apiBase: string }) {
  const [tab, setTab] = useState<Tab>('docente');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    periodCode: '202615',
    moment: '',
    teacherId: '',
    teacherEmail: '',
    programCode: '',
    campus: '',
    nrc: '',
  });
  const [emailMessage, setEmailMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    try {
      const r = await fetch(`${apiBase}/schedule?${params}`);
      const j = await r.json();
      setItems(j.items ?? []);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

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

  // Agrupaciones por tab
  const byTeacher = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of filtered) {
      const key = i.teacherId ?? '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return map;
  }, [filtered]);

  const byProgram = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of filtered) {
      const key = i.programCode ?? '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return map;
  }, [filtered]);

  const byCenter = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of filtered) {
      const key = i.campus ?? '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(i);
    }
    return map;
  }, [filtered]);

  async function sendEmailToTeacher(teacherId: string, audience: 'SEMESTRE' | 'PRE_MOMENTO') {
    if (!filters.periodCode) { setEmailMessage('Periodo requerido.'); return; }
    if (!window.confirm(`Enviar correo (${audience}) al docente para ${filters.periodCode}${filters.moment ? `/${filters.moment}` : ''}?`)) return;
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
    if (!window.confirm(`Enviar a TODOS los docentes del periodo ${filters.periodCode}${filters.moment ? `/${filters.moment}` : ''}? Esto encolara correos masivos.`)) return;
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
    <div className="panel">
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={tab === t ? 'primary' : ''} style={{ textTransform: 'capitalize' }}>{t}</button>
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
        <div className="toolbar wide">
          <button type="button" className="primary" onClick={() => void load()} disabled={loading}>{loading ? 'Cargando...' : 'Buscar'}</button>
          {tab === 'docente' && (
            <>
              <button type="button" onClick={() => void sendEmailToAll('SEMESTRE')} disabled={sending} style={{ background: '#16a34a', color: '#fff' }}>Enviar inicio semestre (todos)</button>
              <button type="button" onClick={() => void sendEmailToAll('PRE_MOMENTO')} disabled={sending} style={{ background: '#d97706', color: '#fff' }}>Enviar pre-momento (todos)</button>
            </>
          )}
        </div>
      </div>

      {emailMessage && <div className="message" style={{ marginBottom: 8 }}>{emailMessage}</div>}
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Mostrando {filtered.length} NRC.</div>

      {tab === 'docente' && [...byTeacher.entries()].map(([tid, list]) => {
        const t = list[0];
        return (
          <div key={tid} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div>
                <strong>{t.teacherName ?? 'Sin docente'}</strong>{' '}
                <span className="muted" style={{ fontSize: 11 }}>{t.teacherEmail ?? ''}{t.teacherEmail2 ? ` · ${t.teacherEmail2}` : ''}</span>
                <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>centro={t.campus ?? '—'}</span>
              </div>
              <div>
                <button type="button" onClick={() => void previewTeacher(tid)}>Preview email</button>{' '}
                <button type="button" onClick={() => void sendEmailToTeacher(tid, 'SEMESTRE')} disabled={sending} style={{ background: '#16a34a', color: '#fff' }}>Enviar semestre</button>{' '}
                <button type="button" onClick={() => void sendEmailToTeacher(tid, 'PRE_MOMENTO')} disabled={sending} style={{ background: '#d97706', color: '#fff' }}>Enviar pre-momento</button>
              </div>
            </div>
            <ScheduleTable items={list} />
          </div>
        );
      })}

      {tab === 'coordinacion' && [...byProgram.entries()].map(([prog, list]) => (
        <div key={prog} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 12 }}>
          <strong>Programa {prog}</strong> <span className="muted" style={{ fontSize: 11 }}>({list.length} NRC, {new Set(list.map((i) => i.teacherId)).size} docentes)</span>
          <ScheduleTable items={list} showTeacher />
        </div>
      ))}

      {tab === 'academica' && [...byCenter.entries()].map(([centro, list]) => (
        <div key={centro} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 12 }}>
          <strong>Centro {centro}</strong> <span className="muted" style={{ fontSize: 11 }}>({list.length} NRC, {new Set(list.map((i) => i.teacherId)).size} docentes)</span>
          <ScheduleTable items={list} showTeacher />
        </div>
      ))}

      {tab === 'estudiante' && (
        filtered.length === 0
          ? <p className="muted">Ingresa NRC o programa para buscar.</p>
          : <ScheduleTable items={filtered} showTeacher />
      )}
    </div>
  );
}

function ScheduleTable({ items, showTeacher }: { items: Item[]; showTeacher?: boolean }) {
  return (
    <table className="table">
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
