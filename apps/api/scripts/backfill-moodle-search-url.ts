import { PrismaClient } from '@prisma/client';

type ModalityKey = 'presencial' | 'distancia' | 'posgrados' | 'moocs';

const MODALITY_DISPLAY: Record<ModalityKey, string> = {
  presencial: 'PRESENCIAL',
  distancia: 'DISTANCIA',
  posgrados: 'POSGRADOS',
  moocs: 'MOOCS',
};

const MODALITY_BY_PERIOD: Record<string, ModalityKey[]> = {
  '202610': ['presencial'],
  '202660': ['presencial'],
  '202615': ['distancia'],
  '202665': ['distancia'],
  '202611': ['posgrados'],
  '202661': ['posgrados'],
  '202621': ['posgrados'],
  '202671': ['posgrados'],
  '202641': ['posgrados'],
  '202580': ['moocs'],
};

const MODALITY_BY_NRC_PREFIX: Record<string, ModalityKey> = {
  '10': 'presencial',
  '15': 'distancia',
  '60': 'presencial',
  '65': 'distancia',
  '61': 'posgrados',
  '71': 'posgrados',
  '41': 'posgrados',
  '58': 'moocs',
  '62': 'moocs',
  '86': 'moocs',
};

const BASE_URL_BY_MODALITY: Record<ModalityKey, string> = {
  presencial:
    process.env.MOODLE_BASE_URL_PRESENCIAL?.trim() || 'https://presencial.aulasuniminuto.edu.co',
  distancia:
    process.env.MOODLE_BASE_URL_DISTANCIA?.trim() || 'https://distancia.aulasuniminuto.edu.co',
  posgrados:
    process.env.MOODLE_BASE_URL_POSGRADOS?.trim() || 'https://posgrados.aulasuniminuto.edu.co',
  moocs: process.env.MOODLE_BASE_URL_MOOCS?.trim() || 'https://moocs.aulasuniminuto.edu.co',
};

function uniqueKeepOrder<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizePeriodCode(value: string | null | undefined): string {
  return String(value ?? '').replace(/[^\d]/g, '').slice(0, 6);
}

function getNrcParts(nrc: string): { prefix: string; num: string } {
  const normalized = String(nrc ?? '').trim();
  const match = normalized.match(/^(\d{2})-(\d+)$/);
  if (match) {
    const num = String(Number(match[2]));
    return {
      prefix: match[1],
      num,
    };
  }

  const digits = normalized.replace(/[^\d]/g, '');
  const num = digits ? String(Number(digits.slice(-5))) : '';
  return {
    prefix: '',
    num,
  };
}

function mapPeriodSuffixToNrcPrefix(periodCode: string): string {
  return periodCode.slice(-2);
}

function buildNrcQueries(input: { nrc: string; periodCode: string }): string[] {
  const { num } = getNrcParts(input.nrc);
  if (!num) return [];
  const queries: string[] = [];

  const periodPrefix = mapPeriodSuffixToNrcPrefix(input.periodCode);
  if (periodPrefix) {
    queries.push(`${periodPrefix}-${num}`);
  }

  if (!periodPrefix) {
    queries.push(num);
  }

  return uniqueKeepOrder(queries.filter(Boolean));
}

function inferPreferredModalities(input: { periodCode: string; periodModality: string; nrc: string }): ModalityKey[] {
  const list: ModalityKey[] = [];
  const allModalities = Object.keys(BASE_URL_BY_MODALITY) as ModalityKey[];

  const byPeriod = MODALITY_BY_PERIOD[input.periodCode];
  if (byPeriod?.length) return uniqueKeepOrder(byPeriod.filter((modality) => !!BASE_URL_BY_MODALITY[modality]));

  const periodModality = (input.periodModality ?? '').toUpperCase();
  if (periodModality === 'PP') list.push('presencial');
  if (periodModality === 'PD') list.push('distancia');
  if (periodModality.startsWith('POS')) list.push('posgrados');
  if (list.length) return uniqueKeepOrder(list.filter((modality) => !!BASE_URL_BY_MODALITY[modality]));

  const { prefix } = getNrcParts(input.nrc);
  const byPrefix = prefix ? MODALITY_BY_NRC_PREFIX[prefix] : null;
  if (byPrefix) list.push(byPrefix);
  if (list.length) return uniqueKeepOrder(list.filter((modality) => !!BASE_URL_BY_MODALITY[modality]));

  return allModalities;
}

function buildSearchUrl(baseUrl: string, query: string): string {
  return `${baseUrl.replace(/\/$/, '')}/course/search.php?areaids=core_course-course&q=${encodeURIComponent(query)}`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const args = process.argv.slice(2);
    const rewriteExistingSearch = args.includes('--rewrite-existing-search');
    const periodCodeArg = args.find((arg) => !arg.startsWith('--'))?.trim() || '';

    const courses = await prisma.course.findMany({
      where: {
        period: periodCodeArg ? { code: periodCodeArg } : undefined,
      },
      include: {
        period: true,
        moodleCheck: true,
      },
      orderBy: [{ periodId: 'asc' }, { nrc: 'asc' }],
    });

    let updated = 0;
    let skippedHasUrl = 0;
    let skippedNoQuery = 0;
    let skippedFinalUrl = 0;

    for (const course of courses) {
      const existingUrl = course.moodleCheck?.moodleCourseUrl ?? '';
      if (existingUrl) {
        const isSearchUrl = existingUrl.includes('/course/search.php');
        if (!rewriteExistingSearch || !isSearchUrl) {
          if (!isSearchUrl) {
            skippedFinalUrl += 1;
          } else {
            skippedHasUrl += 1;
          }
          continue;
        }
      }

      const modalities = inferPreferredModalities({
        periodCode: normalizePeriodCode(course.period.code),
        periodModality: course.period.modality,
        nrc: course.nrc,
      });
      const queries = buildNrcQueries({
        nrc: course.nrc,
        periodCode: normalizePeriodCode(course.period.code),
      });

      let selectedBaseUrl = '';
      let selectedModality = '';
      for (const modality of modalities) {
        const baseUrl = BASE_URL_BY_MODALITY[modality];
        if (!baseUrl) continue;
        selectedBaseUrl = baseUrl;
        selectedModality = MODALITY_DISPLAY[modality];
        break;
      }

      const selectedQuery = queries[0] ?? '';
      if (!selectedBaseUrl || !selectedQuery) {
        skippedNoQuery += 1;
        continue;
      }

      const url = buildSearchUrl(selectedBaseUrl, selectedQuery);
      const notesSuffix = 'URL de busqueda Moodle precargada para acceso rapido.';

      await prisma.moodleCheck.upsert({
        where: { courseId: course.id },
        create: {
          courseId: course.id,
          status: course.moodleCheck?.status ?? 'REVISAR_MANUAL',
          detectedTemplate: course.moodleCheck?.detectedTemplate ?? null,
          errorCode: course.moodleCheck?.errorCode ?? null,
          moodleCourseUrl: url,
          moodleCourseId: null,
          resolvedModality: selectedModality || null,
          resolvedBaseUrl: selectedBaseUrl,
          searchQuery: selectedQuery,
          resolvedAt: new Date(),
          attempts: course.moodleCheck?.attempts ?? 0,
          notes: notesSuffix,
        },
        update: {
          moodleCourseUrl: url,
          resolvedModality: selectedModality || null,
          resolvedBaseUrl: selectedBaseUrl,
          searchQuery: selectedQuery,
          resolvedAt: new Date(),
          notes: course.moodleCheck?.notes
            ? `${course.moodleCheck.notes} | ${notesSuffix}`
            : notesSuffix,
        },
      });
      updated += 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          periodCode: periodCodeArg || null,
          scanned: courses.length,
          updated,
          skippedHasUrl,
          skippedFinalUrl,
          skippedNoQuery,
          rewriteExistingSearch,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
