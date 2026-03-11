export const dynamic = 'force-dynamic';

import { RpacaManagementPanel } from '../../_features/rpaca/rpaca-management-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function RpacaPage() {
  return (
    <SinglePanelPageShell
      active="rpaca"
      title="Gestion RPACA"
      description="Carga incremental de RPACA y ajuste manual de docentes faltantes."
    >
      <RpacaManagementPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
