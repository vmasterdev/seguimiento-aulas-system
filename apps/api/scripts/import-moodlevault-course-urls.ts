import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

type ModalityKey = 'PRESENCIAL' | 'DISTANCIA' | 'POSGRADOS' | 'MOOCS';

const BASE_URL_BY_MODALITY: Record<ModalityKey, string> = {
  PRESENCIAL:
    process.env.MOODLE_BASE_URL_PRESENCIAL?.trim() || 'https://presencial.aulasuniminuto.edu.co',
  DISTANCIA:
    process.env.MOODLE_BASE_URL_DISTANCIA?.trim() || 'https://distancia.aulasuniminuto.edu.co',
  POSGRADOS:
    process.env.MOODLE_BASE_URL_POSGRADOS?.trim() || 'https://posgrados.aulasuniminuto.edu.co',
  MOOCS: process.env.MOODLE_BASE_URL_MOOCS?.trim() || 'https://moocs.aulasuniminuto.edu.co',
};

type CsvRow = {
  NRC: string;
  TIPO_AULA: string;
  COURSE_ID: string;
  MODALIDAD_DONDE_SE_ENCONTRO: string;
  PERIODOS: string;
  ESTADO: string;
  ERROR: string;
};

function splitLine(line: string): string[] {
  return line.split(';').map((value) => value.trim());
}

function canonicalNrcByPeriod(periodCodeRaw: string, nrcRaw: string): string | null {
  const periodCode = String(periodCodeRaw ?? '')
    .replace(/[^\d]/g, '')
    .slice(0, 6);
  const periodPrefix = periodCode.slice(-2);
  const nrcDigits = String(nrcRaw ?? '').replace(/[^\d]/g, '');
  if (!periodPrefix || !nrcDigits) return null;
  const nrcNum = String(Number(nrcDigits.slice(-5)));
  return `${periodPrefix}-${nrcNum}`;
}

function parsePeriods(raw: string): string[] {
  return String(raw ?? '')
    .split(',')
    .map((value) => value.trim().replace(/[^\d]/g, '').slice(0, 6))
    .filter(Boolean);
}

function buildCourseUrl(modality: ModalityKey, courseId: string): string {
  const base = BASE_URL_BY_MODALITY[modality].replace(/\/$/, '');
  return `${base}/course/view.php?id=${courseId}`;
}

function normalizeTemplate(raw: string): 'VACIO' | 'CRIBA' | 'INNOVAME' | 'D4' | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('vacia') || value.includes('vacía') || value === 'vacio') return 'VACIO';
  if (value.includes('criba') || value.includes('escriba')) return 'CRIBA';
  if (value.includes('innovame') || value.includes('innóvame')) return 'INNOVAME';
  if (value.includes('distancia 4')) return 'D4';
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const inputArg = args.find((value) => !value.startsWith('--'));
    const inputPath =
      inputArg ??
      '/mnt/c/TODO UNIMINUTO/1. CAMPUS VIRTUAL/DEV/MOODLEVAULT/Downloader Copias Seguridad/script/1.2 CATEGORIZACION/2026 S1/RESULTADO_TIPOS_AULA_DESDE_MOODLE.csv';

    const content = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (!lines.length) {
      throw new Error(`Archivo sin contenido: ${inputPath}`);
    }

    const headers = splitLine(lines[0]);
    const index: Record<string, number> = {};
    headers.forEach((name, idx) => {
      index[name] = idx;
    });

    const required = ['NRC', 'COURSE_ID', 'MODALIDAD_DONDE_SE_ENCONTRO', 'PERIODOS', 'ESTADO', 'ERROR'];
    const missing = required.filter((key) => index[key] === undefined);
    if (missing.length) {
      throw new Error(`Faltan columnas en CSV: ${missing.join(', ')}`);
    }

    const rows: CsvRow[] = lines.slice(1).map((line) => {
      const values = splitLine(line);
      return {
        NRC: values[index.NRC] ?? '',
        TIPO_AULA: values[index.TIPO_AULA] ?? '',
        COURSE_ID: values[index.COURSE_ID] ?? '',
        MODALIDAD_DONDE_SE_ENCONTRO: values[index.MODALIDAD_DONDE_SE_ENCONTRO] ?? '',
        PERIODOS: values[index.PERIODOS] ?? '',
        ESTADO: values[index.ESTADO] ?? '',
        ERROR: values[index.ERROR] ?? '',
      };
    });

    let scanned = 0;
    let skippedNoCourseId = 0;
    let skippedBadModality = 0;
    let noMatch = 0;
    let updated = 0;
    let replacedSearchUrl = 0;
    let alreadyFinalUrl = 0;
    const ambiguous: Array<{ nrc: string; periods: string[]; total: number }> = [];

    for (const row of rows) {
      scanned += 1;

      const courseId = String(row.COURSE_ID ?? '').trim();
      if (!/^\d+$/.test(courseId)) {
        skippedNoCourseId += 1;
        continue;
      }

      const modalityRaw = String(row.MODALIDAD_DONDE_SE_ENCONTRO ?? '').trim().toUpperCase() as ModalityKey;
      if (!BASE_URL_BY_MODALITY[modalityRaw]) {
        skippedBadModality += 1;
        continue;
      }

      const periods = parsePeriods(row.PERIODOS);
      const nrcCandidates = periods
        .map((period) => canonicalNrcByPeriod(period, row.NRC))
        .filter((value): value is string => Boolean(value));
      if (!nrcCandidates.length) {
        noMatch += 1;
        continue;
      }

      let candidates = await prisma.course.findMany({
        where: {
          OR: nrcCandidates.map((nrc) => ({
            nrc,
            period: { code: { in: periods } },
          })),
        },
        select: {
          id: true,
          nrc: true,
          moodleCheck: {
            select: {
              moodleCourseUrl: true,
            },
          },
        },
      });

      if (candidates.length > 1) {
        const filtered = candidates.filter((item) => periods.some((period) => item.nrc.startsWith(period.slice(-2))));
        if (filtered.length === 1) {
          candidates = filtered;
        }
      }

      if (!candidates.length) {
        noMatch += 1;
        continue;
      }

      if (candidates.length > 1) {
        ambiguous.push({
          nrc: row.NRC,
          periods,
          total: candidates.length,
        });
        continue;
      }

      const target = candidates[0];
      const finalUrl = buildCourseUrl(modalityRaw, courseId);
      const currentUrl = target.moodleCheck?.moodleCourseUrl ?? '';
      const detectedTemplate = normalizeTemplate(row.TIPO_AULA);

      if (currentUrl.includes('/course/view.php?id=')) {
        alreadyFinalUrl += 1;
      }
      if (currentUrl.includes('/course/search.php')) {
        replacedSearchUrl += 1;
      }

      if (!dryRun) {
        await prisma.moodleCheck.upsert({
          where: { courseId: target.id },
          create: {
            courseId: target.id,
            status: 'OK',
            detectedTemplate: detectedTemplate ?? null,
            errorCode: null,
            notes: `URL final importada desde Moodlevault (${modalityRaw}).`,
            moodleCourseUrl: finalUrl,
            moodleCourseId: courseId,
            resolvedModality: modalityRaw,
            resolvedBaseUrl: BASE_URL_BY_MODALITY[modalityRaw],
            searchQuery: target.nrc,
            resolvedAt: new Date(),
            attempts: 1,
            lastAttemptAt: new Date(),
          },
          update: {
            status: 'OK',
            ...(detectedTemplate ? { detectedTemplate } : {}),
            errorCode: null,
            notes: `URL final importada desde Moodlevault (${modalityRaw}).`,
            moodleCourseUrl: finalUrl,
            moodleCourseId: courseId,
            resolvedModality: modalityRaw,
            resolvedBaseUrl: BASE_URL_BY_MODALITY[modalityRaw],
            searchQuery: target.nrc,
            resolvedAt: new Date(),
            lastAttemptAt: new Date(),
          },
        });
      }

      updated += 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          inputPath,
          dryRun,
          scanned,
          updated,
          skippedNoCourseId,
          skippedBadModality,
          noMatch,
          ambiguous: ambiguous.length,
          ambiguousSample: ambiguous.slice(0, 20),
          replacedSearchUrl,
          alreadyFinalUrl,
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
