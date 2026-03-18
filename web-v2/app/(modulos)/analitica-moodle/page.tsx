export const dynamic = 'force-dynamic';

import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';
import MoodleAnalyticsPanel from '../../_features/moodle-analytics/moodle-analytics-panel';

export default function AnaliticaMoodlePage() {
  return (
    <SinglePanelPageShell
      active="analitica-moodle"
      title="Analitica Moodle"
      description="Explora asistencia, inasistencia y actividad del aula con filtros ejecutivos y reportes puntuales por fecha."
    >
      <MoodleAnalyticsPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
