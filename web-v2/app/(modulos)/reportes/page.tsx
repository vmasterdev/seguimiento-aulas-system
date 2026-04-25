export const dynamic = 'force-dynamic';

import { CierrePanel } from '../../_features/reportes/cierre-panel';
import { PageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function ReportesPage() {
  return (
    <PageShell
      active="reportes"
      title="Reportes de Cierre"
      description="Genera reportes profesionales de cierre de momento, semestre y año para docentes, coordinaciones y directivos."
    >
      <section className="section section-single">
        <CierrePanel apiBase={CLIENT_API_BASE} />
      </section>
    </PageShell>
  );
}
