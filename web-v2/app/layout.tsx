import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from './_components/main-menu';

export const metadata: Metadata = {
  title: 'Seguimiento de Aulas',
  description: 'Panel de seguimiento operativo para aulas Moodle — UNIMINUTO',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="app-layout">
          <Sidebar />
          <div className="app-content">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
