export const dynamic = 'force-dynamic';

import { NrcGlobalPanel } from '../_features/nrc/nrc-global-panel';
import { SinglePanelPageShell } from '../_components/page-shell';
import { CLIENT_API_BASE } from '../_lib/api';

export default function NrcGlobalesPage() {
  return (
    <SinglePanelPageShell
      active="nrc-globales"
      title="NRC Globales"
      description="Vista unica para filtrar, buscar por similitud y descargar listados de NRC."
    >
      <NrcGlobalPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
