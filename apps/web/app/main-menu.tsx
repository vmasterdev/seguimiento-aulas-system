'use client';

type MainMenuProps = {
  active: 'inicio' | 'rpaca' | 'docentes' | 'nrc-globales' | 'nrc-trazabilidad' | 'correos';
};

const REVIEW_URL = '/review?periodCode=202615&moment=MD1&phase=ALISTAMIENTO';
const REVIEW_WINDOW_NAME = 'reviewChecklist';

function openReviewPopup() {
  const features = [
    'popup=yes',
    'width=430',
    'height=920',
    'left=32',
    'top=32',
    'location=no',
    'toolbar=no',
    'menubar=no',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');

  const popup = window.open('', REVIEW_WINDOW_NAME, features);
  if (!popup || popup.closed) {
    window.alert('El navegador bloqueó la ventana emergente. Permite pop-ups para localhost.');
    return;
  }

  try {
    popup.name = REVIEW_WINDOW_NAME;
    popup.resizeTo?.(430, 920);
    popup.moveTo?.(32, 32);
    popup.location.replace(REVIEW_URL);
    popup.focus();
  } catch {
    // ignore
  }
}

export function MainMenu({ active }: MainMenuProps) {
  return (
    <nav className="menu-main">
      <a href="/" className={`menu-link${active === 'inicio' ? ' active' : ''}`}>
        Inicio
      </a>
      <a href="/rpaca" className={`menu-link${active === 'rpaca' ? ' active' : ''}`}>
        Gestion RPACA
      </a>
      <a href="/docentes" className={`menu-link${active === 'docentes' ? ' active' : ''}`}>
        Docentes
      </a>
      <a
        href={REVIEW_URL}
        className="menu-link"
        onClick={(event) => {
          if (event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openReviewPopup();
        }}
      >
        Revision
      </a>
      <a href="/nrc-globales" className={`menu-link${active === 'nrc-globales' ? ' active' : ''}`}>
        NRC Globales
      </a>
      <a href="/nrc-trazabilidad" className={`menu-link${active === 'nrc-trazabilidad' ? ' active' : ''}`}>
        Trazabilidad NRC
      </a>
      <a href="/correos" className={`menu-link${active === 'correos' ? ' active' : ''}`}>
        Correos
      </a>
    </nav>
  );
}
