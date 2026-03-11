'use client';

type ReviewLauncherPanelProps = {
  initialPeriodCode?: string;
  initialMoment?: 'MD1' | 'MD2' | '1';
  initialPhase?: 'ALISTAMIENTO' | 'EJECUCION';
};

const CHECKLIST_WINDOW_NAME = 'reviewChecklist';

let narrowPopupRef: Window | null = null;

function openChecklistPopupWindow(targetUrl: string, width: number, height: number, left: number, top: number): Window | null {
  const features = [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'location=no',
    'toolbar=no',
    'menubar=no',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');

  const popup = window.open('', CHECKLIST_WINDOW_NAME, features);
  if (!popup || popup.closed) return null;

  try {
    popup.name = CHECKLIST_WINDOW_NAME;
    popup.resizeTo?.(width, height);
    popup.moveTo?.(left, top);
    popup.location.replace(targetUrl);
    popup.focus();
  } catch {
    // ignore
  }

  return popup;
}

export function ReviewLauncherPanel({
  initialPeriodCode = '202615',
  initialMoment = 'MD1',
  initialPhase = 'ALISTAMIENTO',
}: ReviewLauncherPanelProps) {
  function openChecklistPopup() {
    const params = new URLSearchParams({
      periodCode: initialPeriodCode,
      moment: initialMoment,
      phase: initialPhase,
    });
    const targetUrl = `/review?${params.toString()}`;
    const existingPopup = narrowPopupRef && !narrowPopupRef.closed ? narrowPopupRef : null;
    const popup = existingPopup ?? openChecklistPopupWindow(targetUrl, 430, 920, 32, 32);

    if (popup && !popup.closed) {
      narrowPopupRef = popup;
      try {
        if (existingPopup) {
          popup.location.replace(targetUrl);
          popup.resizeTo?.(430, 920);
          popup.moveTo?.(32, 32);
          popup.focus();
        }
      } catch {
        // ignore
      }
      return;
    }

    window.alert('El navegador bloqueó la ventana emergente. Permite pop-ups para localhost.');
  }

  return (
    <article className="panel">
      <h2>Checklist</h2>
      <div className="actions">
        Abre directamente el checklist en ventana emergente para revisar NRC por muestreo.
      </div>
      <div className="badges" style={{ marginTop: 10 }}>
        <span className="badge">Periodo: {initialPeriodCode}</span>
        <span className="badge">Momento: {initialMoment}</span>
        <span className="badge">Fase: {initialPhase}</span>
      </div>
      <div className="controls" style={{ marginTop: 12 }}>
        <button type="button" onClick={openChecklistPopup}>
          Abrir checklist
        </button>
      </div>
    </article>
  );
}
