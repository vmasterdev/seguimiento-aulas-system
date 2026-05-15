export const dynamic = 'force-dynamic';

/**
 * TEMPLATE — copiar a (modulos)/<nombre>/page.tsx
 * Renombrar: NombrePage, NombrePanel, sección en active y MainMenuSection
 */

import { NombrePanel } from '../../_features/<nombre>/<nombre>-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function NombrePage() {
  return (
    <SinglePanelPageShell
      active="<nombre>"
      title="Nombre del módulo"
      description="Descripción breve visible en el encabezado de la página."
      hideHeader={false}
    >
      <NombrePanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
