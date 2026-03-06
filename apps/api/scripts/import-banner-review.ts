import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';
import { normalizeTeacherId } from '@seguimiento/shared';
import { resolveProgramValue } from '../src/modules/common/program.util';

type BannerRow = {
  query_id?: string;
  nrc?: string;
  period?: string;
  teacher_name?: string;
  teacher_id?: string;
  program_name?: string;
  status?: string;
  error_message?: string;
  checked_at?: string;
  screenshot_path?: string;
  html_path?: string;
  raw_payload?: string;
  additional_data?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseJsonCell(value: string | undefined): Record<string, unknown> | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function canonicalNrcByPeriod(periodCodeRaw: string, rawNrc: string): string | null {
  const periodCode = String(periodCodeRaw ?? '').replace(/[^\d]/g, '').slice(0, 6);
  const nrcRaw = String(rawNrc ?? '').trim();
  if (!periodCode || !nrcRaw) return null;

  const explicit = nrcRaw.match(/^(\d{2})\s*-\s*(\d+)$/);
  const periodPrefix = periodCode.slice(-2);
  if (explicit) {
    const number = String(Number(explicit[2]));
    return `${periodPrefix}-${number}`;
  }

  const digits = nrcRaw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const number = String(Number(digits));
  return `${periodPrefix}-${number}`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const inputArg =
      process.argv[2] ??
      '../../storage/outputs/reports/banner_revision_nrc_sin_docente_md1_y_1_149_consultados_3_con_docente_2026-02-28.csv';
    const inputPath = path.resolve(process.cwd(), inputArg);
    const sourceFile = path.basename(inputPath);
    const csvText = readFileSync(inputPath, 'utf8');
    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
    }) as BannerRow[];

    let updatedCourses = 0;
    let linkedTeachers = 0;
    let noCourseMatch = 0;
    let invalidRows = 0;
    const statusCounts = new Map<string, number>();

    for (const row of rows) {
      const periodCode = String(row.period ?? '').replace(/[^\d]/g, '').slice(0, 6);
      const nrc = canonicalNrcByPeriod(periodCode, String(row.nrc ?? ''));
      const status = String(row.status ?? '').trim().toUpperCase() || 'SIN_ESTADO';
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

      if (!periodCode || !nrc) {
        invalidRows += 1;
        continue;
      }

      const course = await prisma.course.findFirst({
        where: {
          nrc,
          period: { code: periodCode },
        },
        include: {
          teacher: true,
        },
      });

      if (!course) {
        noCourseMatch += 1;
        continue;
      }

      const rawJson = asRecord(course.rawJson);
      rawJson.bannerReview = {
        source: 'BANNER',
        sourceFile,
        importedAt: new Date().toISOString(),
        queryId: row.query_id ?? null,
        status,
        errorMessage: row.error_message ?? null,
        checkedAt: row.checked_at ?? null,
        teacherName: row.teacher_name ?? null,
        teacherId: normalizeTeacherId(row.teacher_id ?? ''),
        programName: row.program_name ?? null,
        screenshotPath: row.screenshot_path ?? null,
        htmlPath: row.html_path ?? null,
        rawPayload: parseJsonCell(row.raw_payload),
        additionalData: parseJsonCell(row.additional_data),
      };

      let teacherIdToUse = course.teacherId;
      let courseProgramCodeToUse = course.programCode;
      let courseProgramNameToUse = course.programName;
      if (status === 'ENCONTRADO') {
        const teacherId = normalizeTeacherId(row.teacher_id ?? '');
        const teacherName = String(row.teacher_name ?? '').trim();
        if (teacherId && teacherName) {
          const existingTeacher =
            (await prisma.teacher.findUnique({ where: { id: teacherId } })) ??
            (await prisma.teacher.findFirst({
              where: {
                OR: [{ sourceId: teacherId }, { documentId: teacherId }],
              },
            }));

          const teacher = await prisma.teacher.upsert({
            where: { id: existingTeacher?.id ?? teacherId },
            create: {
              id: existingTeacher?.id ?? teacherId,
              sourceId: existingTeacher?.sourceId ?? teacherId,
              documentId: existingTeacher?.documentId ?? null,
              fullName: teacherName,
              email: existingTeacher?.email ?? null,
              campus: existingTeacher?.campus ?? null,
              region: existingTeacher?.region ?? null,
              costCenter: existingTeacher?.costCenter ?? null,
              coordination: existingTeacher?.coordination ?? null,
            },
            update: {
              fullName: teacherName || existingTeacher?.fullName,
              sourceId: existingTeacher?.sourceId ?? teacherId,
            },
          });

          teacherIdToUse = teacher.id;
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: teacher.costCenter ?? existingTeacher?.costCenter ?? null,
            teacherLinked: true,
            courseProgramCode: course.programCode,
            courseProgramName: course.programName,
          });
          courseProgramCodeToUse = resolvedProgram.programCode;
          courseProgramNameToUse = resolvedProgram.programName;
          linkedTeachers += 1;
        }
      }

      await prisma.course.update({
        where: { id: course.id },
        data: {
          teacherId: teacherIdToUse,
          programCode: courseProgramCodeToUse,
          programName: courseProgramNameToUse,
          rawJson: rawJson as unknown as object,
        },
      });
      updatedCourses += 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          sourceFile,
          rows: rows.length,
          updatedCourses,
          linkedTeachers,
          noCourseMatch,
          invalidRows,
          statusCounts: Object.fromEntries(statusCounts),
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
