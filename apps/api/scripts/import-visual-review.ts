import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

type ReviewRow = {
  nrcRaw: string;
  periodCode: string;
  teacherIdRaw: string;
  titleRaw: string;
  templateRaw: string;
  sourceRow: number;
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r');
}

function extractInlineText(xmlFragment: string): string {
  const matches = [...xmlFragment.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)];
  if (!matches.length) return '';
  const text = matches.map((match) => match[1]).join('');
  return decodeXmlEntities(text)
    .trim();
}

function parseSharedStrings(xml: string): string[] {
  const values: string[] = [];
  const siRegex = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml)) !== null) {
    values.push(extractInlineText(match[1]));
  }
  return values;
}

function normalizeTemplate(raw: string): 'VACIO' | 'CRIBA' | 'INNOVAME' | 'D4' | 'UNKNOWN' {
  const value = raw.trim().toLowerCase();
  if (!value) return 'UNKNOWN';
  if (value.includes('vacia') || value.includes('vacía')) return 'VACIO';
  if (value.includes('criba') || value.includes('escriba')) return 'CRIBA';
  if (value.includes('innovame') || value.includes('innóvame')) return 'INNOVAME';
  if (value.includes('distancia 4')) return 'D4';
  return 'UNKNOWN';
}

function normalizeNrc(nrcRaw: string, periodCode: string): string {
  const raw = nrcRaw.trim();
  if (!raw) return '';
  const period = periodCode.replace(/\D/g, '');
  const periodPrefix = period.length >= 2 ? period.slice(-2) : '';

  const withPrefix = raw.match(/^(\d{2})\s*-\s*(\d+)$/);
  if (withPrefix) {
    const nrcNum = String(Number(withPrefix[2]));
    return periodPrefix ? `${periodPrefix}-${nrcNum}` : `${withPrefix[1]}-${nrcNum}`;
  }

  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const nrcNum = String(Number(digits));
  if (periodPrefix) {
    return `${periodPrefix}-${nrcNum}`;
  }
  return nrcNum;
}

function normalizeTeacherId(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.trim();
}

function parseSheetRows(xml: string, sharedStrings: string[]): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const rowRegex = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const sourceRow = Number(rowMatch[1]);
    const rowContent = rowMatch[2];
    if (sourceRow <= 1) continue;

    const byCol: Record<string, string> = {};
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const col = cellMatch[1];
      const attrs = cellMatch[2] ?? '';
      const cellContent = cellMatch[3] ?? '';
      const isShared = /\bt="s"/i.test(attrs);
      if (isShared) {
        const idxRaw = cellContent.match(/<v[^>]*>(\d+)<\/v>/i)?.[1] ?? '';
        const idx = Number(idxRaw);
        byCol[col] = Number.isNaN(idx) ? '' : (sharedStrings[idx] ?? '').trim();
      } else {
        const inline = extractInlineText(cellContent);
        if (inline) {
          byCol[col] = inline;
        } else {
          byCol[col] = decodeXmlEntities(cellContent.match(/<v[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '').trim();
        }
      }
    }

    const nrcRaw = (byCol.A ?? '').trim();
    const periodCode = (byCol.B ?? '').trim();
    const teacherIdRaw = (byCol.I ?? byCol.H ?? '').trim();
    const titleRaw = (byCol.E ?? '').trim();
    const templateRaw = (byCol.J ?? byCol.I ?? '').trim();

    if (!nrcRaw || !templateRaw) continue;

    rows.push({
      nrcRaw,
      periodCode,
      teacherIdRaw,
      titleRaw,
      templateRaw,
      sourceRow,
    });
  }

  return rows;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const inputArg =
      process.argv[2] ??
      '../../storage/inputs/classification_excels/LISTADO_NRC_REVISADOS_VISUALMENTE_TIPO_AULA.xlsx';
    const filePath = path.resolve(process.cwd(), inputArg);

    const sheetXml = execFileSync('unzip', ['-p', filePath, 'xl/worksheets/sheet1.xml'], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
    let sharedStringsXml = '';
    try {
      sharedStringsXml = execFileSync('unzip', ['-p', filePath, 'xl/sharedStrings.xml'], {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch {
      sharedStringsXml = '';
    }
    const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

    const rows = parseSheetRows(sheetXml, sharedStrings);

    let updated = 0;
    let unknownTemplate = 0;
    let noMatch = 0;
    let ambiguous = 0;
    let skippedNoPeriod = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const template = normalizeTemplate(row.templateRaw);
      if (template === 'UNKNOWN') {
        unknownTemplate += 1;
        continue;
      }

      const nrc = normalizeNrc(row.nrcRaw, row.periodCode);
      if (!nrc) {
        noMatch += 1;
        continue;
      }

      const periodCode = row.periodCode.replace(/\D/g, '');

      let matches: Array<{ id: string; teacherId: string | null }> = [];
      const nrcDigits = row.nrcRaw.replace(/\D/g, '');
      const nrcNumber = nrcDigits ? String(Number(nrcDigits)) : '';
      const normalizedTeacherId = normalizeTeacherId(row.teacherIdRaw);

      if (periodCode) {
        matches = await prisma.course.findMany({
          where: {
            nrc,
            period: { code: periodCode },
          },
          select: { id: true, teacherId: true },
          take: 5,
        });
        if (!matches.length && nrcNumber) {
          matches = await prisma.course.findMany({
            where: {
              period: { code: periodCode },
              nrc: { endsWith: `-${nrcNumber}` },
            },
            select: { id: true, teacherId: true },
            take: 8,
          });
        }
      } else {
        skippedNoPeriod += 1;
        matches = await prisma.course.findMany({
          where: { nrc },
          select: { id: true, teacherId: true },
          take: 5,
        });
      }

      if (matches.length > 1 && normalizedTeacherId) {
        const teacherFiltered = matches.filter((item) => item.teacherId === normalizedTeacherId);
        if (teacherFiltered.length >= 1) {
          matches = teacherFiltered;
        }
      }

      if (!matches.length) {
        noMatch += 1;
        continue;
      }
      if (matches.length > 1) {
        ambiguous += 1;
        continue;
      }

      const courseId = matches[0].id;
      await prisma.moodleCheck.upsert({
        where: { courseId },
        create: {
          courseId,
          status: 'OK',
          detectedTemplate: template,
          notes: `Clasificacion visual importada (fila ${row.sourceRow}).`,
        },
        update: {
          status: 'OK',
          detectedTemplate: template,
          errorCode: null,
          notes: `Clasificacion visual importada (fila ${row.sourceRow}).`,
          lastAttemptAt: new Date(),
        },
      });

      if (row.titleRaw) {
        await prisma.course.update({
          where: { id: courseId },
          data: { subjectName: row.titleRaw },
        });
      }

      updated += 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          filePath,
          parsedRows: rows.length,
          updated,
          unknownTemplate,
          skippedNoPeriod,
          noMatch,
          ambiguous,
          errors,
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
