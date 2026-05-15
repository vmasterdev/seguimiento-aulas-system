'use client';

import React, { useEffect, useId, useRef } from 'react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  size?: ModalSize;
  /** Oculta el botón de cierre y deshabilita cerrar por overlay/Escape */
  dismissible?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Sin padding en el cuerpo (para iframes, tablas full-bleed) */
  bodyless?: boolean;
}

const SIZE_WIDTH: Record<ModalSize, string> = {
  sm: 'min(420px, 96vw)',
  md: 'min(620px, 96vw)',
  lg: 'min(860px, 96vw)',
  xl: 'min(1140px, 97vw)',
  full: '97vw',
};

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  dismissible = true,
  footer,
  children,
  bodyless = false,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) { onClose(); return; }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),textarea,input,select,[tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }, 10);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      className="ds-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        style={{ width: SIZE_WIDTH[size], maxHeight: size === 'full' ? '95vh' : '92vh' }}
      >
        {(title || dismissible) && (
          <header className="ds-modal-header">
            <strong id={titleId} className="ds-modal-title">{title}</strong>
            {dismissible && (
              <button type="button" className="ds-modal-close" onClick={onClose} title="Cerrar" aria-label="Cerrar">
                ✕
              </button>
            )}
          </header>
        )}
        <div className={bodyless ? 'ds-modal-body-bare' : 'ds-modal-body'}>{children}</div>
        {footer && <footer className="ds-modal-footer">{footer}</footer>}
      </div>

      <style jsx>{`
        .ds-modal-overlay {
          position: fixed;
          inset: 0;
          background: var(--overlay-dark);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 1000;
          animation: ds-modal-fade 140ms ease-out;
        }
        .ds-modal {
          background: var(--surface);
          border-radius: 16px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.28);
          animation: ds-modal-pop 160ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .ds-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 18px;
          border-bottom: 1px solid var(--line);
          flex-shrink: 0;
        }
        .ds-modal-title {
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--primary);
          letter-spacing: -0.01em;
        }
        .ds-modal-close {
          background: transparent;
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 4px 10px;
          font-size: 14px;
          cursor: pointer;
          color: var(--text-muted-2);
          transition: all 130ms;
          flex-shrink: 0;
        }
        .ds-modal-close:hover {
          background: var(--red-light);
          border-color: var(--red-100);
          color: var(--red-darker);
        }
        .ds-modal-close:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: 2px;
        }
        .ds-modal-body {
          padding: 18px;
          overflow-y: auto;
          font-size: 0.85rem;
          color: var(--ink);
        }
        .ds-modal-body-bare {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .ds-modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 18px;
          border-top: 1px solid var(--line);
          background: var(--footer-bg);
          flex-shrink: 0;
        }
        @keyframes ds-modal-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes ds-modal-pop {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
