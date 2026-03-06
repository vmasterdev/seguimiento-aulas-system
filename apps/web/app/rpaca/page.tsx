export const dynamic = 'force-dynamic';

import { RpacaManagementPanel } from '../rpaca-management-panel';
import { MainMenu } from '../main-menu';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export default function RpacaPage() {
  return (
    <main>
      <MainMenu active="rpaca" />

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
