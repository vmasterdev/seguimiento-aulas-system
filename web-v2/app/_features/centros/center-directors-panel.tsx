'use client';

import { useState } from 'react';
import { Button, PageHero, AlertBox, useConfirm, PaginationControls } from '../../_components/ui';
import { useFetch } from '../../_lib/use-fetch';
import type { PageSizeOption } from '../../_components/ui';

type Director = {
  id: string;
  campusCode: string;
  campusName: string | null;
  fullName: string;
  email: string;
  region: string | null;
};

type ListResult = {
  ok: boolean;
  total: number;
  items: Director[];
  knownCampuses: Array<{ campusCode: string; region: string | null }>;
  campusNamesMap: Record<string, string>;
};

const EMPTY_FORM = {
  id: '',
  campusCode: '',
  campusName: '',
  fullName: '',
  email: '',
  region: '',
};

export function CenterDirectorsPanel({ apiBase }: { apiBase: string }) {
  const confirm = useConfirm();
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(50);

  const { data, loading, error, refresh } = useFetch<ListResult>(`${apiBase}/center-directors`);

  function load() {
    setMessage('');
    setPage(1);
    void refresh();
  }

  function onCampusCodeChange(code: string) {
    const upper = code.toUpperCase();
    const suggestedName = data?.campusNamesMap?.[upper] ?? '';
    const suggestedRegion = data?.knownCampuses.find((c) => c.campusCode === upper)?.region ?? '';
    setForm((p) => ({
      ...p,
      campusCode: upper,
      campusName: p.campusName || suggestedName,
      region: p.region || suggestedRegion,
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.campusCode.trim() || !form.fullName.trim() || !form.email.trim()) {
      setMessage('Completa codigo de centro, nombre y correo.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const r = await fetch(`${apiBase}/center-directors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMessage(`Error guardando: ${j.error ?? 'desconocido'}`);
        return;
      }
      setMessage('✓ Director guardado.');
      setForm(EMPTY_FORM);
      void refresh();
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  function edit(d: Director) {
    setForm({
      id: d.id,
      campusCode: d.campusCode,
      campusName: d.campusName ?? '',
      fullName: d.fullName,
      email: d.email,
      region: d.region ?? '',
    });
  }

  async function remove(d: Director) {
    if (!await confirm({ title: 'Eliminar director', message: `¿Eliminar a "${d.fullName}" del centro ${d.campusCode}?`, confirmLabel: 'Eliminar', tone: 'danger' })) return;
    try {
      const r = await fetch(`${apiBase}/center-directors/${d.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMessage(`Error eliminando: ${j.error ?? 'desconocido'}`);
        return;
      }
      setMessage('Director eliminado.');
      void refresh();
    } catch (e) {
      setMessage(`Error: ${(e as Error).message}`);
    }
  }

  const known = data?.knownCampuses ?? [];
  const items = data?.items ?? [];
  const assignedCodes = new Set(items.map((i) => i.campusCode));
  const pending = known.filter((c) => !assignedCodes.has(c.campusCode));
  const pagedItems = items.slice((page - 1) * pageSize, page * pageSize);

  return (
    <article className="premium-card">
      <PageHero
        title="Directores de centro universitario"
        description="Asignación manual de directores por código de centro (campus). Usado para reportes por centro y notificaciones."
      />

      <div className="panel-body">
      {(message || error) && <AlertBox tone="info">{message || error}</AlertBox>}

      <form onSubmit={save} className="form-grid" style={{ marginBottom: 16 }}>
        <label>
          Codigo centro
          <input
            value={form.campusCode}
            onChange={(e) => onCampusCodeChange(e.target.value)}
            placeholder="IBA, NVA, LER..."
            list="known-campuses"
            required
          />
          <datalist id="known-campuses">
            {known.map((c) => (
              <option key={c.campusCode} value={c.campusCode}>{c.region ?? ''}</option>
            ))}
          </datalist>
        </label>
        <label>
          Nombre del centro
          <input
            value={form.campusName}
            onChange={(e) => setForm((p) => ({ ...p, campusName: e.target.value }))}
            placeholder="Ibague, Neiva..."
          />
        </label>
        <label>
          Region
          <input
            value={form.region}
            onChange={(e) => setForm((p) => ({ ...p, region: e.target.value }))}
            placeholder="Centro, Sur"
          />
        </label>
        <label className="wide">
          Nombre completo del director
          <input
            value={form.fullName}
            onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
            required
          />
        </label>
        <label className="wide">
          Correo
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            required
          />
        </label>
        <div className="toolbar wide">
          <Button variant="primary" size="sm" type="submit" disabled={saving} loading={saving}>
            {form.id ? 'Actualizar director' : 'Agregar director'}
          </Button>
          {form.id && (
            <Button variant="ghost" size="sm" type="button" onClick={() => setForm(EMPTY_FORM)}>Cancelar edición</Button>
          )}
        </div>
      </form>

      {pending.length > 0 && (
        <div style={{ marginBottom: 12, padding: 8, background: '#fef3c7', borderRadius: 6, fontSize: 12 }}>
          <strong>Centros sin director asignado:</strong>{' '}
          {pending.map((c) => (
            <span key={c.campusCode} style={{ marginRight: 8 }}>
              <button
                type="button"
                onClick={() => onCampusCodeChange(c.campusCode)}
                style={{ background: 'transparent', border: 'none', color: '#854d0e', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}
              >
                {c.campusCode} ({c.region ?? '—'})
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Button variant="ghost" size="sm" onClick={() => load()} disabled={loading} loading={loading}>
          ↻ Recargar
        </Button>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{items.length} director(es) registrados</span>
      </div>

      <table className="fast-table">
        <thead>
          <tr>
            <th>Codigo</th>
            <th>Centro</th>
            <th>Region</th>
            <th>Director</th>
            <th>Correo</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {pagedItems.map((d) => (
            <tr key={d.id}>
              <td><strong>{d.campusCode}</strong></td>
              <td>{d.campusName ?? '—'}</td>
              <td>{d.region ?? '—'}</td>
              <td>{d.fullName}</td>
              <td>{d.email}</td>
              <td style={{ display: 'flex', gap: 4 }}>
                <Button variant="ghost" size="sm" onClick={() => edit(d)}>Editar</Button>
                <Button variant="danger" size="sm" onClick={() => void remove(d)}>Eliminar</Button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>Sin directores registrados</td></tr>
          )}
        </tbody>
      </table>
      <PaginationControls
        currentPage={page}
        totalPages={Math.max(1, Math.ceil(items.length / pageSize))}
        totalItems={items.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        label="directores"
      />
      </div>{/* /panel-body */}
    </article>
  );
}
