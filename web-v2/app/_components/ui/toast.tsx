'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type ToastTone = 'info' | 'success' | 'warn' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** ms antes de auto-cerrar. 0 = persistente */
  duration?: number;
  title?: string;
}

interface ToastItem {
  id: number;
  message: React.ReactNode;
  tone: ToastTone;
  title?: string;
}

interface ToastApi {
  show: (message: React.ReactNode, opts?: ToastOptions) => number;
  success: (message: React.ReactNode, opts?: Omit<ToastOptions, 'tone'>) => number;
  error: (message: React.ReactNode, opts?: Omit<ToastOptions, 'tone'>) => number;
  warn: (message: React.ReactNode, opts?: Omit<ToastOptions, 'tone'>) => number;
  info: (message: React.ReactNode, opts?: Omit<ToastOptions, 'tone'>) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<ToastTone, string> = {
  info: 'ℹ',
  success: '✓',
  warn: '!',
  error: '✕',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: React.ReactNode, opts: ToastOptions = {}) => {
      const id = ++idRef.current;
      const tone = opts.tone ?? 'info';
      const duration = opts.duration ?? (tone === 'error' ? 6000 : 4000);
      setToasts((prev) => [...prev, { id, message, tone, title: opts.title }]);
      if (duration > 0) {
        const t = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, t);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api: ToastApi = {
    show,
    success: (m, o) => show(m, { ...o, tone: 'success' }),
    error: (m, o) => show(m, { ...o, tone: 'error' }),
    warn: (m, o) => show(m, { ...o, tone: 'warn' }),
    info: (m, o) => show(m, { ...o, tone: 'info' }),
    dismiss,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ds-toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`ds-toast ds-toast-${t.tone}`} role="status">
            <span className="ds-toast-icon">{TONE_ICON[t.tone]}</span>
            <div className="ds-toast-content">
              {t.title && <strong className="ds-toast-title">{t.title}</strong>}
              <div className="ds-toast-msg">{t.message}</div>
            </div>
            <button
              type="button"
              className="ds-toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar notificación"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <style jsx>{`
        .ds-toast-stack {
          position: fixed;
          bottom: 20px;
          right: 20px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          z-index: 1100;
          max-width: min(380px, calc(100vw - 40px));
        }
        .ds-toast {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          border-radius: 12px;
          background: var(--surface);
          border: 1px solid var(--line);
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
          animation: ds-toast-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
          border-left-width: 4px;
        }
        .ds-toast-info { border-left-color: var(--blue-800); }
        .ds-toast-success { border-left-color: var(--green-saturated); }
        .ds-toast-warn { border-left-color: var(--amber-600); }
        .ds-toast-error { border-left-color: var(--red-darker); }
        .ds-toast-icon {
          flex-shrink: 0;
          width: 20px;
          height: 20px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 800;
          color: var(--text-inverse);
        }
        .ds-toast-info .ds-toast-icon { background: var(--blue-800); }
        .ds-toast-success .ds-toast-icon { background: var(--green-saturated); }
        .ds-toast-warn .ds-toast-icon { background: var(--amber-600); }
        .ds-toast-error .ds-toast-icon { background: var(--red-darker); }
        .ds-toast-content {
          flex: 1;
          min-width: 0;
        }
        .ds-toast-title {
          display: block;
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--primary);
          margin-bottom: 2px;
        }
        .ds-toast-msg {
          font-size: 0.8rem;
          color: var(--text-secondary);
          line-height: 1.45;
          word-wrap: break-word;
        }
        .ds-toast-close {
          flex-shrink: 0;
          background: transparent;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          font-size: 12px;
          padding: 2px 4px;
          border-radius: 6px;
          transition: all 130ms;
        }
        .ds-toast-close:hover {
          background: rgba(15, 23, 42, 0.06);
          color: var(--n-600);
        }
        @keyframes ds-toast-in {
          from { opacity: 0; transform: translateX(24px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}
