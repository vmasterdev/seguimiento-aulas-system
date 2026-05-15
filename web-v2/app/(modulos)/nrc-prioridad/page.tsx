export const dynamic = 'force-dynamic';

import { NrcPrioridadPanel } from '../../_features/nrc-prioridad/nrc-prioridad-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function NrcPrioridadPage() {
  return (
    <SinglePanelPageShell
      active="nrc-prioridad"
      title="Prioridad de NRC"
      description="Vista de NRC ordenados por urgencia de calendario. Filtra por activos, cortos o urgentes."
      hideHeader={false}
    >
      <NrcPrioridadPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
