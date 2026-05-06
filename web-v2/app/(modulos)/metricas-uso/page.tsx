export const dynamic = 'force-dynamic';

import { MetricsPanel } from '../../_features/metricas/metrics-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function Page() {
  return (
    <SinglePanelPageShell active="metricas-uso" title="Metricas de uso" description="Carga de sedes y salones, ocupacion semanal y heatmap dia/hora.">
      <MetricsPanel apiBase={CLIENT_API_BASE} />
    </SinglePanelPageShell>
  );
}
