export const dynamic = 'force-dynamic';

import { NrcGlobalPanel } from '../../_features/nrc/nrc-global-panel';
import { PageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

/**
 * NRC Globales — Usa PageShell directamente (sin section-single wrapper)
 * para que el panel ocupe el ancho completo con su diseño premium propio.
 */
export default function NrcGlobalesPage() {
  return (
    <PageShell
      active="nrc-globales"
      title="NRC Globales"
      description="Vista centralizada de NRC: busca, filtra, exporta y prepara lotes para Banner."
    >
      <NrcGlobalPanel apiBase={CLIENT_API_BASE} />
    </PageShell>
  );
}
