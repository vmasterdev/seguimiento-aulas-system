'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '../../_lib/http';
import { Button, StatusPill, PageHero, StatsGrid, AlertBox } from '../../_components/ui';

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
    <article className="premium-card">
      <PageHero
        title="Docentes encontrados por Banner"
        description="NRCs donde el proceso automatizado de Banner identificó un docente. Permite agregar esos docentes a la base local y vincularlos al NRC."
      >
        <StatusPill tone={loading ? 'warn' : (stats?.unresolved ?? 0) > 0 ? 'warn' : 'ok'} dot={loading}>
          {loading ? 'Cargando' : stats ? `${stats.unresolved} sin vincular` : '—'}
        </StatusPill>
        <Button variant="ghost" size="sm" onClick={() => { void load(); }} loading={loading}>
          ↻ Actualizar
        </Button>
      </PageHero>

      {stats && (
        <StatsGrid items={[
          { label: 'NRCs con docente Banner', value: stats.totalNrcs, tone: 'default' },
          { label: 'Docentes únicos', value: stats.uniqueTeachers, tone: 'default' },
          { label: 'Vinculados', value: stats.resolved, tone: 'ok' },
          { label: 'Sin vincular', value: stats.unresolved, tone: stats.unresolved > 0 ? 'warn' : 'ok' },
        ]} />
      )}

      <div className="panel-body">
        <div className="controls">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
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
            style={{ padding: '3px 8px', fontSize: 'var(--fs-sm)', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}
          >
            <option value="200">200</option>
            <option value="500">500</option>
            <option value="2000">2000</option>
            <option value="5000">5000</option>
          </select>
          {stats && stats.unresolved > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { void addAllUnresolved(); }}
              disabled={loading || adding.size > 0}
              loading={adding.size > 0}
            >
              Agregar todos sin vincular ({stats.unresolved})
            </Button>
          )}
        </div>

        {message && <AlertBox tone="info">{message}</AlertBox>}

        {loading && !result && (
          <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)', padding: '8px 0' }}>Cargando...</p>
        )}

        {result && (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <p style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 6 }}>
              Mostrando {visibleItems.length} de {result.total} NRCs
            </p>
            <table className="fast-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Periodo</th>
                  <th>Materia</th>
                  <th>Programa</th>
                  <th>Docente actual</th>
                  <th>Docente Banner</th>
                  <th>Estado</th>
                  <th>Acción</th>
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
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{item.nrc}</td>
                      <td>{item.periodCode}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.subjectName ?? '—'}
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{item.programCode ?? '—'}</td>
                      <td style={{ color: teacherChanged ? 'var(--amber)' : 'var(--muted)' }}>
                        {item.currentTeacherName ?? (item.currentTeacherId ? item.currentTeacherId : '—')}
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {item.bannerTeacherName ?? '—'}
                        {teacherChanged && (
                          <span
                            title="El docente en Banner difiere del docente actual en el sistema"
                            style={{ marginLeft: 4, fontSize: 'var(--fs-micro)', color: 'var(--amber)' }}
                          >
                            ↺
                          </span>
                        )}
                      </td>
                      <td>
                        {item.bannerResolved ? (
                          <StatusPill tone="ok">Vinculado</StatusPill>
                        ) : teacherChanged ? (
                          <StatusPill tone="warn">Cambio</StatusPill>
                        ) : (
                          <StatusPill tone="warn">Sin vincular</StatusPill>
                        )}
                      </td>
                      <td>
                        {item.bannerResolved ? (
                          <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-micro)' }}>✓</span>
                        ) : addResult?.ok ? (
                          <span style={{ color: 'var(--green)', fontSize: 'var(--fs-micro)' }}>Actualizado</span>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { void addToDb(item); }}
                            disabled={isAdding}
                            loading={isAdding}
                            title={addResult?.message ?? (teacherChanged ? `Cambiar de "${item.currentTeacherName}" a "${item.bannerTeacherName}"` : undefined)}
                          >
                            {addResult?.ok === false ? 'Error - reintentar' : teacherChanged ? 'Actualizar' : 'Agregar a BD'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleItems.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: '1.5rem' }}>
                      No hay registros con los filtros actuales.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </article>
  );
}

