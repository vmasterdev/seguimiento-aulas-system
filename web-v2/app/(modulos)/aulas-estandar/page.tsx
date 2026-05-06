export const dynamic = 'force-dynamic';

import { StandardClassroomsPanel } from '../../_features/aulas-estandar/standard-classrooms-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function Page() {
  return (
    <SinglePanelPageShell active="aulas-estandar" title="Aulas estandar" description="Repositorio de codigos alfanumericos y URLs de copia de seguridad por asignatura.">
      <StandardClassroomsPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
