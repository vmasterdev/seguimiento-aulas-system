export const dynamic = 'force-dynamic';

import { ReviewPanel } from '../../_features/review/review-panel';
import { SinglePanelPageShell } from '../../_components/page-shell';
import { CLIENT_API_BASE } from '../../_lib/api';

const MOODLE_URL_TEMPLATE = process.env.NEXT_PUBLIC_MOODLE_URL_TEMPLATE ?? '';

type Props = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function readParam(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export default function ReviewPage({ searchParams }: Props) {
  const periodCode = readParam(searchParams?.periodCode, '202615');
  const moment = readParam(searchParams?.moment, 'MD1');
  const phaseRaw = readParam(searchParams?.phase, 'ALISTAMIENTO');
  const phase = phaseRaw === 'EJECUCION' ? 'EJECUCION' : 'ALISTAMIENTO';
  const categoryRaw = readParam(searchParams?.category, 'MUESTREO');
  const category = categoryRaw === 'TEMPORAL' ? 'TEMPORAL' : 'MUESTREO';

  return (
    <SinglePanelPageShell
      active="review"
      title="Revision Manual de NRC"
      description="Carga una cola de revision, abre Moodle y guarda la evaluacion manual del NRC seleccionado."
      hideHeader={false}
    >
      <ReviewPanel
        apiBase={CLIENT_API_BASE}
        initialPeriodCode={periodCode}
        initialMoment={moment}
        initialPhase={phase}
        initialCategory={category}
        initialMoodleUrlTemplate={MOODLE_URL_TEMPLATE}
      />
    </SinglePanelPageShell>
  );
}
