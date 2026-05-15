'use client';

import React from 'react';
import { ToastProvider } from './toast';
import { ConfirmProvider } from './confirm';

/** Providers globales del DS — montar una sola vez en el layout raíz. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
