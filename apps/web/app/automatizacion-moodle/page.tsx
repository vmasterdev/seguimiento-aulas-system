export const dynamic = 'force-dynamic';

import { SinglePanelPageShell } from '../_components/page-shell';
import { SidecarIntegrationPanel } from '../_features/sidecar/sidecar-integration-panel';
import { CLIENT_API_BASE } from '../_lib/api';

export default function AutomatizacionMoodlePage() {
  return (
    <SinglePanelPageShell
      active="automatizacion-moodle"
      title="Automatizacion Moodle"
      description="Lanza revisiones automaticas de aulas en Moodle, sigue el avance del proceso e importa el resultado a la base de datos."
    >
      <SidecarIntegrationPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
