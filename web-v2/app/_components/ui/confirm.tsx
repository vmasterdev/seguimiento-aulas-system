'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal } from './modal';
import { Button } from './button';

export interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estilo del botón de confirmación */
  tone?: 'primary' | 'danger';
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingState extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);
  const pendingRef = useRef<PendingState | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const p = pendingRef.current;
    if (p) p.resolve(value);
    setPending(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => settle(false)}
        title={pending?.title ?? 'Confirmar acción'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => settle(false)}>
              {pending?.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button
              variant={pending?.tone === 'danger' ? 'danger' : 'primary'}
              size="sm"
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        <div style={{ lineHeight: 1.55, color: 'var(--text-secondary)' }}>{pending?.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
  return ctx;
}
