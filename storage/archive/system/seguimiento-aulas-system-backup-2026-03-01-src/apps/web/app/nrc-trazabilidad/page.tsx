export const dynamic = 'force-dynamic';

import { NrcTracePanel } from '../nrc-trace-panel';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export default function NrcTracePage() {
  return (
    <main>
      <nav className="menu-main">
        <a href="/" className="menu-link">
          Inicio
        </a>
        <a href="/rpaca" className="menu-link">
          Gestion RPACA
        </a>
        <a href="/docentes" className="menu-link">
          Docentes
        </a>
        <a href="/review?periodCode=202615&moment=MD1&phase=ALISTAMIENTO" className="menu-link">
          Revision
        </a>
        <a href="/nrc-trazabilidad" className="menu-link active">
          Trazabilidad NRC
        </a>
      </nav>

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

