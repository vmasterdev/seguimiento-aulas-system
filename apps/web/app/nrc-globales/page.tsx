export const dynamic = 'force-dynamic';

import { NrcGlobalPanel } from '../nrc-global-panel';
import { MainMenu } from '../main-menu';

const API_BASE = '/api/backend';

export default function NrcGlobalesPage() {
  return (
    <main>
      <MainMenu active="nrc-globales" />

      <header className="hero">
        <div>
          <h1>NRC Globales</h1>
          <p>Vista unica para filtrar, buscar por similitud y descargar listados de NRC.</p>
        </div>
      </header>

      <section className="section section-single">
        <NrcGlobalPanel apiBase={API_BASE} />
      </section>
    </main>
  );
}
