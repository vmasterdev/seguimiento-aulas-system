'use client';

import { useState } from 'react';

type OutboxEmailPanelProps = {
  apiBase: string;
};

type SendResponse = {
  ok: boolean;
  dryRun: boolean;
  candidates?: number;
  preview?: Array<{
    id: string;
    to: string;
    originalTo?: string;
    forceToApplied?: boolean;
    subject: string;
    periodCode: string;
    phase: string;
    moment: string;
    audience: string;
  }>;
  sentCount?: number;
  failedCount?: number;
  sent?: Array<{ id: string; to: string; messageId: string | null }>;
  failed?: Array<{ id: string; to: string; error: string }>;
  reason?: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T & { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join('; ')
      : (data?.message ?? `HTTP ${response.status}`);
    throw new Error(message);
  }
  return data as T;
}

export function OutboxEmailPanel({ apiBase }: OutboxEmailPanelProps) {
  const [periodCode, setPeriodCode] = useState('202615');
  const [phase, setPhase] = useState<'ALISTAMIENTO' | 'EJECUCION'>('ALISTAMIENTO');
  const [moment, setMoment] = useState<'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2'>('MD1');
  const [audience, setAudience] = useState<'DOCENTE' | 'COORDINADOR' | 'GLOBAL'>('DOCENTE');
  const [status, setStatus] = useState<'DRAFT' | 'EXPORTED'>('DRAFT');
  const [limit, setLimit] = useState('10');
  const [forceTo, setForceTo] = useState('');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<SendResponse | null>(null);

  function buildPayload(dryRun: boolean) {
    const parsedLimit = Number(limit);
    const payload: Record<string, unknown> = {
      periodCode: periodCode.trim(),
      phase,
      moment,
      audience,
      status,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10,
      dryRun,
    };
    if (forceTo.trim()) payload.forceTo = forceTo.trim();
    return payload;
  }

  async function runSend(dryRun: boolean) {
    try {
      setBusy(true);
      setMessage('');
      const body = buildPayload(dryRun);
      const data = await fetchJson<SendResponse>(`${apiBase}/outbox/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(data);
      if (dryRun) {
        setMessage(`Dry-run completado. Candidatos: ${data.candidates ?? 0}`);
      } else {
        setMessage(`Envio completado. Enviados: ${data.sentCount ?? 0} | Fallidos: ${data.failedCount ?? 0}`);
      }
    } catch (error) {
      setMessage(`No fue posible procesar el envio: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest10() {
    if (!forceTo.trim()) {
      setMessage('Define "Forzar destinatario" para la prueba de 10 docentes.');
      return;
    }
    setLimit('10');
    const ok = window.confirm(
      `Se enviaran hasta 10 mensajes a ${forceTo.trim()} usando SMTP configurado. Continuar?`,
    );
    if (!ok) return;
    await runSend(false);
  }

  return (
    <article className="panel">
      <h2>Envio de correo (Outbox)</h2>
      <div className="actions">
        Ejecuta pruebas desde interfaz: primero <span className="code">dry-run</span> y luego envio real.
        <br />
        Para prueba controlada, usa <span className="code">Forzar destinatario</span> y limita a 10 docentes.
      </div>

      <div className="controls" style={{ marginTop: 10 }}>
        <label>
          Periodo
          <input value={periodCode} onChange={(event) => setPeriodCode(event.target.value)} placeholder="202615" />
        </label>
        <label>
          Fase
          <select value={phase} onChange={(event) => setPhase(event.target.value as 'ALISTAMIENTO' | 'EJECUCION')}>
            <option value="ALISTAMIENTO">ALISTAMIENTO</option>
            <option value="EJECUCION">EJECUCION</option>
          </select>
        </label>
        <label>
          Momento
          <select
            value={moment}
            onChange={(event) =>
              setMoment(event.target.value as 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2')
            }
          >
            <option value="MD1">MD1 (M1)</option>
            <option value="1">1 (RYC)</option>
            <option value="MD2">MD2</option>
            <option value="INTER">INTER</option>
            <option value="RM1">RM1</option>
            <option value="RM2">RM2</option>
          </select>
        </label>
        <label>
          Audiencia
          <select
            value={audience}
            onChange={(event) =>
              setAudience(event.target.value as 'DOCENTE' | 'COORDINADOR' | 'GLOBAL')
            }
          >
            <option value="DOCENTE">DOCENTE</option>
            <option value="COORDINADOR">COORDINADOR</option>
            <option value="GLOBAL">GLOBAL</option>
          </select>
        </label>
        <label>
          Estado origen
          <select value={status} onChange={(event) => setStatus(event.target.value as 'DRAFT' | 'EXPORTED')}>
            <option value="DRAFT">DRAFT</option>
            <option value="EXPORTED">EXPORTED</option>
          </select>
        </label>
        <label>
          Limite
          <input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="10" />
        </label>
        <label style={{ minWidth: 280 }}>
          Forzar destinatario (pruebas)
          <input
            value={forceTo}
            onChange={(event) => setForceTo(event.target.value)}
            placeholder="tu-correo@dominio.edu"
          />
        </label>
      </div>

      <div className="controls" style={{ marginTop: 10 }}>
        <button type="button" onClick={() => void runSend(true)} disabled={busy}>
          {busy ? 'Procesando...' : 'Previsualizar (dry-run)'}
        </button>
        <button type="button" onClick={() => void runSend(false)} disabled={busy} className="btn-next-action">
          {busy ? 'Enviando...' : 'Enviar ahora'}
        </button>
        <button type="button" onClick={() => void sendTest10()} disabled={busy}>
          {busy ? 'Enviando...' : 'Prueba real: 10 docentes'}
        </button>
      </div>

      <div className="actions" style={{ marginTop: 8 }}>
        Mailpit local: <span className="code">http://localhost:8025</span> (SMTP: <span className="code">127.0.0.1:1025</span>)
      </div>

      {message ? <div className="message">{message}</div> : null}
      {result ? <div className="log-box">{JSON.stringify(result, null, 2)}</div> : null}
    </article>
  );
}

