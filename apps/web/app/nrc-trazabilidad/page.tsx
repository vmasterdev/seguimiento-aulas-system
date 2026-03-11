export const dynamic = 'force-dynamic';

import { NrcTracePanel } from '../_features/nrc/nrc-trace-panel';
import { SinglePanelPageShell } from '../_components/page-shell';
import { CLIENT_API_BASE } from '../_lib/api';

export default function NrcTracePage() {
  return (
    <SinglePanelPageShell
      active="nrc-trazabilidad"
      title="Trazabilidad de Replicacion"
      description="Busca un NRC y valida visualmente si su evaluacion fue manual, replicada o replico a otros NRC."
    >
      <NrcTracePanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
