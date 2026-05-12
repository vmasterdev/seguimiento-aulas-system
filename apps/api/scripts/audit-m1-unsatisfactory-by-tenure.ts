import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const M1_CUTOFF_DATE = process.env.M1_CUTOFF_DATE ? new Date(process.env.M1_CUTOFF_DATE) : new Date('2026-02-15');
const TENURE_DAYS = 90;
const M1_MOMENTS = ['MD1', '1'];

const PHASE_THRESHOLDS: Record<string, number> = {
  ALISTAMIENTO: 35,
  EJECUCION: 35,
};

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return 'N/A';
  return new Date(d).toISOString().slice(0, 10);
}

async function main() {
  const phaseArg = (process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1] ?? 'ALISTAMIENTO').toUpperCase();
  const phase = phaseArg === 'EJECUCION' ? 'EJECUCION' : 'ALISTAMIENTO';
  const threshold = PHASE_THRESHOLDS[phase];

  console.log(`\nAuditoria docentes insatisfactorios M1`);
  console.log(`Fase:                  ${phase}`);
  console.log(`Umbral insatisfactorio: score < ${threshold}/50`);
  console.log(`Corte M1:              ${fmtDate(M1_CUTOFF_DATE)}`);
  console.log(`Antiguedad minima:     ${TENURE_DAYS} dias\n`);

  const courses = await prisma.course.findMany({
    where: { moment: { in: M1_MOMENTS } },
    include: {
      period: true,
      teacher: true,
      evaluations: { where: { phase } },
    },
  });

  type Row = {
    teacherId: string | null;
    teacherName: string;
    coordination: string;
    campus: string;
    fechaInicio: Date | null;
    previousEmployment: boolean;
    daysAtCutoff: number | null;
    eligible: boolean;
    courses: number;
    minScore: number;
    periodCodes: Set<string>;
  };

  const byTeacher = new Map<string, Row>();

  for (const course of courses) {
    const evaluation = course.evaluations[0];
    if (!evaluation || evaluation.score == null) continue;
    if (evaluation.score >= threshold) continue;
    if (!course.teacher) continue;

    const key = course.teacher.id;
    const existing = byTeacher.get(key);
    if (existing) {
      existing.courses += 1;
      existing.minScore = Math.min(existing.minScore, evaluation.score);
      existing.periodCodes.add(course.period.code);
      continue;
    }

    const fechaInicio = course.teacher.fechaInicio ?? null;
    const daysAtCutoff = fechaInicio ? daysBetween(M1_CUTOFF_DATE, fechaInicio) : null;
    const previousEmployment = course.teacher.previousEmployment ?? false;
    const eligible = previousEmployment || (daysAtCutoff !== null && daysAtCutoff >= TENURE_DAYS);

    byTeacher.set(key, {
      teacherId: course.teacher.id,
      teacherName: course.teacher.fullName,
      coordination: course.teacher.coordination ?? course.teacher.costCenter ?? 'SIN_COORD',
      campus: course.teacher.campus ?? 'SIN_CU',
      fechaInicio,
      previousEmployment,
      daysAtCutoff,
      eligible,
      courses: 1,
      minScore: evaluation.score,
      periodCodes: new Set([course.period.code]),
    });
  }

  const rows = [...byTeacher.values()].sort((a, b) =>
    Number(a.eligible) - Number(b.eligible) || a.teacherName.localeCompare(b.teacherName, 'es'),
  );

  let totalInsat = rows.length;
  let antiguos = 0;
  let nuevos = 0;
  let sinFecha = 0;
  let conPrevEmployment = 0;

  for (const row of rows) {
    if (row.fechaInicio == null && !row.previousEmployment) sinFecha += 1;
    if (row.previousEmployment) conPrevEmployment += 1;
    if (row.eligible) antiguos += 1;
    else nuevos += 1;
  }

  console.log('='.repeat(110));
  console.log('LISTADO COMPLETO (ordenado: nuevos primero, luego antiguos)');
  console.log('='.repeat(110));
  console.log(
    [
      'Eleg.'.padEnd(6),
      'Docente'.padEnd(38),
      'Programa'.padEnd(28),
      'CU'.padEnd(14),
      'FechaInicio'.padEnd(12),
      'Dias'.padEnd(6),
      'PrevEmp'.padEnd(8),
      'Score'.padEnd(7),
      'Aulas',
    ].join(' | '),
  );
  console.log('-'.repeat(110));

  for (const row of rows) {
    const flag = row.eligible ? 'SI' : 'NO';
    const days = row.daysAtCutoff !== null ? String(row.daysAtCutoff) : 'N/A';
    const prev = row.previousEmployment ? 'SI' : 'NO';
    console.log(
      [
        flag.padEnd(6),
        (row.teacherName ?? '').slice(0, 38).padEnd(38),
        (row.coordination ?? '').slice(0, 28).padEnd(28),
        (row.campus ?? '').slice(0, 14).padEnd(14),
        fmtDate(row.fechaInicio).padEnd(12),
        days.padEnd(6),
        prev.padEnd(8),
        row.minScore.toFixed(1).padEnd(7),
        String(row.courses),
      ].join(' | '),
    );
  }

  console.log('\n' + '='.repeat(60));
  console.log('RESUMEN');
  console.log('='.repeat(60));
  console.log(`Total docentes insatisfactorios M1 (fase ${phase}): ${totalInsat}`);
  console.log(`  Antiguos (elegibles para evento significativo): ${antiguos}`);
  console.log(`  Nuevos (no elegibles, < ${TENURE_DAYS} dias):    ${nuevos}`);
  console.log(`  Con previousEmployment = true:                  ${conPrevEmployment}`);
  console.log(`  Sin fechaInicio en BD (data faltante):          ${sinFecha}`);
  console.log('');
  console.log('Para cambiar fecha de corte M1 usa: M1_CUTOFF_DATE=2026-02-20 pnpm tsx ...');
  console.log('Para fase ejecucion: pnpm tsx audit-m1-unsatisfactory-by-tenure.ts --phase=EJECUCION');
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
