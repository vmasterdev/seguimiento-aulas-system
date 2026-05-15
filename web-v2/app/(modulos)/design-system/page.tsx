export const dynamic = 'force-dynamic';

import { PageShell } from '../../_components/page-shell';
import { DesignSystemShowcase } from '../../_features/design-system/showcase';

export default function DesignSystemPage() {
  return (
    <PageShell
      active="design-system"
      title="Design System"
      description="Componentes, tokens y reglas del sistema. Referencia para mantener consistencia en toda la consola."
      hideHeader={false}
    >
      <DesignSystemShowcase />
    </PageShell>
  );
}
