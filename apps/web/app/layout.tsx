import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Seguimiento de Aulas Virtuales',
  description: 'Panel de seguimiento operativo para aulas Moodle',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
