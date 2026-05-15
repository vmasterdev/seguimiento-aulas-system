'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../_lib/http';
import { Button, StatusPill, PageHero, StatsGrid, AlertBox, Modal, useConfirm } from '../../_components/ui';

type OutboxTrackingPanelProps = {
  apiBase: string;
};

type TrackingItem = {
  id: string;
  periodCode: string;
  periodLabel: string;
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  moment: string;
  audience: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
  status: string;
  subject: string;
  recipientName: string | null;
  recipientEmail: string | null;
  teacherId: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  lastAttemptResult: 'SENT' | 'FAILED' | 'SKIPPED_DUPLICATE' | null;
  lastAttemptError: string | null;
  lastDeliveryMode: 'SMTP' | 'OUTLOOK' | null;
  createdAt: string;
  updatedAt: string;
};

type TrackingResponse = {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: {
    sent: number;
    pending: number;
    byStatus: Record<string, number>;
  };
  note: string;
  items: TrackingItem[];
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
  if (value === 'MD2') return 'M2';
  if (value === '1') return 'RYC';
  return value;
}

function formatDate(value: string | null): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAttemptResult(value: TrackingItem['lastAttemptResult']): string {
  if (value === 'SENT') return 'ENVIADO';
  if (value === 'FAILED') return 'FALLIDO';
  if (value === 'SKIPPED_DUPLICATE') return 'OMITIDO DUPLICADO';
  return 'Sin intentos';
}

export function OutboxTrackingPanel({ apiBase }: OutboxTrackingPanelProps) {
  const confirm = useConfirm();
  const [periodCode, setPeriodCode] = useState('');
  const [phase, setPhase] = useState<'ALL' | 'ALISTAMIENTO' | 'EJECUCION'>('ALL');
  const [moment, setMoment] = useState<'ALL' | 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2'>('ALL');
  const [audience, setAudience] = useState<'ALL' | 'DOCENTE' | 'COORDINADOR' | 'GLOBAL'>('DOCENTE');
  const [status, setStatus] = useState<'ALL' | 'DRAFT' | 'EXPORTED' | 'SENT_AUTO' | 'SENT_MANUAL'>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [forceToResend, setForceToResend] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (periodCode.trim()) params.set('periodCode', periodCode.trim());
    if (phase !== 'ALL') params.set('phase', phase);
    if (moment !== 'ALL') params.set('moment', moment);
    if (audience !== 'ALL') params.set('audience', audience);
    if (status !== 'ALL') params.set('status', status);
    if (searchApplied.trim()) params.set('search', searchApplied.trim());
    params.set('page', String(page));
    params.set('pageSize', '25');
    return params.toString();
  }, [audience, moment, page, periodCode, phase, searchApplied, status]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        setError('');
        const result = await fetchJson<TrackingResponse>(`${apiBase}/outbox/tracking?${queryString}`);
        if (!active) return;
        setData(result);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [apiBase, queryString, reloadToken]);

  function applySearch() {
    setPage(1);
    setSearchApplied(searchInput);
  }

  function clearFilters() {
    setPeriodCode('');
    setPhase('ALL');
    setMoment('ALL');
    setAudience('DOCENTE');
    setStatus('ALL');
    setSearchInput('');
    setSearchApplied('');
    setPage(1);
  }

  async function resendUpdated(item: TrackingItem) {
    const confirmed = await confirm({
      title: 'Regenerar y reenviar correo',
      message: `Se regenerará y reenviará el correo de ${item.recipientName ?? 'docente'} (${item.periodCode} ${item.moment}).`,
      confirmLabel: 'Reenviar',
      tone: 'primary',
    });
    if (!confirmed) return;

    try {
      setRowBusyId(item.id);
      setActionMessage('');
      const response = await fetchJson<{
        ok: boolean;
        regeneratedMessageId: string;
        sendResult?: { sentCount?: number; failedCount?: number };
      }>(`${apiBase}/outbox/resend-updated`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          forceTo: forceToResend.trim() || undefined,
        }),
      });
      setActionMessage(
        `Correo actualizado y reenviado. Mensaje generado: ${response.regeneratedMessageId}. Enviados: ${response.sendResult?.sentCount ?? 0}, fallidos: ${response.sendResult?.failedCount ?? 0}.`,
      );
      setReloadToken((prev) => prev + 1);
    } catch (actionError) {
      setActionMessage(
        `No fue posible reenviar este correo: ${actionError instanceof Error ? actionError.message : String(actionError)}`,
      );
    } finally {
      setRowBusyId(null);
    }
  }

  async function sendExistingMessage(item: TrackingItem) {
    const confirmed = await confirm({
      title: 'Enviar correo existente',
      message: `Se enviará o reenviará el correo actual de ${item.recipientName ?? 'destinatario'} (${item.periodCode} ${item.moment}).`,
      confirmLabel: 'Enviar',
      tone: 'primary',
    });
    if (!confirmed) return;

    try {
      setRowBusyId(item.id);
      setActionMessage('');
      const response = await fetchJson<{
        ok: boolean;
        sentCount?: number;
        failedCount?: number;
        skippedCount?: number;
        deliveryMode?: 'SMTP' | 'OUTLOOK';
      }>(`${apiBase}/outbox/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [item.id],
          dryRun: false,
          forceTo: forceToResend.trim() || undefined,
        }),
      });
      setActionMessage(
        `Envio ejecutado para el correo seleccionado. Enviados: ${response.sentCount ?? 0}, fallidos: ${response.failedCount ?? 0}, omitidos: ${response.skippedCount ?? 0}${response.deliveryMode ? ` | modo ${response.deliveryMode}` : ''}.`,
      );
      setReloadToken((prev) => prev + 1);
    } catch (actionError) {
      setActionMessage(
        `No fue posible enviar este correo: ${actionError instanceof Error ? actionError.message : String(actionError)}`,
      );
    } finally {
      setRowBusyId(null);
    }
  }

  async function openPreview(item: TrackingItem) {
    try {
      setPreviewOpen(true);
      setPreviewLoading(true);
      setPreviewError('');
      setPreviewData(null);
      const response = await fetchJson<PreviewResponse>(`${apiBase}/outbox/${item.id}/preview`);
      setPreviewData(response);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  }

  const sent = data?.summary.sent ?? 0;
  const pending = data?.summary.pending ?? 0;
  const total = data?.total ?? 0;

  return (
    <article className="premium-card">
      <PageHero
        title="Trazabilidad de correos enviados"
        description="Vista de envío por destinatario: borradores, enviados y último resultado por intento."
      >
        <StatusPill tone={loading ? 'warn' : (data?.summary.pending ?? 0) > 0 ? 'warn' : 'ok'} dot={loading}>
          {loading ? 'Cargando' : `${data?.summary.pending ?? 0} pendientes`}
        </StatusPill>
        <Button variant="ghost" size="sm" onClick={applySearch} loading={loading}>
          ↻ Actualizar
        </Button>
      </PageHero>

      <StatsGrid items={[
        { label: 'Total correos', value: total, tone: 'default' },
        { label: 'Enviados', value: sent, tone: 'ok' },
        { label: 'Pendientes', value: pending, tone: pending > 0 ? 'warn' : 'ok' },
      ]} />

      <div className="panel-body">

      <div className="controls" style={{ marginTop: 0 }}>
        <label>
          Periodo
          <input value={periodCode} onChange={(event) => { setPeriodCode(event.target.value); setPage(1); }} />
        </label>
        <label>
          Fase
          <select value={phase} onChange={(event) => { setPhase(event.target.value as 'ALL' | 'ALISTAMIENTO' | 'EJECUCION'); setPage(1); }}>
            <option value="ALL">Todas</option>
            <option value="ALISTAMIENTO">ALISTAMIENTO</option>
            <option value="EJECUCION">EJECUCION</option>
          </select>
        </label>
        <label>
          Momento
          <select value={moment} onChange={(event) => { setMoment(event.target.value as 'ALL' | 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2'); setPage(1); }}>
            <option value="ALL">Todos</option>
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
          <select value={audience} onChange={(event) => { setAudience(event.target.value as 'ALL' | 'DOCENTE' | 'COORDINADOR' | 'GLOBAL'); setPage(1); }}>
            <option value="ALL">Todas</option>
            <option value="DOCENTE">DOCENTE</option>
            <option value="COORDINADOR">COORDINADOR</option>
            <option value="GLOBAL">GLOBAL</option>
          </select>
        </label>
        <label>
          Estado
          <select value={status} onChange={(event) => { setStatus(event.target.value as 'ALL' | 'DRAFT' | 'EXPORTED' | 'SENT_AUTO' | 'SENT_MANUAL'); setPage(1); }}>
            <option value="ALL">Todos</option>
            <option value="DRAFT">DRAFT</option>
            <option value="EXPORTED">EXPORTED</option>
            <option value="SENT_AUTO">SENT_AUTO</option>
            <option value="SENT_MANUAL">SENT_MANUAL</option>
          </select>
        </label>
        <label style={{ minWidth: 300 }}>
          Buscar (docente, correo, asunto)
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applySearch();
              }
            }}
            placeholder="Nombre, correo o asunto"
          />
        </label>
      </div>

      <div className="controls" style={{ marginTop: 8 }}>
        <Button variant="primary" size="sm" onClick={applySearch} disabled={loading} loading={loading}>
          Actualizar
        </Button>
        <Button variant="ghost" size="sm" onClick={clearFilters} disabled={loading}>
          Limpiar filtros
        </Button>
        <label style={{ minWidth: 280 }}>
          Correo alterno (opcional)
          <input
            value={forceToResend}
            onChange={(event) => setForceToResend(event.target.value)}
            placeholder="destino@correo.edu"
          />
        </label>
      </div>

      {data?.note ? <div className="actions" style={{ marginTop: 8 }}>{data.note}</div> : null}
      {error ? <AlertBox tone="error">No fue posible cargar trazabilidad: {error}</AlertBox> : null}
      {actionMessage ? <AlertBox tone="info">{actionMessage}</AlertBox> : null}

      <div className="outbox-mail-list" style={{ marginTop: 12 }}>
        {(data?.items ?? []).map((item) => (
          <article key={item.id} className="outbox-mail-card">
            <div className="outbox-mail-head">
              <div>
                <div className="outbox-mail-name">{item.recipientName ?? 'Sin nombre'}</div>
                <div className="outbox-mail-email">{item.recipientEmail ?? 'sin-correo@invalid.local'}</div>
              </div>
              <div className="outbox-badges">
                <StatusPill tone={
                  item.status === 'SENT_AUTO' || item.status === 'SENT_MANUAL' ? 'ok'
                  : item.status === 'EXPORTED' ? 'neutral'
                  : 'warn'
                }>{item.status}</StatusPill>
                {item.lastAttemptResult ? (
                  <StatusPill tone={
                    item.lastAttemptResult === 'SENT' ? 'ok'
                    : item.lastAttemptResult === 'FAILED' ? 'danger'
                    : 'neutral'
                  }>
                    Último intento: {formatAttemptResult(item.lastAttemptResult)}
                  </StatusPill>
                ) : (
                  <StatusPill tone="neutral">Sin intentos</StatusPill>
                )}
              </div>
            </div>

            <div className="outbox-mail-subject">{item.subject}</div>

            <div className="outbox-mail-kv-grid">
              <div><strong>Periodo:</strong> {item.periodCode}</div>
              <div><strong>Fase:</strong> {item.phase}</div>
              <div><strong>Momento:</strong> {formatMomentLabel(item.moment)} ({item.moment})</div>
              <div><strong>Audiencia:</strong> {item.audience}</div>
              <div><strong>Intentos:</strong> {item.attempts}</div>
              <div><strong>Ultimo envio:</strong> {formatDate(item.lastAttemptAt)}</div>
              <div><strong>Modo:</strong> {item.lastDeliveryMode ?? 'N/A'}</div>
              <div><strong>Actualizado:</strong> {formatDate(item.updatedAt)}</div>
            </div>

            {item.lastAttemptError ? (
              <div className="outbox-error-box">Error ultimo intento: {item.lastAttemptError}</div>
            ) : null}

            <div className="controls" style={{ marginTop: 8 }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void openPreview(item)}
                disabled={rowBusyId === item.id}
                loading={rowBusyId === item.id}
              >
                Ver preview del correo
              </Button>
              {item.audience === 'DOCENTE' ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void resendUpdated(item)}
                  disabled={rowBusyId === item.id}
                  loading={rowBusyId === item.id}
                >
                  Actualizar y reenviar
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void sendExistingMessage(item)}
                  disabled={rowBusyId === item.id}
                  loading={rowBusyId === item.id}
                >
                  Enviar o reenviar
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>

      {data && data.items.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)', padding: '8px 0' }}>Sin resultados para los filtros seleccionados.</p> : null}

      {data ? (
        <div className="controls" style={{ marginTop: 10 }}>
          <Button variant="ghost" size="sm" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={loading || data.page <= 1}>
            ← Anterior
          </Button>
          <span style={{ alignSelf: 'center', fontSize: 'var(--fs-sm)', color: 'var(--muted)', fontWeight: 600 }}>
            Página {data.page} de {data.pageCount}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPage((prev) => Math.min(data.pageCount, prev + 1))} disabled={loading || data.page >= data.pageCount}>
            Siguiente →
          </Button>
        </div>
      ) : null}

      </div>{/* /panel-body */}

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        size="xl"
        title={`Preview correo${previewData ? ` | ${previewData.subject}` : ''}`}
      >
        {previewLoading && <AlertBox tone="info">Cargando preview...</AlertBox>}
        {previewError && <AlertBox tone="error">No fue posible cargar el preview: {previewError}</AlertBox>}

        {previewData ? (
          <>
            <div className="outbox-mail-kv-grid" style={{ marginBottom: 10 }}>
              <div><strong>Destinatario:</strong> {previewData.recipientName ?? 'Sin nombre'}</div>
              <div><strong>Correo:</strong> {previewData.recipientEmail ?? 'sin-correo@invalid.local'}</div>
              <div><strong>Periodo:</strong> {previewData.periodCode}</div>
              <div><strong>Fase:</strong> {previewData.phase}</div>
              <div><strong>Momento:</strong> {formatMomentLabel(previewData.moment)} ({previewData.moment})</div>
              <div><strong>Estado:</strong> {previewData.status}</div>
            </div>
            <iframe
              title={`preview-${previewData.id}`}
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
      </Modal>
    </article>
  );
}
