'use client';

import { useMemo, useState } from 'react';

type TraceItem = {
  courseId: string;
  nrc: string;
  periodCode: string;
  teacherName: string | null;
  programCode: string | null;
  moment: string | null;
  template: string;
  phase: string | null;
  score: number | null;
  observations: string | null;
  computedAt: string | null;
  evaluationType: 'MANUAL' | 'REPLICADA' | 'SIN_EVALUACION';
  replicatedFromCourseId: string | null;
  replicatedFromNrc: string | null;
  replicatedToCount: number;
  replicatedToNrcs: string[];
};

type NrcTraceResponse = {
  ok: boolean;
  totalCourses: number;
  totalEvaluations: number;
  manualEvaluations: number;
  replicatedEvaluations: number;
  items: TraceItem[];
};

type NrcTracePanelProps = {
  apiBase: string;
  initialPeriodCode?: string;
};

export function NrcTracePanel({ apiBase, initialPeriodCode = '202615' }: NrcTracePanelProps) {
  const [periodCode, setPeriodCode] = useState(initialPeriodCode);
  const [phase, setPhase] = useState<'ALL' | 'ALISTAMIENTO' | 'EJECUCION'>('ALL');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<NrcTraceResponse | null>(null);

  const items = useMemo(() => result?.items ?? [], [result]);

  async function searchTrace() {
    const q = query.trim();
    if (!q) {
      setMessage('Escribe NRC, docente, ID o programa para buscar.');
      setResult(null);
      return;
    }

    try {
      setLoading(true);
      setMessage('');

      const params = new URLSearchParams({ q, periodCode: periodCode.trim() || initialPeriodCode });
      if (phase !== 'ALL') params.set('phase', phase);

      const response = await fetch(`${apiBase}/evaluation/nrc-trace?${params.toString()}`);
      const data = (await response.json()) as NrcTraceResponse;
      if (!response.ok || !data?.ok) {
        setMessage('No se pudo consultar la trazabilidad.');
        setResult(null);
        return;
      }

      setResult(data);
      setMessage('');
    } catch {
      setMessage('Error de conexion consultando la trazabilidad.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="panel">
      <h2>Trazabilidad de replicacion por NRC</h2>
      <div className="controls">
        <label>
          Periodo
          <input value={periodCode} onChange={(event) => setPeriodCode(event.target.value)} placeholder="202615" />
        </label>
        <label>
          Fase
          <select value={phase} onChange={(event) => setPhase(event.target.value as 'ALL' | 'ALISTAMIENTO' | 'EJECUCION')}>
            <option value="ALL">Todas</option>
            <option value="ALISTAMIENTO">Alistamiento</option>
            <option value="EJECUCION">Ejecucion</option>
          </select>
        </label>
        <label style={{ minWidth: 260 }}>
          Buscar
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ej: 15234, Juan Perez, 1001234, PSIC"
          />
        </label>
        <button onClick={() => void searchTrace()} disabled={loading}>
          {loading ? 'Buscando...' : 'Buscar trazabilidad'}
        </button>
      </div>

      {result ? (
        <div className="saved-nrc-block">
          <div className="saved-nrc-kpis">
            <span className="badge">Cursos: {result.totalCourses}</span>
            <span className="badge">Evaluaciones: {result.totalEvaluations}</span>
            <span className="badge">Manuales: {result.manualEvaluations}</span>
            <span className="badge">Replicadas: {result.replicatedEvaluations}</span>
          </div>
        </div>
      ) : null}

      <table style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>NRC</th>
            <th>Fase</th>
            <th>Tipo</th>
            <th>Replica</th>
            <th>Origen</th>
            <th>Puntaje</th>
            <th>Observaciones</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {items.length ? (
            items.map((item, idx) => (
              <tr key={`${item.courseId}-${item.phase ?? 'none'}-${idx}`}>
                <td>{item.nrc}</td>
                <td>{item.phase ?? '-'}</td>
                <td>{item.evaluationType}</td>
                <td>
                  {item.evaluationType === 'MANUAL'
                    ? item.replicatedToCount > 0
                      ? `SI (${item.replicatedToCount}) ${item.replicatedToNrcs.join(', ')}`
                      : 'NO'
                    : item.evaluationType === 'REPLICADA'
                      ? 'RECIBIDA'
                      : '-'}
                </td>
                <td>{item.replicatedFromNrc ?? '-'}</td>
                <td>{item.score !== null ? `${item.score}/50` : '-'}</td>
                <td>{item.observations?.trim() || '-'}</td>
                <td>{item.computedAt ? new Date(item.computedAt).toLocaleString() : '-'}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={8} className="muted">
                Sin resultados. Busca por NRC, docente, ID o programa para ver trazabilidad.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {message ? <div className="message">{message}</div> : null}
    </article>
  );
}
