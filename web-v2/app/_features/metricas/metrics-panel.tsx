'use client';

import { useMemo, useState } from 'react';
import { Button, PageHero, StatsGrid } from '../../_components/ui';
import { useFetch } from '../../_lib/use-fetch';

type Center = { campus: string; nrcCount: number; salonesCount: number; teachersCount: number; horasSemana: number; modalityBreakdown: Record<string, number> };
type Salon = { campus: string; edificio: string; salon: string; nrcCount: number; teachersCount: number; subjectsCount: number; horasSemana: number; ocupacionPct: number };
type Result = {
  ok: boolean;
  totalSlots: number;
  heatmapMinutes: number[][];
  heatmapNrcCount: number[][];
  byCenter: Center[];
  bySalon: Salon[];
  teoricoMinSalon: number;
};

const DAYS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function MetricsPanel({ apiBase }: { apiBase: string }) {
  const [filters, setFilters] = useState({ periodCode: '202615', moment: '', campus: '' });
  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  const { data, loading, refresh } = useFetch<Result>(activeUrl);

  function load() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    const next = `${apiBase}/metrics/usage?${params}`;
    if (next === activeUrl) {
      void refresh();
    } else {
      setActiveUrl(next);
    }
  }

  const maxHeatmapMins = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const row of data.heatmapMinutes) for (const v of row) if (v > m) m = v;
    return m;
  }, [data]);

  const maxCenter = useMemo(() => Math.max(1, ...(data?.byCenter ?? []).map((c) => c.horasSemana)), [data]);
  const maxSalonHoras = useMemo(() => Math.max(1, ...(data?.bySalon ?? []).slice(0, 20).map((s) => s.horasSemana)), [data]);

  // Distribución por franja
  const franjas = useMemo(() => {
    if (!data) return null;
    let mañana = 0, tarde = 0, noche = 0;
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const v = data.heatmapMinutes[d][h];
        if (h < 12) mañana += v;
        else if (h < 18) tarde += v;
        else noche += v;
      }
    }
    return { mañana, tarde, noche };
  }, [data]);

  const heatColor = (v: number) => {
    if (!v || maxHeatmapMins === 0) return '#f3f4f6';
    const t = Math.min(1, v / maxHeatmapMins);
    const r = Math.round(255 - t * (255 - 30));
    const g = Math.round(255 - t * (255 - 64));
    const b = Math.round(255 - t * (255 - 175));
    return `rgb(${r},${g},${b})`;
  };

  return (
    <article className="premium-card">
      <PageHero
        title="Métricas de uso de sedes y salones"
        description="Carga horaria semanal por sede y salón, calculada desde NRC con horario asignado. Útil para usabilidad y planeación."
      >
        <Button variant="primary" size="sm" onClick={() => void load()} disabled={loading} loading={loading}>
          Calcular métricas
        </Button>
      </PageHero>

      {data && (
        <StatsGrid items={[
          { label: 'Slots NRC×día', value: data.totalSlots, tone: 'default' },
          { label: 'Sedes activas', value: data.byCenter.length, tone: 'ok' },
          { label: 'Salones únicos', value: data.bySalon.length, tone: 'default' },
          { label: 'Horas/sem', value: Math.round(data.byCenter.reduce((s, c) => s + c.horasSemana, 0)), tone: 'default' },
          ...(franjas ? [
            { label: 'Mañana h/sem', value: Math.round(franjas.mañana / 60), tone: 'default' as const },
            { label: 'Tarde h/sem', value: Math.round(franjas.tarde / 60), tone: 'default' as const },
            { label: 'Noche h/sem', value: Math.round(franjas.noche / 60), tone: franjas.noche > franjas.mañana ? 'warn' as const : 'default' as const },
          ] : []),
        ]} />
      )}

      <div className="panel-body">
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label>Periodo<input value={filters.periodCode} onChange={(e) => setFilters((p) => ({ ...p, periodCode: e.target.value }))} /></label>
        <label>Momento<input value={filters.moment} onChange={(e) => setFilters((p) => ({ ...p, moment: e.target.value }))} placeholder="MD1, MD2, 1" /></label>
        <label>Centro<input value={filters.campus} onChange={(e) => setFilters((p) => ({ ...p, campus: e.target.value }))} placeholder="(opcional)" /></label>
      </div>

      {!data && <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>Sin datos. Pulsa "Calcular métricas".</p>}

      {data && (
        <>

          {/* Heatmap dia x hora */}
          <div className="subtitle" style={{ marginTop: 16 }}>Heatmap día × hora (minutos clase / hora)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ padding: 4, textAlign: 'left', minWidth: 50 }}>Día \ Hora</th>
                  {HOURS.map((h) => <th key={h} style={{ padding: 4, minWidth: 28, textAlign: 'center' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d, di) => (
                  <tr key={d}>
                    <td style={{ padding: 4, fontWeight: 700 }}>{d}</td>
                    {HOURS.map((h) => {
                      const v = data.heatmapMinutes[di][h];
                      return (
                        <td key={h} title={`${d} ${h}h: ${v} min, ${data.heatmapNrcCount[di][h]} NRC simultaneos`} style={{
                          background: heatColor(v),
                          padding: 6,
                          textAlign: 'center',
                          color: v > maxHeatmapMins * 0.5 ? '#fff' : '#374151',
                          fontWeight: v > 0 ? 600 : 400,
                          minWidth: 28,
                        }}>
                          {v > 0 ? data.heatmapNrcCount[di][h] : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Numero = NRC simultáneos en esa hora. Color = intensidad minutos clase / semana.</p>

          {/* Top sedes barras */}
          <div className="subtitle" style={{ marginTop: 20 }}>Carga por sede (h/semana)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.byCenter.map((c) => (
              <div key={c.campus} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ minWidth: 60, fontWeight: 700 }}>{c.campus}</span>
                <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 24, position: 'relative' }}>
                  <div style={{ background: 'linear-gradient(90deg,#1e40af,#3b82f6)', height: '100%', width: `${(c.horasSemana / maxCenter) * 100}%`, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px', color: '#fff', fontSize: 12, fontWeight: 600 }}>
                    {c.horasSemana}h
                  </div>
                </div>
                <span style={{ fontSize: 11, color: '#6b7280', minWidth: 180 }}>{c.nrcCount} NRC · {c.salonesCount} salones · {c.teachersCount} docentes</span>
              </div>
            ))}
          </div>

          {/* Top 20 salones más usados */}
          <div className="subtitle" style={{ marginTop: 20 }}>Top 20 salones por ocupación</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {data.bySalon.slice(0, 20).map((s) => (
              <div key={`${s.campus}-${s.edificio}-${s.salon}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ minWidth: 140, fontSize: 12 }}><strong>{s.campus}</strong> {s.edificio} {s.salon}</span>
                <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 20, position: 'relative' }}>
                  <div style={{
                    background: s.ocupacionPct > 60 ? '#dc2626' : s.ocupacionPct > 40 ? '#d97706' : '#16a34a',
                    height: '100%',
                    width: `${(s.horasSemana / maxSalonHoras) * 100}%`,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    padding: '0 6px',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                  }}>
                    {s.horasSemana}h ({s.ocupacionPct}%)
                  </div>
                </div>
                <span style={{ fontSize: 11, color: '#6b7280', minWidth: 130 }}>{s.nrcCount} NRC · {s.teachersCount} doc</span>
              </div>
            ))}
          </div>

          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Capacidad teórica salón: L–S 6:00–22:00 = 96h/sem. Verde &lt; 40%, naranja 40–60%, rojo &gt; 60%.</p>

          {/* Tabla detalle salones */}
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Tabla completa de salones ({data.bySalon.length})</summary>
            <table className="fast-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Centro</th><th>Edificio</th><th>Salón</th><th style={{ textAlign: 'right' }}>NRC</th><th style={{ textAlign: 'right' }}>Docentes</th><th style={{ textAlign: 'right' }}>Asignaturas</th><th style={{ textAlign: 'right' }}>Horas/sem</th><th style={{ textAlign: 'right' }}>Ocupación</th></tr></thead>
              <tbody>
                {data.bySalon.map((s, i) => (
                  <tr key={i}>
                    <td>{s.campus}</td>
                    <td>{s.edificio}</td>
                    <td>{s.salon}</td>
                    <td style={{ textAlign: 'right' }}>{s.nrcCount}</td>
                    <td style={{ textAlign: 'right' }}>{s.teachersCount}</td>
                    <td style={{ textAlign: 'right' }}>{s.subjectsCount}</td>
                    <td style={{ textAlign: 'right' }}><strong>{s.horasSemana}</strong></td>
                    <td style={{ textAlign: 'right', color: s.ocupacionPct > 60 ? '#dc2626' : s.ocupacionPct > 40 ? '#d97706' : '#16a34a', fontWeight: 600 }}>{s.ocupacionPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      </div>{/* /panel-body */}
    </article>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: '#fff', border: `2px solid ${color}`, borderRadius: 8, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value.toLocaleString()}</div>
    </div>
  );
}
