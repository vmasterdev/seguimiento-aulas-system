export const dynamic = 'force-dynamic';

import { ReviewPanel } from '../review-panel';

const API_BASE = '/api/backend';
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
    <main style={{ width: 'min(560px, 95vw)', margin: '16px auto' }}>
      <ReviewPanel
        apiBase={API_BASE}
        compact
        initialPeriodCode={periodCode}
        initialMoment={moment}
        initialPhase={phase}
        initialCategory={category}
        initialMoodleUrlTemplate={MOODLE_URL_TEMPLATE}
      />
    </main>
  );
}
