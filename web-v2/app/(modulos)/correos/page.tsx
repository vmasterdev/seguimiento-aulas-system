export const dynamic = 'force-dynamic';

import { OutboxTrackingPanel } from '../../_features/correos/outbox-tracking-panel';
import { OutboxEmailPanel } from '../../_features/correos/outbox-email-panel';
import { ImmersionInvitationPanel } from '../../_features/correos/immersion-invitation-panel';
import { PageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

export default function CorreosPage() {
  return (
    <PageShell
      active="correos"
      title="Trazabilidad de Correos"
      description="Consulta visual de correos generados, enviados y ultimo resultado de envio por destinatario."
    >
      <section className="section section-single">
        <ImmersionInvitationPanel apiBase={CLIENT_API_BASE} />
      </section>

      <section className="section section-single">
        <OutboxEmailPanel apiBase={CLIENT_API_BASE} />
      </section>

      <section className="section section-single">
        <OutboxTrackingPanel apiBase={CLIENT_API_BASE} />
      </section>
    </PageShell>
  );
}
