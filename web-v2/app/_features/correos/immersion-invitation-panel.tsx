'use client';

import { useState } from 'react';
import { fetchJson } from '../../_lib/http';

type ImmersionInvitationPanelProps = {
  apiBase: string;
};

type Phase = 'ALISTAMIENTO' | 'EJECUCION';

type PrepareResponse = {
  ok?: boolean;
  created?: number;
  reason?: string;
  createdMessageIds?: string[];
  previewItems?: Array<{
    id: string;
    teacherId: string;
    recipientName: string;
    recipientEmail: string;
    courseCount: number;
    moments: string[];
    scoreBands: string[];
  }>;
  skippedTeachersWithoutEmail?: string[];
  periodCode?: string;
  phase?: string;
  moments?: string[];
  scoreBands?: string[];
  sessionTitle?: string;
  sessionDateLabel?: string;
  sessionTimeLabel?: string;
  subject?: string;
  invitationMomentKey?: string;
};

type SendResponse = {
  sentCount?: number;
  failedCount?: number;
  skippedCount?: number;
  deliveryMode?: 'SMTP' | 'OUTLOOK';
  reason?: string;
};

type PreviewResponse = {
  id: string;
  subject: string;
  htmlBody: string;
  recipientName: string | null;
  recipientEmail: string | null;
  status: string;
  phase: string;
  moment: string;
  audience: string;
  periodCode: string;
  periodLabel: string;
  updatedAt: string;
};

function formatMomentLabel(value: string): string {
  if (value === 'MD1') return 'M1';
  if (value === '1') return 'RCY';
  if (value.startsWith('INVITACION_DIGITAL_')) return 'M1 + RCY';
  return value;
}

export function ImmersionInvitationPanel({ apiBase }: ImmersionInvitationPanelProps) {
  const [periodCode, setPeriodCode] = useState('');
  const [phase, setPhase] = useState<Phase>('ALISTAMIENTO');
  const [sessionTitle, setSessionTitle] = useState('Sesion virtual de inmersion digital de Campus Virtual');
  const [sessionDateLabel, setSessionDateLabel] = useState('');
  const [sessionTimeLabel, setSessionTimeLabel] = useState('10:00 a.m. - 11:00 a.m.');
  const [meetingUrl, setMeetingUrl] = useState(
    'https://teams.microsoft.com/meet/26292337361382?p=VI8CzkXDpVq10ueC4u',
  );
  const [introNote, setIntroNote] = useState(
    'De acuerdo con los resultados obtenidos en la revision del Campus Virtual, identificamos oportunidades de fortalecimiento en el manejo de tu aula virtual para este periodo.',
  );
  const [forceTo, setForceTo] = useState('');

  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<PrepareResponse | null>(null);
  const [generatedIds, setGeneratedIds] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);

  async function loadPreview(messageId: string) {
    try {
      setPreviewLoading(true);
      setPreviewError('');
      const response = await fetchJson<PreviewResponse>(`${apiBase}/outbox/${messageId}/preview`);
      setPreviewData(response);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function prepareInvitation() {
    try {
      setBusy(true);
      setMessage('');
      setPreviewError('');
      setPreviewData(null);

      const response = await fetchJson<PrepareResponse>(`${apiBase}/outbox/workshop-invitation/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodCode: periodCode.trim(),
          phase,
          moments: ['MD1', '1'],
          scoreBands: ['ACEPTABLE', 'INSATISFACTORIO'],
          sessionTitle,
          sessionDateLabel,
          sessionTimeLabel,
          meetingUrl,
          introNote,
        }),
      });

      const ids = response.createdMessageIds ?? [];
      setGeneratedIds(ids);
      setResult(response);

      if (!ids.length) {
        setMessage(response.reason ?? 'No se generaron borradores para esta invitacion.');
        return;
      }

      setMessage(
        `Borradores de invitacion generados: ${response.created ?? ids.length}. Abre el preview y confirma antes de enviar.`,
      );
      await loadPreview(ids[0]);
    } catch (error) {
      setMessage(`No fue posible preparar la invitacion: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendInvitation() {
    if (!generatedIds.length) {
      setMessage('Primero genera los borradores y revisa el preview.');
      return;
    }

    const confirmed = window.confirm(
      `Se enviaran ${generatedIds.length} correos de invitacion a la sesion de inmersion digital. Continuar?`,
    );
    if (!confirmed) return;

    try {
      setSending(true);
      setMessage('');
      const response = await fetchJson<SendResponse>(`${apiBase}/outbox/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: generatedIds,
          dryRun: false,
          forceTo: forceTo.trim() || undefined,
        }),
      });
      setMessage(
        `Invitacion enviada. Enviados: ${response.sentCount ?? 0} | Fallidos: ${response.failedCount ?? 0} | Omitidos: ${response.skippedCount ?? 0}${response.deliveryMode ? ` | Modo: ${response.deliveryMode}` : ''}${response.reason ? ` | Nota: ${response.reason}` : ''}`,
      );
    } catch (error) {
      setMessage(`No fue posible enviar la invitacion: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <h2>Sesion virtual de inmersion digital</h2>
        <span className="panel-note">Invitacion por docente con preview antes del envio</span>
      </div>

      <div className="actions">
        Esta campana genera borradores solo para docentes con resultado <strong>ACEPTABLE</strong> o <strong>INSATISFACTORIO</strong> en los momentos <strong>M1 (MD1)</strong> y <strong>RCY (1)</strong>.
      </div>
      <div className="actions" style={{ marginTop: 6 }}>
        Flujo recomendado: <strong>Generar borradores</strong>, luego <strong>revisar preview</strong> y finalmente <strong>enviar invitacion real</strong>.
      </div>

      <div className="grid" style={{ marginTop: 14 }}>
        <article className="card">
          <div className="kpi-label">Momento incluido</div>
          <div className="kpi-value-sm">MD1 + 1 (RCY)</div>
        </article>
        <article className="card">
          <div className="kpi-label">Resultados objetivo</div>
          <div className="kpi-value-sm">Aceptable / Insatisfactorio</div>
        </article>
        <article className="card">
          <div className="kpi-label">Horario</div>
          <div className="kpi-value-sm">{sessionTimeLabel || 'Por definir'}</div>
        </article>
      </div>

      <div className="controls" style={{ marginTop: 10 }}>
        <label>
          Periodo
          <input value={periodCode} onChange={(event) => setPeriodCode(event.target.value)} placeholder="Ej. 202615" />
        </label>
        <label>
          Fase
          <select value={phase} onChange={(event) => setPhase(event.target.value as Phase)}>
            <option value="ALISTAMIENTO">ALISTAMIENTO</option>
            <option value="EJECUCION">EJECUCION</option>
          </select>
        </label>
        <label style={{ minWidth: 320 }}>
          Titulo de la sesion
          <input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} />
        </label>
      </div>

      <div className="controls" style={{ marginTop: 10 }}>
        <label>
          Fecha
          <input value={sessionDateLabel} onChange={(event) => setSessionDateLabel(event.target.value)} />
        </label>
        <label>
          Horario
          <input value={sessionTimeLabel} onChange={(event) => setSessionTimeLabel(event.target.value)} />
        </label>
        <label style={{ minWidth: 400 }}>
          Link Microsoft Teams
          <input value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} />
        </label>
      </div>

      <div className="controls" style={{ marginTop: 10 }}>
        <label style={{ minWidth: 760 }}>
          Mensaje base
          <textarea value={introNote} onChange={(event) => setIntroNote(event.target.value)} rows={4} />
        </label>
      </div>

      <div className="controls" style={{ marginTop: 10 }}>
        <label style={{ minWidth: 320 }}>
          Forzar destinatario (prueba)
          <input
            value={forceTo}
            onChange={(event) => setForceTo(event.target.value)}
            placeholder="correo.prueba@dominio.edu"
          />
        </label>
        <button type="button" onClick={() => void prepareInvitation()} disabled={busy || sending}>
          {busy ? 'Preparando...' : 'Generar borradores + preview'}
        </button>
        <button type="button" className="btn-next-action" onClick={() => void sendInvitation()} disabled={busy || sending || !generatedIds.length}>
          {sending ? 'Enviando...' : 'Enviar invitacion real'}
        </button>
      </div>

      {message ? <div className="flash" style={{ marginTop: 12 }}>{message}</div> : null}

      {result ? (
        <div className="action-grid" style={{ marginTop: 14 }}>
          <article className="action-card">
            <h3>Resumen de borradores</h3>
            <div className="stacked-metrics">
              <span className="chip">Borradores: {result.created ?? 0}</span>
              <span className="chip">Periodo: {result.periodCode ?? periodCode}</span>
              <span className="chip">Fase: {result.phase ?? phase}</span>
              <span className="chip">Momento: M1 + RCY</span>
            </div>
            {result.subject ? <p className="panel-note" style={{ marginTop: 10 }}>{result.subject}</p> : null}
            {result.skippedTeachersWithoutEmail?.length ? (
              <div className="flash flash-warning" style={{ marginTop: 10 }}>
                Docentes omitidos por falta de correo: {result.skippedTeachersWithoutEmail.join(', ')}
              </div>
            ) : null}
          </article>

          <article className="action-card">
            <h3>Destinatarios generados</h3>
            <div className="badge-wall">
              {(result.previewItems ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`switch-button${previewData?.id === item.id ? ' active' : ''}`}
                  onClick={() => void loadPreview(item.id)}
                >
                  {item.recipientName}
                </button>
              ))}
            </div>
            <div className="panel-note" style={{ marginTop: 10 }}>
              Selecciona un docente para revisar el preview exacto antes del envio.
            </div>
          </article>
        </div>
      ) : null}

      {result?.previewItems?.length ? (
        <div style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Docente</th>
                <th>Correo</th>
                <th>Momentos</th>
                <th>Resultados</th>
                <th>Cursos</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {result.previewItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.recipientName}</td>
                  <td>{item.recipientEmail}</td>
                  <td>{item.moments.map((moment) => formatMomentLabel(moment)).join(', ')}</td>
                  <td>{item.scoreBands.join(', ')}</td>
                  <td>{item.courseCount}</td>
                  <td>
                    <button type="button" onClick={() => void loadPreview(item.id)}>
                      Abrir preview
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {(previewLoading || previewError || previewData) ? (
        <div style={{ marginTop: 16 }}>
          <div className="panel-heading">
            <h2>Preview del correo</h2>
            <span className="panel-note">El correo no se envia hasta que confirmes</span>
          </div>

          {previewLoading ? <div className="flash">Cargando preview...</div> : null}
          {previewError ? <div className="flash flash-warning">No fue posible cargar el preview: {previewError}</div> : null}

          {previewData ? (
            <>
              <div className="outbox-mail-kv-grid" style={{ marginBottom: 10 }}>
                <div><strong>Destinatario:</strong> {previewData.recipientName ?? 'Sin nombre'}</div>
                <div><strong>Correo:</strong> {previewData.recipientEmail ?? 'sin-correo@invalid.local'}</div>
                <div><strong>Periodo:</strong> {previewData.periodCode}</div>
                <div><strong>Fase:</strong> {previewData.phase}</div>
                <div><strong>Momento:</strong> {formatMomentLabel(previewData.moment)}</div>
                <div><strong>Estado:</strong> {previewData.status}</div>
              </div>

              <iframe
                title={`immersion-preview-${previewData.id}`}
                srcDoc={previewData.htmlBody}
                style={{
                  width: '100%',
                  minHeight: '72vh',
                  border: '1px solid #d4d7dd',
                  borderRadius: 12,
                  background: '#fff',
                }}
                sandbox="allow-popups allow-same-origin"
              />
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
