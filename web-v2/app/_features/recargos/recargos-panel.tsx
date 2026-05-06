'use client';

import { useEffect, useState } from 'react';

type Row = {
  docente: string;
  docenteEmail: string;
  docenteId: string;
  centro: string;
  programa: string;
  programaNombre: string;
  nrc: string;
  periodo: string;
  fecha: string;
  dia: string;
  claseInicio: string;
  claseFin: string;
  recargoInicio: string;
  recargoFin: string;
  minutosRecargo: number;
  horasRecargo: number;
  edificio: string;
  salon: string;
};

type ByTeacher = {
  docente: string;
  docenteId: string;
  centro: string;
  programa: string;
  minutos: number;
  horas: number;
};

type Result = {
  ok: boolean;
  recargoStart: string;
  recargoEnd: string;
  dateFrom: string;
  dateTo: string;
  totalRows: number;
  totalMinutos: number;
  totalHoras: number;
  byTeacher: ByTeacher[];
  rows: Row[];
};

export function RecargosPanel({ apiBase }: { apiBase: string }) {
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    teacherId: '',
    programCode: '',
    campus: '',
    recargoStart: '21:00',
    recargoEnd: '06:00',
  });
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${apiBase}/system-settings`);
        const j = await r.json();
        setFilters((p) => ({ ...p, recargoStart: j.recargoStart ?? '21:00', recargoEnd: j.recargoEnd ?? '06:00' }));
      } catch { /* ignore */ }
    })();
    // Default rango: mes actual
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    setFilters((p) => ({ ...p, dateFrom: fmt(first), dateTo: fmt(last) }));
  }, []);

  async function compute() {
    if (!filters.dateFrom || !filters.dateTo) return;
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    try {
      const r = await fetch(`${apiBase}/recargo-nocturno?${params}`);
      const j = await r.json();
      setResult(j);
    } finally { setLoading(false); }
  }

  function downloadCsv() {
    if (!filters.dateFrom || !filters.dateTo) return;
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    params.set('format', 'csv');
    window.location.href = `${apiBase}/recargo-nocturno?${params}`;
  }

  async function saveSettings() {
    const r = await fetch(`${apiBase}/system-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recargoStart: filters.recargoStart, recargoEnd: filters.recargoEnd }),
    });
    if (r.ok) alert('Configuracion guardada como predeterminada.');
  }

  const visibleRows = showAll ? result?.rows ?? [] : (result?.rows ?? []).slice(0, 200);

  return (
    <div className="panel">
      <h3>Recargos nocturnos</h3>
      <p className="muted">Calculo de horas en franja nocturna por docente. Configurable rango de fechas y franja horaria. Exportable a CSV.</p>

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label>Desde<input type="date" value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} /></label>
        <label>Hasta<input type="date" value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} /></label>
        <label>Inicio recargo<input type="time" value={filters.recargoStart} onChange={(e) => setFilters((p) => ({ ...p, recargoStart: e.target.value }))} /></label>
        <label>Fin recargo<input type="time" value={filters.recargoEnd} onChange={(e) => setFilters((p) => ({ ...p, recargoEnd: e.target.value }))} /></label>
        <label>Docente ID<input value={filters.teacherId} onChange={(e) => setFilters((p) => ({ ...p, teacherId: e.target.value }))} placeholder="(opcional)" /></label>
        <label>Programa<input value={filters.programCode} onChange={(e) => setFilters((p) => ({ ...p, programCode: e.target.value }))} placeholder="(opcional)" /></label>
        <label>Centro<input value={filters.campus} onChange={(e) => setFilters((p) => ({ ...p, campus: e.target.value }))} placeholder="IBA, NVA..." /></label>
        <div className="toolbar wide">
          <button type="button" className="primary" onClick={() => void compute()} disabled={loading}>{loading ? 'Calculando...' : 'Calcular'}</button>
          <button type="button" onClick={downloadCsv} disabled={!result || !result.totalRows} style={{ background: '#16a34a', color: '#fff' }}>Exportar CSV</button>
          <button type="button" onClick={() => void saveSettings()}>Guardar franja como default</button>
        </div>
      </div>

      {result && (
        <>
          <div style={{ display: 'flex', gap: 16, padding: 12, background: '#f3f4f6', borderRadius: 6, marginBottom: 12 }}>
            <div><strong>{result.totalRows}</strong> filas</div>
            <div><strong>{result.totalHoras}</strong> horas total</div>
            <div><strong>{result.byTeacher.length}</strong> docentes</div>
            <div className="muted" style={{ fontSize: 12 }}>Franja {result.recargoStart}–{result.recargoEnd} · {result.dateFrom} a {result.dateTo}</div>
          </div>

          <div className="subtitle">Resumen por docente</div>
          <table className="table" style={{ marginBottom: 16 }}>
            <thead><tr><th>Docente</th><th>Centro</th><th>Programa</th><th style={{ textAlign: 'right' }}>Horas</th><th style={{ textAlign: 'right' }}>Minutos</th></tr></thead>
            <tbody>
              {result.byTeacher.map((t, idx) => (
                <tr key={idx}>
                  <td>{t.docente || <span className="muted">(sin docente)</span>}</td>
                  <td>{t.centro}</td>
                  <td>{t.programa}</td>
                  <td style={{ textAlign: 'right' }}><strong>{t.horas}</strong></td>
                  <td style={{ textAlign: 'right' }}>{t.minutos}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="subtitle">Detalle hora por hora ({result.totalRows} filas)</div>
          <table className="table">
            <thead><tr><th>Docente</th><th>Centro</th><th>NRC</th><th>Fecha</th><th>Dia</th><th>Clase</th><th>Recargo</th><th>Min</th></tr></thead>
            <tbody>
              {visibleRows.map((r, idx) => (
                <tr key={idx}>
                  <td>{r.docente}</td>
                  <td>{r.centro}</td>
                  <td>{r.nrc}</td>
                  <td>{r.fecha}</td>
                  <td>{r.dia}</td>
                  <td>{r.claseInicio}—{r.claseFin}</td>
                  <td>{r.recargoInicio}—{r.recargoFin}</td>
                  <td><strong>{r.minutosRecargo}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!showAll && result.rows.length > 200 && (
            <button type="button" onClick={() => setShowAll(true)} style={{ marginTop: 8 }}>Mostrar las {result.rows.length} filas</button>
          )}
        </>
      )}
    </div>
  );
}
