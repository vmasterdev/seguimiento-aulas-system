export const dynamic = 'force-dynamic';

import { TeachersManagementPanel } from '../_features/docentes/teachers-management-panel';
import { SinglePanelPageShell } from '../_components/page-shell';
import { CLIENT_API_BASE } from '../_lib/api';

export default function TeachersPage() {
  return (
    <SinglePanelPageShell
      active="docentes"
      title="Docentes"
      description="Consulta y mantenimiento de la base de docentes (manual o en lote CSV)."
    >
      <TeachersManagementPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
