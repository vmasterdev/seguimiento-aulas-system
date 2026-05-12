'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type EventItem = {
  id: string;
  teacherId: string;
  teacherName: string;
  teacherEmail: string | null;
  coordination: string | null;
  campus: string | null;
  periodCode: string;
  moment: string;
  phase: string;
  totalScore: number | null;
  alistamientoScore: number | null;
  ejecucionScore: number | null;
  isNewTeacher: boolean;
  tenureDays: number | null;
  fechaInicio: string | null;
  signed: boolean;
  signedAt: string | null;
  signedNotes: string | null;
  delivered: boolean;
  deliveredAt: string | null;
  deliveryNotes: string | null;
  archived: boolean;
  archivedAt: string | null;
  archivedFolder: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedScore: number | null;
  notes: string | null;
  generatedAt: string;
  updatedAt: string;
};

type Props = { apiBase: string };

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function EventosSignificativosPanel({ apiBase }: Props) {
  const [items, setItems] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterPeriod, setFilterPeriod] = useState('');
  const [filterMoment, setFilterMoment] = useState('');
  const [filterPhase, setFilterPhase] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'complete'>('all');
  const [hideResolved, setHideResolved] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterPeriod) params.set('periodCode', filterPeriod);
      if (filterMoment) params.set('moment', filterMoment);
      if (filterPhase) params.set('phase', filterPhase);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`${apiBase}/outbox/significant-events?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: EventItem[] };
      setItems(json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase, filterPeriod, filterMoment, filterPhase, search]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load();
    }, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = useMemo(() => {
    let base = items;
    if (hideResolved) base = base.filter((it) => !it.resolved);
    if (filterStatus === 'all') return base;
    if (filterStatus === 'pending') {
      return base.filter((it) => !(it.signed && it.delivered && it.archived));
    }
    return base.filter((it) => it.signed && it.delivered && it.archived);
  }, [items, filterStatus, hideResolved]);

  const counts = useMemo(() => {
    const total = items.length;
    let signed = 0;
    let delivered = 0;
    let archived = 0;
    let complete = 0;
    let pendingNew = 0;
    let resolved = 0;
    let activos = 0;
    for (const it of items) {
      if (it.signed) signed += 1;
      if (it.delivered) delivered += 1;
      if (it.archived) archived += 1;
      if (it.signed && it.delivered && it.archived) complete += 1;
      if (it.isNewTeacher) pendingNew += 1;
      if (it.resolved) resolved += 1;
      else activos += 1;
    }
    return { total, signed, delivered, archived, complete, pendingNew, resolved, activos };
  }, [items]);

  async function patchEvent(id: string, body: Record<string, unknown>) {
    try {
      const res = await fetch(`${apiBase}/outbox/significant-events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (err) {
      alert(`Error actualizando: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function exportCsv() {
    const header = [
      'Docente',
      'Email',
      'Programa',
      'CU',
      'Periodo',
      'Momento',
      'Fase',
      'Total',
      'Alistamiento',
      'Ejecucion',
      'Antiguedad (dias)',
      'Nuevo',
      'Firmado',
      'FirmadoFecha',
      'Entregado',
      'EntregadoFecha',
      'Cargado Subdir',
      'CargadoFecha',
      'Carpeta',
      'Notas',
    ];
    const rows = filtered.map((it) => [
      it.teacherName,
      it.teacherEmail ?? '',
      it.coordination ?? '',
      it.campus ?? '',
      it.periodCode,
      it.moment,
      it.phase,
      it.totalScore ?? '',
      it.alistamientoScore ?? '',
      it.ejecucionScore ?? '',
      it.tenureDays ?? '',
      it.isNewTeacher ? 'SI' : 'NO',
      it.signed ? 'SI' : 'NO',
      formatDate(it.signedAt),
      it.delivered ? 'SI' : 'NO',
      formatDate(it.deliveredAt),
      it.archived ? 'SI' : 'NO',
      formatDate(it.archivedAt),
      it.archivedFolder ?? '',
      it.notes ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eventos-significativos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <div className="kpi-card" style={{ padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Total eventos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{counts.total}</div>
        </div>
        <div className="kpi-card" style={{ padding: 12, background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac' }}>
          <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>Firmados</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#166534' }}>{counts.signed}</div>
        </div>
        <div className="kpi-card" style={{ padding: 12, background: '#eff6ff', borderRadius: 8, border: '1px solid #93c5fd' }}>
          <div style={{ fontSize: 11, color: '#1e40af', fontWeight: 600 }}>Entregados</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1e40af' }}>{counts.delivered}</div>
        </div>
        <div className="kpi-card" style={{ padding: 12, background: '#fef3c7', borderRadius: 8, border: '1px solid #fcd34d' }}>
          <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600 }}>Cargados Subdireccion</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#92400e' }}>{counts.archived}</div>
        </div>
        <div className="kpi-card" style={{ padding: 12, background: '#dcfce7', borderRadius: 8, border: '1px solid #4ade80' }}>
          <div style={{ fontSize: 11, color: '#15803d', fontWeight: 600 }}>Completos (3/3)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#15803d' }}>{counts.complete}</div>
        </div>
        <div className="kpi-card" style={{ padding: 12, background: '#fee2e2', borderRadius: 8, border: '1px solid #fca5a5' }}>
          <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600 }}>Docentes nuevos (excluibles)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#991b1b' }}>{counts.pendingNew}</div>
        </div>
        <div className="kpi-card" style={{ padding: 12, background: '#ecfccb', borderRadius: 8, border: '1px solid #a3e635' }}>
          <div style={{ fontSize: 11, color: '#3f6212', fontWeight: 600 }}>Subsanados (score &gt;= 70)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#3f6212' }}>{counts.resolved}</div>
        </div>
        <div className="kpi-card" style={{ padding: 12, background: '#ffedd5', borderRadius: 8, border: '1px solid #fdba74' }}>
          <div style={{ fontSize: 11, color: '#9a3412', fontWeight: 600 }}>Activos (sin subsanar)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#9a3412' }}>{counts.activos}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
        <input
          type="text"
          value={filterPeriod}
          onChange={(e) => setFilterPeriod(e.target.value)}
          placeholder="Periodo (ej. 202615)"
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d1d5db', minWidth: 130 }}
        />
        <select
          value={filterMoment}
          onChange={(e) => setFilterMoment(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d1d5db' }}
        >
          <option value="">Todos los momentos</option>
          <option value="MD1">MD1</option>
          <option value="1">M1</option>
          <option value="MD2">MD2</option>
          <option value="2">M2</option>
          <option value="16S">16 semanas</option>
        </select>
        <select
          value={filterPhase}
          onChange={(e) => setFilterPhase(e.target.value)}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d1d5db' }}
        >
          <option value="">Todas las fases</option>
          <option value="ALISTAMIENTO">Alistamiento</option>
          <option value="EJECUCION">Ejecucion</option>
          <option value="CIERRE">Cierre</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as 'all' | 'pending' | 'complete')}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d1d5db' }}
        >
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="complete">Completos (3/3)</option>
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar docente, programa, CU..."
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #d1d5db', flex: '1 1 220px', minWidth: 200 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#334155', padding: '6px 10px', background: '#fff', borderRadius: 6, border: '1px solid #d1d5db' }}>
          <input
            type="checkbox"
            checked={hideResolved}
            onChange={(e) => setHideResolved(e.target.checked)}
          />
          Ocultar subsanados
        </label>
        <button
          type="button"
          onClick={() => void load()}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid #2563eb', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
        >
          Refrescar
        </button>
        <button
          type="button"
          onClick={exportCsv}
          style={{ padding: '6px 14px', fontSize: 13, borderRadius: 6, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
        >
          Exportar CSV
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, color: '#991b1b' }}>
          Error: {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: 12, color: '#64748b', fontSize: 13 }}>Cargando...</div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#0f172a', color: '#fff' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>Docente</th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>Programa</th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>CU</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Periodo</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Mom.</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Fase</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Total</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Antig.</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Firmado</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Entregado</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>Cargado</th>
              <th style={{ padding: '10px 12px', textAlign: 'left' }}>Notas</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>
                  Sin eventos significativos registrados con los filtros actuales.
                </td>
              </tr>
            )}
            {filtered.map((it, idx) => {
              const bg = it.resolved ? '#ecfccb' : (idx % 2 === 0 ? '#ffffff' : '#f9fafb');
              const newBadge = it.isNewTeacher ? (
                <span style={{ display: 'inline-block', padding: '1px 6px', background: '#fee2e2', color: '#991b1b', borderRadius: 4, fontSize: 10, fontWeight: 700, marginLeft: 6 }}>NUEVO</span>
              ) : null;
              const resolvedBadge = it.resolved ? (
                <span style={{ display: 'inline-block', padding: '1px 6px', background: '#a3e635', color: '#3f6212', borderRadius: 4, fontSize: 10, fontWeight: 700, marginLeft: 6 }}>SUBSANADO</span>
              ) : null;
              return (
                <tr key={it.id} style={{ background: bg, borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>
                      {it.teacherName}
                      {newBadge}
                      {resolvedBadge}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{it.teacherEmail ?? '-'}</div>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#334155' }}>{it.coordination ?? '-'}</td>
                  <td style={{ padding: '8px 12px', color: '#334155' }}>{it.campus ?? '-'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'monospace' }}>{it.periodCode}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>{it.moment}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11 }}>{it.phase}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: (it.totalScore ?? 100) < 70 ? '#991b1b' : '#0f172a' }}>
                    {it.totalScore != null ? it.totalScore.toFixed(1) : '-'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, color: '#64748b' }}>
                    {it.tenureDays != null ? `${it.tenureDays}d` : '-'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={it.signed}
                      onChange={(e) => void patchEvent(it.id, { signed: e.target.checked })}
                      title={it.signedAt ? `Firmado: ${formatDate(it.signedAt)}` : 'Marcar firmado'}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={it.delivered}
                      onChange={(e) => void patchEvent(it.id, { delivered: e.target.checked })}
                      title={it.deliveredAt ? `Entregado: ${formatDate(it.deliveredAt)}` : 'Marcar entregado'}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={it.archived}
                      onChange={(e) => void patchEvent(it.id, { archived: e.target.checked })}
                      title={it.archivedAt ? `Cargado: ${formatDate(it.archivedAt)}` : 'Marcar cargado en Subdireccion'}
                    />
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <input
                      type="text"
                      defaultValue={it.notes ?? ''}
                      onBlur={(e) => {
                        const value = e.target.value;
                        if (value !== (it.notes ?? '')) {
                          void patchEvent(it.id, { notes: value || null });
                        }
                      }}
                      placeholder="Notas..."
                      style={{ width: '100%', minWidth: 160, padding: '4px 8px', fontSize: 11.5, border: '1px solid #d1d5db', borderRadius: 4 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, color: '#64748b', padding: 8, background: '#f9fafb', border: '1px dashed #e5e7eb', borderRadius: 6 }}>
        <strong>Notas:</strong> Los eventos se generan automaticamente al producir reportes de cierre por momento. Marca "Firmado" cuando el docente firme el acta, "Entregado" cuando se entregue el documento, y "Cargado" cuando este disponible en la carpeta de la Subdireccion de Docencia. Los docentes nuevos (con menos de 90 dias) se marcan con badge rojo y NO requieren evento significativo segun politica institucional.
      </div>
    </div>
  );
}
