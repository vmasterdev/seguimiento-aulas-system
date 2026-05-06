'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '../../_lib/http';

type OutboxEmailPanelProps = {
  apiBase: string;
};

type Audience = 'DOCENTE' | 'COORDINADOR' | 'GLOBAL';
type Phase = 'ALISTAMIENTO' | 'EJECUCION';
type Status = 'DRAFT' | 'EXPORTED';
type Moment = 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2';

type PeriodOption = {
  code: string;
  label: string;
  modality: string;
};

type CoordinatorOption = {
  id: string;
  fullName: string;
  email: string | null;
  programId: string;
};

type GeneratedPreviewItem = {
  id: string;
  coordinatorId?: string;
  programId?: string;
  recipientName: string;
  recipientEmail: string | null;
  periodCodes?: string[];
  moments?: string[];
  courseCount?: number;
  uniqueTeachers?: number;
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

type OptionsResponse = {
  periods: PeriodOption[];
  coordinators: CoordinatorOption[];
  supportedMoments: Array<{ value: Moment; label: string }>;
  supportedPhases: string[];
};

type OperationResponse = {
  ok?: boolean;
  created?: number;
  candidates?: number;
  sentCount?: number;
  failedCount?: number;
  skippedCount?: number;
  deliveryMode?: 'SMTP' | 'OUTLOOK';
  reason?: string;
  moments?: string[];
  periodCodes?: string[];
  coordinatorId?: string | null;
  createdMessageIds?: string[];
  batches?: Array<{ createdMessageIds?: string[] }>;
  previewItems?: GeneratedPreviewItem[];
};

const FALLBACK_PERIODS: PeriodOption[] = [
  { code: '202610', label: 'PREGRADO PRESENCIAL', modality: 'PP' },
  { code: '202611', label: 'POSGRADO PRESENCIAL', modality: 'PP' },
  { code: '202612', label: 'PERIODO 202612', modality: 'OTRO' },
  { code: '202615', label: 'PREGRADO DISTANCIA', modality: 'PD' },
  { code: '202621', label: 'PERIODO 202621', modality: 'OTRO' },
  { code: '202641', label: 'PERIODO 202641', modality: 'OTRO' },
  { code: '202685', label: 'PERIODO 202685', modality: 'OTRO' },
];

const FALLBACK_MOMENTS: Array<{ value: Moment; label: string }> = [
  { value: 'MD1', label: 'MD1 (M1)' },
  { value: '1', label: '1 (RYC)' },
  { value: 'MD2', label: 'MD2' },
  { value: 'INTER', label: 'INTER' },
  { value: 'RM1', label: 'RM1' },
  { value: 'RM2', label: 'RM2' },
];

const DEFAULT_YEAR_PREFIX = String(new Date().getFullYear());

function defaultSinglePeriodCode(periods: PeriodOption[], yearPrefix = DEFAULT_YEAR_PREFIX): string {
  return periods.find((item) => item.code.startsWith(yearPrefix))?.code ?? periods[0]?.code ?? '';
}

function defaultGlobalPeriodCodes(periods: PeriodOption[], yearPrefix = DEFAULT_YEAR_PREFIX): string[] {
  return periods
    .map((item) => item.code)
    .filter((code) => code.startsWith(yearPrefix))
    .filter((code) => !/(80|85)$/.test(code));
}

function parseRecipientEmails(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function collectGeneratedIds(result: OperationResponse | null): string[] {
  if (!result) return [];
  const ids = new Set<string>();
  for (const value of result.createdMessageIds ?? []) ids.add(value);
  for (const batch of result.batches ?? []) {
    for (const value of batch.createdMessageIds ?? []) ids.add(value);
  }
  return [...ids];
}

export function OutboxEmailPanel({ apiBase }: OutboxEmailPanelProps) {
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState('');

  const [audience, setAudience] = useState<Audience>('GLOBAL');
  const [phase, setPhase] = useState<Phase>('ALISTAMIENTO');
  const [status, setStatus] = useState<Status>('DRAFT');
  const [yearPrefix, setYearPrefix] = useState(DEFAULT_YEAR_PREFIX);
  const [singlePeriodCode, setSinglePeriodCode] = useState(defaultSinglePeriodCode(FALLBACK_PERIODS, DEFAULT_YEAR_PREFIX));
  const [selectedPeriodCodes, setSelectedPeriodCodes] = useState<string[]>(() => {
    const defaults = defaultGlobalPeriodCodes(FALLBACK_PERIODS, DEFAULT_YEAR_PREFIX);
    return defaults.length ? defaults : FALLBACK_PERIODS.map((item) => item.code);
  });
  const [singleMoment, setSingleMoment] = useState<Moment>('1');
  const [selectedMoments, setSelectedMoments] = useState<Moment[]>(['MD1', '1']);
  const [selectedCoordinatorId, setSelectedCoordinatorId] = useState('ALL');
  const [limit, setLimit] = useState('300');
  const [forceTo, setForceTo] = useState('');
  const [globalRecipientName, setGlobalRecipientName] = useState('');
  const [globalRecipientsRaw, setGlobalRecipientsRaw] = useState('');
  const [regenerateBeforeSend, setRegenerateBeforeSend] = useState(true);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<OperationResponse | null>(null);
  const [lastGeneratedIds, setLastGeneratedIds] = useState<string[]>([]);
  const [generatedPreviewItems, setGeneratedPreviewItems] = useState<GeneratedPreviewItem[]>([]);
  const [activeGeneratedPreviewId, setActiveGeneratedPreviewId] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      try {
        const normalizedYearPrefix = yearPrefix.trim() || DEFAULT_YEAR_PREFIX;
        const response = await fetchJson<OptionsResponse>(
          `${apiBase}/outbox/options?yearPrefix=${encodeURIComponent(normalizedYearPrefix)}`,
        );
        if (!active) return;
        setOptions(response);
        const defaultPeriods = defaultGlobalPeriodCodes(response.periods, normalizedYearPrefix);
        setSelectedPeriodCodes(defaultPeriods.length ? defaultPeriods : response.periods.map((item) => item.code));
        setSinglePeriodCode(defaultPeriods[0] || defaultSinglePeriodCode(response.periods, normalizedYearPrefix));
        setSelectedCoordinatorId((current) =>
          current === 'ALL' || response.coordinators.some((item) => item.id === current) ? current : 'ALL',
        );
      } catch (error) {
        if (!active) return;
        setOptionsError(error instanceof Error ? error.message : String(error));
      }
    }
    void loadOptions();
    return () => {
      active = false;
    };
  }, [apiBase, yearPrefix]);

  const periodOptions = options?.periods?.length ? options.periods : FALLBACK_PERIODS;
  const coordinatorOptions = options?.coordinators ?? [];
  const momentOptions = options?.supportedMoments ?? FALLBACK_MOMENTS;
  const multiMomentMode = audience === 'COORDINADOR' || audience === 'GLOBAL';
  const multiPeriodMode = audience === 'COORDINADOR' || audience === 'GLOBAL';
  const effectiveMoments = multiMomentMode
    ? (selectedMoments.length ? selectedMoments : [singleMoment])
    : [singleMoment];
  const effectivePeriodCodes = multiPeriodMode
    ? (selectedPeriodCodes.length ? selectedPeriodCodes : [singlePeriodCode])
    : [singlePeriodCode];
  const selectedCoordinator =
    audience === 'COORDINADOR' && selectedCoordinatorId !== 'ALL'
      ? coordinatorOptions.find((item) => item.id === selectedCoordinatorId) ?? null
      : null;

  function applyAnnualPreset() {
    const presetPeriods = defaultGlobalPeriodCodes(periodOptions, yearPrefix.trim() || DEFAULT_YEAR_PREFIX);
    setSelectedPeriodCodes(presetPeriods.length ? presetPeriods : periodOptions.map((item) => item.code));
    setSelectedMoments(['MD1', '1']);
  }

  function toggleMoment(value: Moment) {
    setSelectedMoments((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value);
        return next.length ? next : [value];
      }
      return [...current, value];
    });
  }

  function togglePeriod(code: string) {
    setSelectedPeriodCodes((current) => {
      if (current.includes(code)) {
        const next = current.filter((item) => item !== code);
        return next.length ? next : [code];
      }
      return [...current, code];
    });
  }

  async function loadPreview(messageId: string) {
    try {
      setPreviewLoading(true);
      setPreviewError('');
      setPreviewData(null);
      setActiveGeneratedPreviewId(messageId);
      const response = await fetchJson<PreviewResponse>(`${apiBase}/outbox/${messageId}/preview`);
      setPreviewData(response);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  }

  function buildMomentPayload() {
    return effectiveMoments.length > 1
      ? { moments: effectiveMoments }
      : { moment: effectiveMoments[0] };
  }

  function buildPeriodPayload() {
    return multiPeriodMode && effectivePeriodCodes.length > 1
      ? { periodCode: effectivePeriodCodes[0], periodCodes: effectivePeriodCodes }
      : { periodCode: effectivePeriodCodes[0] };
  }

  function buildGeneratePayload() {
    const payload: Record<string, unknown> = {
      ...buildPeriodPayload(),
      phase,
      audience,
      ...buildMomentPayload(),
    };

    if (audience === 'COORDINADOR' && selectedCoordinatorId !== 'ALL') {
      payload.coordinatorId = selectedCoordinatorId;
    }

    if (audience === 'GLOBAL') {
      const recipientEmails = parseRecipientEmails(globalRecipientsRaw);
      if (globalRecipientName.trim()) payload.recipientName = globalRecipientName.trim();
      if (recipientEmails.length) payload.recipientEmails = recipientEmails;
    }

    return payload;
  }

  function buildSendPayload(dryRun: boolean, idsOverride?: string[]) {
    const parsedLimit = Number(limit);
    const selectedIds = idsOverride?.length ? idsOverride : lastGeneratedIds;
    const payload: Record<string, unknown> = {
      ...buildPeriodPayload(),
      phase,
      audience,
      status,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 300,
      dryRun,
      ...buildMomentPayload(),
    };
    if (selectedIds.length) payload.ids = selectedIds;
    if (audience === 'COORDINADOR' && selectedCoordinatorId !== 'ALL') payload.coordinatorId = selectedCoordinatorId;
    if (forceTo.trim()) payload.forceTo = forceTo.trim();
    return payload;
  }

  async function generateDrafts() {
    const data = await fetchJson<OperationResponse>(`${apiBase}/outbox/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeneratePayload()),
    });
    const generatedIds = collectGeneratedIds(data);
    const previewItems = data.previewItems ?? [];
    setLastGeneratedIds(generatedIds);
    setGeneratedPreviewItems(previewItems);
    if (previewItems.length) {
      const preferredPreviewId =
        previewItems.find((item) => item.coordinatorId === selectedCoordinatorId)?.id ??
        previewItems[0]?.id;
      if (preferredPreviewId) {
        void loadPreview(preferredPreviewId);
      }
    } else {
      setActiveGeneratedPreviewId('');
      setPreviewData(null);
      setPreviewError('');
    }
    setResult(data);
    const momentsNote =
      Array.isArray(data.moments) && data.moments.length
        ? ` | Momentos: ${data.moments.join(', ')}`
        : '';
    const activePeriodCodes = Array.isArray(data.previewItems) && data.previewItems.length
      ? [...new Set((data.previewItems as Array<{ periodCodes?: string[] }>).flatMap((item) => item.periodCodes ?? []))]
      : (Array.isArray(data.periodCodes) ? data.periodCodes : []);
    const periodsNote = activePeriodCodes.length ? ` | Periodos: ${activePeriodCodes.join(', ')}` : '';
    setMessage(`Borradores generados: ${data.created ?? 0}${momentsNote}${periodsNote}`);
    return data;
  }

  async function runSend(dryRun: boolean, idsOverride?: string[]) {
    const data = await fetchJson<OperationResponse>(`${apiBase}/outbox/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSendPayload(dryRun, idsOverride)),
    });
    setResult(data);
    if (dryRun) {
      setMessage(`Previsualizacion completada. Candidatos: ${data.candidates ?? 0}`);
    } else {
      const deliveryMode = data.deliveryMode ? ` | Modo: ${data.deliveryMode}` : '';
      const reason = data.reason ? ` | Nota: ${data.reason}` : '';
      setMessage(
        `Envio completado. Enviados: ${data.sentCount ?? 0} | Fallidos: ${data.failedCount ?? 0} | Omitidos: ${data.skippedCount ?? 0}${deliveryMode}${reason}`,
      );
    }
    return data;
  }

  async function runCampaign(dryRun: boolean) {
    try {
      setBusy(true);
      setMessage('');
      setResult(null);

      let generatedIds = lastGeneratedIds;
      if (regenerateBeforeSend || !lastGeneratedIds.length) {
        const generated = await generateDrafts();
        generatedIds = collectGeneratedIds(generated);
      }

      if (!dryRun) {
        const confirmed = window.confirm(
          `Se enviaran correos de ${audience} con periodos ${effectivePeriodCodes.join(', ')} y momentos ${effectiveMoments.join(', ')}. Continuar?`,
        );
        if (!confirmed) return;
      }

      await runSend(dryRun, generatedIds);
    } catch (error) {
      setMessage(`No fue posible procesar la campana: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onlyGenerate() {
    try {
      setBusy(true);
      setMessage('');
      setResult(null);
      await generateDrafts();
    } catch (error) {
      setMessage(`No fue posible generar borradores: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendSelectedDraft() {
    const messageId = activeGeneratedPreviewId || generatedPreviewItems[0]?.id;
    if (!messageId) {
      setMessage('Primero genera un borrador y abre su preview.');
      return;
    }

    const confirmed = window.confirm(
      `Se enviara el borrador seleccionado${selectedCoordinator ? ` a ${selectedCoordinator.fullName}` : ''}. Continuar?`,
    );
    if (!confirmed) return;

    try {
      setBusy(true);
      setMessage('');
      setResult(null);
      await runSend(false, [messageId]);
    } catch (error) {
      setMessage(`No fue posible enviar el borrador seleccionado: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel">
      <h2>Campanas de correo</h2>
      <div className="actions">
        Desde aqui puedes generar y enviar coordinadores por lote o construir el reporte global en un solo correo.
      </div>
      <div className="actions" style={{ marginTop: 6 }}>
        Coordinadores y reporte global permiten seleccionar varios periodos del ano base y varios momentos al mismo tiempo.
      </div>
      <div className="actions" style={{ marginTop: 6 }}>
        Seleccion predeterminada consolidada: <span className="code">MD1 + 1</span> y todos los periodos del ano cargado, excepto sufijos <span className="code">80</span> y <span className="code">85</span>.
      </div>

      {optionsError ? <div className="message">No fue posible cargar opciones de periodos: {optionsError}</div> : null}

      <div className="controls" style={{ marginTop: 10 }}>
        <label>
          Audiencia
          <select value={audience} onChange={(event) => setAudience(event.target.value as Audience)}>
            <option value="DOCENTE">DOCENTE</option>
            <option value="COORDINADOR">COORDINADOR</option>
            <option value="GLOBAL">GLOBAL</option>
          </select>
        </label>
        <label>
          Fase
          <select value={phase} onChange={(event) => setPhase(event.target.value as Phase)}>
            <option value="ALISTAMIENTO">ALISTAMIENTO</option>
            <option value="EJECUCION">EJECUCION</option>
          </select>
        </label>
        <label>
          Estado origen
          <select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
            <option value="DRAFT">DRAFT</option>
            <option value="EXPORTED">EXPORTED</option>
          </select>
        </label>
        <label>
          Limite
          <input value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="300" />
        </label>
        <label>
          Ano base
          <input
            value={yearPrefix}
            onChange={(event) => setYearPrefix(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            placeholder={DEFAULT_YEAR_PREFIX}
          />
        </label>
      </div>

      {audience === 'COORDINADOR' ? (
        <>
          <div className="controls" style={{ marginTop: 10 }}>
            <label style={{ minWidth: 420 }}>
              Coordinacion especifica
              <select value={selectedCoordinatorId} onChange={(event) => setSelectedCoordinatorId(event.target.value)}>
                <option value="ALL">Todas las coordinaciones que apliquen</option>
                {coordinatorOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.programId} | {item.fullName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            {selectedCoordinator
              ? `Se generara solo el consolidado de ${selectedCoordinator.programId} para ${selectedCoordinator.fullName}.`
              : 'Si no eliges una coordinacion puntual, el sistema generara el lote completo de coordinadores.'}
          </div>
        </>
      ) : null}

      {!multiPeriodMode ? (
        <div className="controls" style={{ marginTop: 10 }}>
          <label>
            Periodo
            <select value={singlePeriodCode} onChange={(event) => setSinglePeriodCode(event.target.value)}>
              {periodOptions.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} | {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 8 }}>
            Periodos {yearPrefix || DEFAULT_YEAR_PREFIX} incluidos en la campana ({effectivePeriodCodes.length} seleccionados)
          </div>
          <div className="badges">
            {periodOptions.map((item) => {
              const active = effectivePeriodCodes.includes(item.code);
              return (
                <button
                  key={item.code}
                  type="button"
                  className="badge"
                  onClick={() => togglePeriod(item.code)}
                  style={{
                    cursor: 'pointer',
                    border: active ? '1px solid #0057a4' : '1px solid #d4d7dd',
                    background: active ? '#e8f0fb' : '#fff',
                    color: active ? '#0a3e74' : '#334155',
                    fontWeight: active ? 700 : 600,
                  }}
                >
                  {item.code} | {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!multiMomentMode ? (
        <div className="controls" style={{ marginTop: 10 }}>
          <label>
            Momento
            <select value={singleMoment} onChange={(event) => setSingleMoment(event.target.value as Moment)}>
              {momentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value} ({option.label})
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 8 }}>
            Momentos seleccionados para la campana
          </div>
          <div className="badges">
            {momentOptions.map((option) => {
              const active = effectiveMoments.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className="badge"
                  onClick={() => toggleMoment(option.value)}
                  style={{
                    cursor: 'pointer',
                    border: active ? '1px solid #0057a4' : '1px solid #d4d7dd',
                    background: active ? '#e8f0fb' : '#fff',
                    color: active ? '#0a3e74' : '#334155',
                    fontWeight: active ? 700 : 600,
                  }}
                >
                  {option.value} ({option.label})
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="controls" style={{ marginTop: 10 }}>
        <label style={{ minWidth: 320 }}>
          Forzar destinatario (prueba)
          <input
            value={forceTo}
            onChange={(event) => setForceTo(event.target.value)}
            placeholder="correo.prueba@dominio.edu"
          />
        </label>
        <label style={{ minWidth: 260 }}>
          Regenerar antes de enviar
          <select
            value={regenerateBeforeSend ? 'SI' : 'NO'}
            onChange={(event) => setRegenerateBeforeSend(event.target.value === 'SI')}
          >
            <option value="SI">SI</option>
            <option value="NO">NO</option>
          </select>
        </label>
      </div>

      {audience === 'GLOBAL' ? (
        <>
          <div className="controls" style={{ marginTop: 10 }}>
            <button type="button" style={{ background: '#f3f4f6', color: '#111827' }} onClick={applyAnnualPreset} disabled={busy}>
              Usar preset anual {yearPrefix || DEFAULT_YEAR_PREFIX}
            </button>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            El preset anual selecciona todos los periodos del ano cargado excepto <span className="code">80</span> y <span className="code">85</span>, y deja los momentos <span className="code">MD1 + 1</span> para construir un solo correo final del ano.
          </div>
          <div className="controls" style={{ marginTop: 10 }}>
            <label style={{ minWidth: 320 }}>
              Nombre visible del reporte global
              <input
                value={globalRecipientName}
                onChange={(event) => setGlobalRecipientName(event.target.value)}
                placeholder="Equipo directivo"
              />
            </label>
            <label style={{ minWidth: 480 }}>
              Destinatarios del reporte global
              <textarea
                value={globalRecipientsRaw}
                onChange={(event) => setGlobalRecipientsRaw(event.target.value)}
                placeholder={'correo1@dominio.edu\ncorreo2@dominio.edu\ncorreo3@dominio.edu'}
                rows={4}
              />
            </label>
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            Agrega varios correos separados por salto de linea, coma o punto y coma. El global se genera en un solo mensaje y se envia a todos esos destinatarios a la vez.
          </div>
        </>
      ) : null}

      <div className="controls" style={{ marginTop: 10 }}>
        <button type="button" className="primary" onClick={() => void onlyGenerate()} disabled={busy}>
          {busy ? 'Procesando...' : 'Generar borradores'}
        </button>
        <button type="button" className="primary" onClick={() => void runCampaign(true)} disabled={busy}>
          {busy ? 'Procesando...' : 'Generar + previsualizar envio'}
        </button>
        <button type="button" className="btn-next-action" onClick={() => void runCampaign(false)} disabled={busy}>
          {busy ? 'Enviando...' : 'Generar + enviar ahora'}
        </button>
      </div>

      <div className="actions" style={{ marginTop: 8 }}>
        {audience === 'COORDINADOR'
          ? 'Cada coordinador recibira un solo correo consolidado con los periodos y momentos seleccionados.'
          : 'El reporte global quedara en un solo correo consolidado. Luego puedes abrir su preview en /correos filtrando por audiencia GLOBAL.'}
      </div>

      {message ? <div className="message">{message}</div> : null}

      {audience === 'COORDINADOR' && generatedPreviewItems.length ? (
        <div style={{ marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          <p style={{ margin: '0 0 10px', fontSize: '0.875rem', color: '#374151', fontWeight: 600 }}>
            Borradores generados — selecciona uno para ver el preview:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, margin: '8px 0' }}>
            {generatedPreviewItems.map((item) => {
              const active = activeGeneratedPreviewId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="badge"
                  onClick={() => void loadPreview(item.id)}
                  style={{
                    cursor: 'pointer',
                    border: active ? '2px solid #0057a4' : '1px solid #d4d7dd',
                    background: active ? '#e8f0fb' : '#fff',
                    color: active ? '#0a3e74' : '#334155',
                    fontWeight: active ? 700 : 500,
                    fontSize: '0.8125rem',
                    padding: '6px 10px',
                    textAlign: 'left',
                    lineHeight: 1.4,
                  }}
                >
                  {item.programId ?? 'COORD'}<br />
                  <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '0.75rem' }}>{item.recipientName}</span>
                </button>
              );
            })}
          </div>

          {previewLoading ? <div className="message" style={{ marginTop: 12 }}>Cargando preview...</div> : null}
          {previewError ? <div className="message" style={{ marginTop: 12 }}>No fue posible cargar el preview: {previewError}</div> : null}

          {previewData ? (
            <div className="panel" style={{ marginTop: 12 }}>
              <div className="panel-heading">
                <h2>Preview del correo seleccionado</h2>
                <div className="button-row" style={{ marginTop: 0 }}>
                  <button type="button" style={{ background: '#f3f4f6', color: '#111827' }} onClick={() => void loadPreview(previewData.id)} disabled={busy}>
                    Refrescar preview
                  </button>
                  <button type="button" className="btn-next-action" onClick={() => void sendSelectedDraft()} disabled={busy}>
                    {busy ? 'Enviando...' : 'Enviar borrador seleccionado'}
                  </button>
                </div>
              </div>
              <div className="outbox-mail-kv-grid" style={{ marginBottom: 10 }}>
                <div><strong>Destinatario:</strong> {previewData.recipientName ?? 'Sin nombre'}</div>
                <div><strong>Correo:</strong> {previewData.recipientEmail ?? 'sin-correo@invalid.local'}</div>
                <div><strong>Periodo:</strong> {previewData.periodCode}</div>
                <div><strong>Fase:</strong> {previewData.phase}</div>
                <div><strong>Momento:</strong> {previewData.moment}</div>
                <div><strong>Estado:</strong> {previewData.status}</div>
              </div>
              <iframe
                title={`coordinator-preview-${previewData.id}`}
                srcDoc={previewData.htmlBody}
                style={{
                  width: '100%',
                  minHeight: '70vh',
                  border: '1px solid #d4d7dd',
                  borderRadius: 12,
                  background: '#fff',
                }}
                sandbox="allow-popups allow-same-origin"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
