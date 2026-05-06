export const dynamic = 'force-dynamic';

import { RecargosPanel } from '../../_features/recargos/recargos-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function Page() {
  return (
    <SinglePanelPageShell active="recargos-nocturnos" title="Recargos nocturnos" description="Calculo y exportacion de horas en franja nocturna por docente, programa y centro.">
      <RecargosPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
