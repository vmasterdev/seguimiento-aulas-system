export const dynamic = 'force-dynamic';

import { TeachersManagementPanel } from '../teachers-management-panel';
import { MainMenu } from '../main-menu';

const API_BASE = '/api/backend';

export default function TeachersPage() {
  return (
    <main>
      <MainMenu active="docentes" />

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
