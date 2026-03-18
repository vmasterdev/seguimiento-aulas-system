export const dynamic = 'force-dynamic';

import { RpacaManagementPanel } from '../rpaca-management-panel';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export default function RpacaPage() {
  return (
    <main>
      <nav className="menu-main">
        <a href="/" className="menu-link">
          Inicio
        </a>
        <a href="/rpaca" className="menu-link active">
          Gestion RPACA
        </a>
        <a href="/docentes" className="menu-link">
          Docentes
        </a>
        <a href="/review?periodCode=202615&moment=MD1&phase=ALISTAMIENTO" className="menu-link">
          Revision
        </a>
        <a href="/nrc-trazabilidad" className="menu-link">
          Trazabilidad NRC
        </a>
      </nav>

      <header className="hero">
        <div>
          <h1>Gestion RPACA</h1>
          <p>Carga incremental de RPACA y ajuste manual de docentes faltantes.</p>
        </div>
      </header>

      <section className="section section-single">
        <RpacaManagementPanel apiBase={API_BASE} />
      </section>
    </main>
  );
}
