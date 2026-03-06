import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';

type EnrollmentRow = {
  PERIODO?: string;
  NRC?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function canonicalNrcByPeriod(periodCodeRaw: string, rawNrc: string): string | null {
  const periodCode = String(periodCodeRaw ?? '').replace(/[^\d]/g, '').slice(0, 6);
  const nrcRaw = String(rawNrc ?? '').trim();
  if (!nrcRaw) return null;

  const explicit = nrcRaw.match(/^(\d{2})\s*-\s*(\d+)$/);
  if (explicit) {
    return `${explicit[1]}-${String(Number(explicit[2]))}`;
  }

  const digits = nrcRaw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const number = String(Number(digits));
  if (!periodCode) return number;
  return `${periodCode.slice(-2)}-${number}`;
}

function numericNrcSuffix(rawNrc: string): string | null {
  const digits = String(rawNrc ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  return String(Number(digits));
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const inputArg =
      process.argv[2] ??
      '/mnt/c/TODO UNIMINUTO/1. CAMPUS VIRTUAL/DEV/MOODLEVAULT/Downloader Copias Seguridad - Revisor Visual Tipo de Aula/script/1.2 CATEGORIZACION/2026 S1/_ARCHIVO/REPORTES_SECUNDARIOS/NRC_MATRICULADOS_LISTADO.csv';
    const inputPath = path.resolve(process.cwd(), inputArg);
    const sourceFile = path.basename(inputPath);
    const csvText = readFileSync(inputPath, 'utf8');
    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      delimiter: ';',
      relax_column_count: true,
    }) as EnrollmentRow[];

    const enrolledByCanonicalNrc = new Set<string>();
    const enrolledByNumericSuffix = new Set<string>();
    let invalidRows = 0;

    for (const row of rows) {
      const rawNrc = String(row.NRC ?? '').trim();
      if (!rawNrc) {
        invalidRows += 1;
        continue;
      }

      const canonicalNrc = canonicalNrcByPeriod(String(row.PERIODO ?? ''), rawNrc);
      if (canonicalNrc?.includes('-')) {
        enrolledByCanonicalNrc.add(canonicalNrc);
      }
      const numericSuffix = numericNrcSuffix(rawNrc);
      if (numericSuffix) {
        enrolledByNumericSuffix.add(numericSuffix);
      }
    }

    const courses = await prisma.course.findMany({
      select: {
        id: true,
        nrc: true,
        rawJson: true,
        period: {
          select: {
            code: true,
          },
        },
      },
    });

    let matched = 0;
    let unmatched = 0;
    let updated = 0;

    for (const course of courses) {
      const numericSuffix = numericNrcSuffix(course.nrc);
      const isEnrolled =
        enrolledByCanonicalNrc.has(course.nrc) || (numericSuffix ? enrolledByNumericSuffix.has(numericSuffix) : false);

      const rawJson = asRecord(course.rawJson);
      rawJson.reviewerEnrollment = {
        source: 'MATRICULADOS_LISTADO',
        sourceFile,
        importedAt: new Date().toISOString(),
        periodCode: course.period.code,
        nrc: course.nrc,
        status: isEnrolled ? 'MATRICULADO' : 'NO_MATRICULADO',
      };

      await prisma.course.update({
        where: { id: course.id },
        data: {
          rawJson: rawJson as unknown as object,
        },
      });

      if (isEnrolled) matched += 1;
      else unmatched += 1;
      updated += 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          sourceFile,
          rows: rows.length,
          invalidRows,
          enrolledUniqueCanonical: enrolledByCanonicalNrc.size,
          enrolledUniqueNumeric: enrolledByNumericSuffix.size,
          updated,
          matched,
          unmatched,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
