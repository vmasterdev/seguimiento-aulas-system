import type { ReactNode } from 'react';

export const metadata = {
  title: 'Directorio de Personal — UNIMINUTO',
  description: 'Encuentra la persona o el servicio que necesitas en la universidad.',
};

export default function DirectorioPublicoLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#eef2f7',
        overflowY: 'auto',
      }}
    >
      {children}
    </div>
  );
}
