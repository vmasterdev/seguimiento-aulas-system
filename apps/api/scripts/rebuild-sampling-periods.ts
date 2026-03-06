import 'reflect-metadata';
import 'dotenv/config';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SamplingService } from '../src/modules/sampling/sampling.service';
import { EvaluationService } from '../src/modules/evaluation/evaluation.service';
import { PrismaService } from '../src/modules/prisma.service';

type MismatchRow = {
  periodCode: string;
  teacherName: string;
  nrc: string;
  storedTemplate: string;
  actualTemplate: string;
  phases: string;
  scores: string;
};

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv<T extends Record<string, unknown>>(rows: T[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function collectMismatches(prisma: PrismaService, periods: string[]) {
  const groups = await prisma.sampleGroup.findMany({
    where: {
      period: {
        code: { in: periods },
      },
    },
    include: {
      period: true,
      teacher: true,
      selectedCourse: {
        include: {
          teacher: true,
          moodleCheck: true,
          evaluations: true,
        },
      },
    },
    orderBy: [{ periodId: 'asc' }, { createdAt: 'asc' }],
  });

  const rows: MismatchRow[] = groups
    .filter((group) => Boolean(group.selectedCourse))
    .map((group) => {
      const actualTemplate = (
        group.selectedCourse?.moodleCheck?.detectedTemplate ??
        group.selectedCourse?.templateDeclared ??
        'UNKNOWN'
      ).toUpperCase();
      const storedTemplate = (group.template ?? 'UNKNOWN').toUpperCase();
      return {
        mismatch: actualTemplate !== storedTemplate,
        row: {
          periodCode: group.period.code,
          teacherName: group.selectedCourse?.teacher?.fullName ?? group.teacher.fullName,
          nrc: group.selectedCourse?.nrc ?? '',
          storedTemplate,
          actualTemplate,
          phases:
            group.selectedCourse?.evaluations
              .map((evaluation) => evaluation.phase)
              .sort()
              .join('|') ?? '',
          scores:
            group.selectedCourse?.evaluations
              .map((evaluation) => `${evaluation.phase}:${evaluation.score}`)
              .sort()
              .join('|') ?? '',
        },
      };
    })
    .filter((entry) => entry.mismatch)
    .map((entry) => entry.row);

  const summary = periods.map((periodCode) => {
    const periodRows = rows.filter((row) => row.periodCode === periodCode);
    return {
      periodCode,
      mismatches: periodRows.length,
    };
  });

  return { rows, summary };
}

async function main() {
  const periods = process.argv.slice(2).filter(Boolean);
  const targetPeriods = periods.length
    ? periods
    : ['202580', '202610', '202611', '202612', '202615', '202621', '202641'];
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const samplingService = new SamplingService(prisma);
    const evaluationService = new EvaluationService(prisma);

    const before = await collectMismatches(prisma, targetPeriods);

    const summaryRows: Array<Record<string, unknown>> = [];

    for (const periodCode of targetPeriods) {
      const period = await prisma.period.findUnique({
        where: { code: periodCode },
        select: { id: true },
      });
      if (!period) continue;

      const groupsBefore = await prisma.sampleGroup.count({ where: { periodId: period.id } });
      const generateResult = await samplingService.generate({ periodCode });
      const replicateAlistamiento = await evaluationService.replicateSampled({
        periodCode,
        phase: 'ALISTAMIENTO',
      });
      const replicateEjecucion = await evaluationService.replicateSampled({
        periodCode,
        phase: 'EJECUCION',
      });
      const groupsAfter = await prisma.sampleGroup.count({ where: { periodId: period.id } });

      summaryRows.push({
        periodCode,
        groupsBefore,
        groupsAfter,
        deltaGroups: groupsAfter - groupsBefore,
        candidateCourses: generateResult.candidateCourses,
        reusedGroups: generateResult.reusedGroups,
        reusedEvaluations: generateResult.reusedEvaluations,
        replicatedAlistamiento: replicateAlistamiento.replicatedCourses,
        replicatedEjecucion: replicateEjecucion.replicatedCourses,
      });
    }

    const after = await collectMismatches(prisma, targetPeriods);

    const projectRoot = path.resolve(process.cwd(), '..', '..');
    const reportsDir = path.join(projectRoot, 'storage', 'outputs', 'reports');
    mkdirSync(reportsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');

    const summaryPath = path.join(reportsDir, `reconciliacion_muestreo_periodos_${stamp}.csv`);
    const beforePath = path.join(reportsDir, `muestreo_impactado_antes_${stamp}.csv`);
    const afterPath = path.join(reportsDir, `muestreo_impactado_despues_${stamp}.csv`);

    writeFileSync(summaryPath, toCsv(summaryRows), 'utf8');
    writeFileSync(beforePath, toCsv(before.rows), 'utf8');
    writeFileSync(afterPath, toCsv(after.rows), 'utf8');

    console.log(
      JSON.stringify(
        {
          ok: true,
          periods: targetPeriods,
          beforeSummary: before.summary,
          afterSummary: after.summary,
          summaryPath,
          beforePath,
          afterPath,
          summaryRows,
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
