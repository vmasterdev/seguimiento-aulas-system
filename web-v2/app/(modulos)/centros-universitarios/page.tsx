export const dynamic = 'force-dynamic';

import { CenterDirectorsPanel } from '../../_features/centros/center-directors-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function CentrosPage() {
  return (
    <SinglePanelPageShell
      active="centros-universitarios"
      title="Centros universitarios"
      description="Gestion de directores de centro universitario y reportes por centro."
    >
      <CenterDirectorsPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
