export const dynamic = 'force-dynamic';

import { OutboxTrackingPanel } from '../outbox-tracking-panel';
import { MainMenu } from '../main-menu';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export default function CorreosPage() {
  return (
    <main>
      <MainMenu active="correos" />

      <header className="hero">
        <div>
          <h1>Trazabilidad de Correos</h1>
          <p>Consulta visual de correos generados, enviados y ultimo resultado de envio por destinatario.</p>
        </div>
      </header>

      <section className="section section-single">
        <OutboxTrackingPanel apiBase={API_BASE} />
      </section>
    </main>
  );
}
