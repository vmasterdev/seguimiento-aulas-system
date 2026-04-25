'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type BannerDocentesPanelProps = {
  apiBase: string;
};

type BannerTeacherItem = {
  id: string;
  nrc: string;
  periodCode: string;
  subjectName: string | null;
  programCode: string | null;
  bannerTeacherId: string | null;
  bannerTeacherName: string | null;
  bannerResolved: boolean;
  currentTeacherId: string | null;
  currentTeacherName: string | null;
  currentTeacherEmail: string | null;
};

type BannerTeachersResult = {
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  stats: {
    totalNrcs: number;
    uniqueTeachers: number;
    resolved: number;
    unresolved: number;
  };
  items: BannerTeacherItem[];
};

type AddResult = { ok: boolean; id?: string; message?: string };

export function BannerDocentesPanel({ apiBase }: BannerDocentesPanelProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<BannerTeachersResult | null>(null);
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);
  const [limit, setLimit] = useState('500');
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [addResults, setAddResults] = useState<Record<string, AddResult>>({});

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      setLoading(true);
      setMessage('');
      const params = new URLSearchParams();
      if (onlyUnresolved) params.set('onlyUnresolved', 'true');
      if (limit.trim()) params.set('limit', limit.trim());
      const data = await fetchJson<BannerTeachersResult>(
        `${apiBase}/courses/banner-teachers/list?${params.toString()}`,
      );
      setResult(data);
    } catch (error) {
      setMessage(
        `Error al cargar datos: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }

  async function addToDb(item: BannerTeacherItem) {
    if (!item.bannerTeacherId || !item.bannerTeacherName) {
      setMessage('El item no tiene ID o nombre Banner para agregar.');
      return;
    }
    const key = item.id;
    setAdding((prev) => new Set(prev).add(key));
    setMessage('');
    try {
      await fetchJson(`${apiBase}/teachers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: item.bannerTeacherId,
          fullName: item.bannerTeacherName,
        }),
      });
      await fetchJson(`${apiBase}/courses/${item.id}/teacher`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: item.bannerTeacherId }),
      });
      setAddResults((prev) => ({ ...prev, [key]: { ok: true } }));
      setResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((i) =>
            i.id === key ? { ...i, bannerResolved: true, currentTeacherId: item.bannerTeacherId, currentTeacherName: item.bannerTeacherName } : i,
          ),
        };
      });
    } catch (error) {
      setAddResults((prev) => ({
        ...prev,
        [key]: { ok: false, message: error instanceof Error ? error.message : String(error) },
      }));
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function addAllUnresolved() {
    if (!result) return;
    const unresolved = result.items.filter((i) => !i.bannerResolved && i.bannerTeacherId && i.bannerTeacherName);
    if (unresolved.length === 0) {
      setMessage('No hay docentes sin vincular para agregar.');
      return;
    }
    setMessage(`Agregando ${unresolved.length} docentes...`);
    let ok = 0;
    let failed = 0;
    for (const item of unresolved) {
      const key = item.id;
      setAdding((prev) => new Set(prev).add(key));
      try {
        await fetchJson(`${apiBase}/teachers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId: item.bannerTeacherId, fullName: item.bannerTeacherName }),
        });
        await fetchJson(`${apiBase}/courses/${item.id}/teacher`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacherId: item.bannerTeacherId }),
        });
        setAddResults((prev) => ({ ...prev, [key]: { ok: true } }));
        setResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((i) =>
              i.id === key ? { ...i, bannerResolved: true, currentTeacherId: item.bannerTeacherId, currentTeacherName: item.bannerTeacherName } : i,
            ),
          };
        });
        ok++;
      } catch (error) {
        setAddResults((prev) => ({
          ...prev,
          [key]: { ok: false, message: error instanceof Error ? error.message : String(error) },
        }));
        failed++;
      } finally {
        setAdding((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }
    setMessage(`Listo: ${ok} vinculados, ${failed} con error.`);
  }

  const stats = result?.stats;
  const items = result?.items ?? [];
  const visibleItems = onlyUnresolved ? items.filter((i) => !i.bannerResolved) : items;

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="panel-title">Docentes encontrados por Banner</h3>
        <p className="panel-desc">
          NRCs donde el proceso automatizado de Banner identifico un docente. Permite agregar esos docentes a la base local y vincularlos al NRC.
        </p>
      </div>

      {stats && (
        <div className="stats-row" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <StatCard label="NRCs con docente Banner" value={stats.totalNrcs} />
          <StatCard label="Docentes unicos" value={stats.uniqueTeachers} />
          <StatCard label="Vinculados" value={stats.resolved} accent="green" />
          <StatCard label="Sin vincular" value={stats.unresolved} accent={stats.unresolved > 0 ? 'amber' : 'green'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={onlyUnresolved}
            onChange={(e) => setOnlyUnresolved(e.target.checked)}
          />
          Solo sin vincular
        </label>
        <select
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          style={{ padding: '0.3rem 0.5rem', fontSize: '0.82rem', borderRadius: '4px', border: '1px solid var(--border)' }}
        >
          <option value="200">200</option>
          <option value="500">500</option>
          <option value="2000">2000</option>
          <option value="5000">5000</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => { void load(); }} disabled={loading}>
          {loading ? 'Cargando...' : 'Actualizar'}
        </button>
        {stats && stats.unresolved > 0 && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { void addAllUnresolved(); }}
            disabled={loading || adding.size > 0}
          >
            Agregar todos sin vincular ({stats.unresolved})
          </button>
        )}
      </div>

      {message && (
        <div className="alert" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {message}
        </div>
      )}

      {loading && !result && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Cargando...</p>
      )}

      {result && (
        <div style={{ overflowX: 'auto' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Mostrando {visibleItems.length} de {result.total} NRCs
          </p>
          <table className="data-table" style={{ width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th>NRC</th>
                <th>Periodo</th>
                <th>Materia</th>
                <th>Programa</th>
                <th>Docente actual</th>
                <th>Docente Banner</th>
                <th>Estado</th>
                <th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const addResult = addResults[item.id];
                const isAdding = adding.has(item.id);
                const teacherChanged =
                  !item.bannerResolved &&
                  !!item.currentTeacherId &&
                  item.currentTeacherId !== item.bannerTeacherId;
                return (
                  <tr key={item.id}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{item.nrc}</td>
                    <td>{item.periodCode}</td>
                    <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.subjectName ?? '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{item.programCode ?? '—'}</td>
                    <td style={{ fontSize: '0.8rem', color: teacherChanged ? 'var(--amber, #f59e0b)' : 'var(--text-muted)' }}>
                      {item.currentTeacherName ?? (item.currentTeacherId ? item.currentTeacherId : '—')}
                    </td>
                    <td style={{ fontWeight: 500 }}>
                      {item.bannerTeacherName ?? '—'}
                      {teacherChanged && (
                        <span
                          title="El docente en Banner difiere del docente actual en el sistema"
                          style={{ marginLeft: '0.3rem', fontSize: '0.72rem', color: 'var(--amber, #f59e0b)' }}
                        >
                          ↺
                        </span>
                      )}
                    </td>
                    <td>
                      {item.bannerResolved ? (
                        <span className="badge badge-green">Vinculado</span>
                      ) : teacherChanged ? (
                        <span className="badge badge-amber">Cambio</span>
                      ) : (
                        <span className="badge badge-amber">Sin vincular</span>
                      )}
                    </td>
                    <td>
                      {item.bannerResolved ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>✓</span>
                      ) : addResult?.ok ? (
                        <span style={{ color: 'var(--green)', fontSize: '0.78rem' }}>Actualizado</span>
                      ) : (
                        <button
                          className="btn btn-secondary btn-xs"
                          onClick={() => { void addToDb(item); }}
                          disabled={isAdding}
                          title={addResult?.message ?? (teacherChanged ? `Cambiar de "${item.currentTeacherName}" a "${item.bannerTeacherName}"` : undefined)}
                        >
                          {isAdding ? '...' : addResult?.ok === false ? 'Error - reintentar' : teacherChanged ? 'Actualizar' : 'Agregar a BD'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem' }}>
                    No hay registros con los filtros actuales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: 'green' | 'amber' }) {
  const color = accent === 'green' ? 'var(--green, #22c55e)' : accent === 'amber' ? 'var(--amber, #f59e0b)' : 'var(--indigo, #6366f1)';
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0.75rem 1.1rem',
        minWidth: '130px',
        flex: '1 1 130px',
      }}
    >
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{label}</div>
    </div>
  );
}
