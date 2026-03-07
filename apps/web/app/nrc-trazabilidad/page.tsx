export const dynamic = 'force-dynamic';

import { NrcTracePanel } from '../nrc-trace-panel';
import { MainMenu } from '../main-menu';

const API_BASE = '/api/backend';

export default function NrcTracePage() {
  return (
    <main>
      <MainMenu active="nrc-trazabilidad" />

      <header className="hero">
        <div>
          <h1>Trazabilidad de Replicacion</h1>
          <p>Busca un NRC y valida visualmente si su evaluacion fue manual, replicada o replico a otros NRC.</p>
        </div>
      </header>

      <section className="section section-single">
        <NrcTracePanel apiBase={API_BASE} />
      </section>
    </main>
  );
}
