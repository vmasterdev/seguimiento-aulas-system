'use client';

import { useEffect, useState } from 'react';
import { Button, PageHero, AlertBox, useConfirm } from '../../_components/ui';

type Item = {
  id: string;
  template: string;
  subjectName: string;
  subjectKey: string;
  alphanumericCode: string | null;
  backupUrl: string | null;
  notes: string | null;
};

const EMPTY = { id: '', template: 'D4', subjectName: '', alphanumericCode: '', backupUrl: '', notes: '' };

export function StandardClassroomsPanel({ apiBase }: { apiBase: string }) {
  const confirm = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState({ template: '', q: '' });
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.template) params.set('template', filter.template);
    if (filter.q) params.set('q', filter.q);
    try {
      const r = await fetch(`${apiBase}/standard-classrooms?${params}`);
      const j = await r.json();
      setItems(j.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subjectName.trim()) { setMessage('Asignatura requerida.'); return; }
    setSaving(true);
    try {
      const r = await fetch(`${apiBase}/standard-classrooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setMessage(`Error: ${j.error ?? 'desconocido'}`); return; }
      setMessage('✓ Guardado.');
      setForm(EMPTY);
      await load();
    } finally { setSaving(false); }
  }

  async function remove(it: Item) {
    if (!await confirm({ title: 'Eliminar aula estándar', message: `¿Eliminar aula ${it.template} — ${it.subjectName}?`, confirmLabel: 'Eliminar', tone: 'danger' })) return;
    await fetch(`${apiBase}/standard-classrooms/${it.id}`, { method: 'DELETE' });
    await load();
  }

  function edit(it: Item) {
    setForm({
      id: it.id,
      template: it.template,
      subjectName: it.subjectName,
      alphanumericCode: it.alphanumericCode ?? '',
      backupUrl: it.backupUrl ?? '',
      notes: it.notes ?? '',
    });
  }

  return (
    <article className="premium-card">
      <PageHero
        title="Repositorio de aulas estándar"
        description="Códigos alfanuméricos D4/INNOVAME y URLs de copia de seguridad CRIBA por asignatura. Se incluyen automáticamente en correos a docentes."
      />

      <div className="panel-body">
      {message && <AlertBox tone="info">{message}</AlertBox>}

      <form onSubmit={save} className="form-grid" style={{ marginBottom: 16 }}>
        <label>
          Tipo plantilla
          <select value={form.template} onChange={(e) => setForm((p) => ({ ...p, template: e.target.value }))}>
            <option value="D4">D4 (Distancia 4.0)</option>
            <option value="INNOVAME">INNOVAME</option>
            <option value="CRIBA">CRIBA</option>
          </select>
        </label>
        <label className="wide">
          Asignatura
          <input value={form.subjectName} onChange={(e) => setForm((p) => ({ ...p, subjectName: e.target.value }))} required />
        </label>
        {(form.template === 'D4' || form.template === 'INNOVAME') && (
          <label className="wide">
            Codigo alfanumerico
            <input value={form.alphanumericCode} onChange={(e) => setForm((p) => ({ ...p, alphanumericCode: e.target.value }))} />
          </label>
        )}
        {form.template === 'CRIBA' && (
          <label className="wide">
            URL copia de seguridad
            <input value={form.backupUrl} onChange={(e) => setForm((p) => ({ ...p, backupUrl: e.target.value }))} placeholder="https://..." />
          </label>
        )}
        <label className="wide">
          Notas
          <input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
        </label>
        <div className="toolbar wide">
          <Button variant="primary" size="sm" type="submit" disabled={saving} loading={saving}>
            {form.id ? 'Actualizar' : 'Agregar'}
          </Button>
          {form.id && <Button variant="ghost" size="sm" type="button" onClick={() => setForm(EMPTY)}>Cancelar edición</Button>}
        </div>
      </form>

      <div className="controls" style={{ marginBottom: 8 }}>
        <select value={filter.template} onChange={(e) => setFilter((p) => ({ ...p, template: e.target.value }))}>
          <option value="">Todas</option>
          <option value="D4">D4</option>
          <option value="INNOVAME">INNOVAME</option>
          <option value="CRIBA">CRIBA</option>
        </select>
        <input placeholder="Buscar..." value={filter.q} onChange={(e) => setFilter((p) => ({ ...p, q: e.target.value }))} />
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} loading={loading}>Filtrar</Button>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{items.length} aulas</span>
      </div>

      <table className="fast-table">
        <thead><tr><th>Tipo</th><th>Asignatura</th><th>Alfanumerico</th><th>Backup URL</th><th>Notas</th><th>Acciones</th></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td><strong>{it.template}</strong></td>
              <td>{it.subjectName}</td>
              <td>{it.alphanumericCode ?? '—'}</td>
              <td>{it.backupUrl ? <a href={it.backupUrl} target="_blank" rel="noreferrer">link</a> : '—'}</td>
              <td>{it.notes ?? '—'}</td>
              <td style={{ display: 'flex', gap: 4 }}>
                <Button variant="ghost" size="sm" onClick={() => edit(it)}>Editar</Button>
                <Button variant="danger" size="sm" onClick={() => void remove(it)}>Eliminar</Button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (<tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>Sin aulas registradas</td></tr>)}
        </tbody>
      </table>
      </div>{/* /panel-body */}
    </article>
  );
}
