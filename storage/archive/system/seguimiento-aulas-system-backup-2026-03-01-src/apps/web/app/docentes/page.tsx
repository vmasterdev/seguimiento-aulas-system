export const dynamic = 'force-dynamic';

import { TeachersManagementPanel } from '../teachers-management-panel';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export default function TeachersPage() {
  return (
    <main>
      <nav className="menu-main">
        <a href="/" className="menu-link">
          Inicio
        </a>
        <a href="/rpaca" className="menu-link">
          Gestion RPACA
        </a>
        <a href="/docentes" className="menu-link active">
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
          <h1>Docentes</h1>
          <p>Consulta y mantenimiento de la base de docentes (manual o en lote CSV).</p>
        </div>
      </header>

      <section className="section section-single">
        <TeachersManagementPanel apiBase={API_BASE} />
      </section>
    </main>
  );
}
