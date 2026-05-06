export const dynamic = 'force-dynamic';

import { HorariosPanel } from '../../_features/horarios/horarios-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function Page() {
  return (
    <SinglePanelPageShell active="horarios" title="Horarios" description="Vistas de horarios de clase para estudiantes, docentes, coordinaciones y direccion academica.">
      <HorariosPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
