export const dynamic = 'force-dynamic';

import { SinglePanelPageShell } from '../_components/page-shell';
import { BannerIntegrationPanel } from '../_features/banner/banner-integration-panel';

export default function AutomatizacionBannerPage() {
  return (
    <SinglePanelPageShell
      active="automatizacion-banner"
      title="Automatizacion Banner"
      description="Consulta NRC en Banner, arma lotes por periodos cargados desde RPACA, exporta resultados e importa el docente encontrado a la base del sistema."
    >
      <BannerIntegrationPanel />
    </SinglePanelPageShell>
  );
}
