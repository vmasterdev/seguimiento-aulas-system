export const dynamic = 'force-dynamic';

import { EventosSignificativosPanel } from '../../_features/eventos-significativos/eventos-significativos-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function Page() {
  return (
    <SinglePanelPageShell
      active="eventos-significativos"
      title="Eventos significativos"
      description="Registro y trazabilidad de eventos significativos generados a docentes con resultado insatisfactorio. Estado de firma, entrega y cargue en carpeta de la Subdireccion de Docencia."
    >
      <EventosSignificativosPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
