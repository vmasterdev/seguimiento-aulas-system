export const dynamic = 'force-dynamic';

import { DirectorioPanel } from '../../_features/directorio/directorio-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function DirectorioPersonalPage() {
  return (
    <SinglePanelPageShell
      active="directorio-personal"
      title="Directorio de Personal"
      description="Gestión del directorio público: horarios, contacto y trámites que atiende cada persona."
    >
      <DirectorioPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
