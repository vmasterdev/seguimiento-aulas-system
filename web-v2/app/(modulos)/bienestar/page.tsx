export const dynamic = 'force-dynamic';

import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';
import BienestarAttendancePanel from '../../_features/bienestar/bienestar-attendance-panel';

export default function BienestarPage() {
  return (
    <SinglePanelPageShell
      active="bienestar"
      title="Bienestar"
      description="Genera reportes de asistencia estudiantil para actividades, jornadas, fechas y NRC solicitados por Bienestar Institucional."
    >
      <BienestarAttendancePanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
