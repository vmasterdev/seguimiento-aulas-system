'use client';

import { useMemo, useState } from 'react';
import { Button, PageHero, AlertBox } from '../../_components/ui';

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
      setMessage('Error de conexión consultando la trazabilidad.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const isError = message.startsWith('No se pudo') || message.startsWith('Error');

  return (
    <div className="premium-card">
      <PageHero
        title="Trazabilidad de replicación por NRC"
        description="Busca NRC, docente, ID o programa para ver cómo se propagaron las evaluaciones."
      />

      <div className="panel-body">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>Periodo</span>
            <input value={periodCode} onChange={(event) => setPeriodCode(event.target.value)} placeholder="202615" style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.85rem' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>Fase</span>
            <select value={phase} onChange={(event) => setPhase(event.target.value as 'ALL' | 'ALISTAMIENTO' | 'EJECUCION')} style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.85rem' }}>
              <option value="ALL">Todas</option>
              <option value="ALISTAMIENTO">Alistamiento</option>
              <option value="EJECUCION">Ejecución</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 260 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>Buscar</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void searchTrace(); }}
              placeholder="Ej: 15234, Juan Pérez, 1001234, PSIC"
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.85rem' }}
            />
          </label>
          <Button variant="primary" size="sm" loading={loading} onClick={() => void searchTrace()}>
            {loading ? 'Buscando...' : 'Buscar trazabilidad'}
          </Button>
        </div>

        {message && (
          <div style={{ marginTop: '1rem' }}>
            <AlertBox tone={isError ? 'error' : 'warn'}>{message}</AlertBox>
          </div>
        )}

        {result && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: '1rem' }}>
            {[
              { label: 'Cursos', value: result.totalCourses },
              { label: 'Evaluaciones', value: result.totalEvaluations },
              { label: 'Manuales', value: result.manualEvaluations },
              { label: 'Replicadas', value: result.replicatedEvaluations },
            ].map(({ label, value }) => (
              <span key={label} style={{ background: '#f1f5f9', border: '1px solid #dce3ef', padding: '3px 10px', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600 }}>
                {label}: {value}
              </span>
            ))}
          </div>
        )}

        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table className="fast-table">
            <thead>
              <tr>
                <th>NRC</th>
                <th>Fase</th>
                <th>Tipo</th>
                <th>Réplica</th>
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
                          ? `Sí (${item.replicatedToCount}) ${item.replicatedToNrcs.join(', ')}`
                          : 'No'
                        : item.evaluationType === 'REPLICADA'
                          ? 'Recibida'
                          : '-'}
                    </td>
                    <td>{item.replicatedFromNrc ?? '-'}</td>
                    <td>{item.score !== null ? `${item.score}/50` : '-'}</td>
                    <td>{item.observations?.trim() || '-'}</td>
                    <td>{item.computedAt ? new Date(item.computedAt).toLocaleString('es-CO') : '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: '#6b7280' }}>
                    Sin resultados. Busca por NRC, docente, ID o programa para ver trazabilidad.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
