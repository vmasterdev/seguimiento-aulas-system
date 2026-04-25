export const dynamic = 'force-dynamic';

import { BannerDocentesPanel } from '../../_features/banner-docentes/banner-docentes-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function BannerDocentesPage() {
  return (
    <SinglePanelPageShell
      active="banner-docentes"
      title="Docentes Banner"
      description="NRCs donde Banner identifico un docente. Visualiza el estado de vinculacion y agrega docentes a la base local."
    >
      <BannerDocentesPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
