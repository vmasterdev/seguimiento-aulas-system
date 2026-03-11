import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizeProgramKey } from '@seguimiento/shared';
import { normalizeProgramValue } from '../src/modules/common/program.util';

const prisma = new PrismaClient();

function toCanonicalOrNull(value: string | null | undefined): string | null {
  return normalizeProgramValue(value ?? null);
}

function normalizeOutboxProgramCode(raw: string | null): string | null {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes('||')) {
    const [programIdRaw, periodsRaw] = trimmed.split('||');
    const programId = toCanonicalOrNull(programIdRaw) ?? programIdRaw.trim();
    return periodsRaw ? `${programId}||${periodsRaw}` : programId;
  }

  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(trimmed)) {
    return trimmed;
  }

  return toCanonicalOrNull(trimmed) ?? trimmed;
}

async function main() {
  let teachersUpdated = 0;
  let coordinatorsUpdated = 0;
  let coursesUpdated = 0;
  let sampleGroupsUpdated = 0;
  let outboxUpdated = 0;

  const teachers = await prisma.teacher.findMany({
    select: { id: true, costCenter: true, coordination: true },
  });
  for (const teacher of teachers) {
    const nextCostCenter = toCanonicalOrNull(teacher.costCenter);
    const nextCoordination = toCanonicalOrNull(teacher.coordination);
    if (nextCostCenter === teacher.costCenter && nextCoordination === teacher.coordination) continue;

    await prisma.teacher.update({
      where: { id: teacher.id },
      data: {
        costCenter: nextCostCenter,
        coordination: nextCoordination,
      },
    });
    teachersUpdated += 1;
  }

  const coordinators = await prisma.coordinator.findMany({
    select: { id: true, programId: true, programKey: true },
  });
  for (const coordinator of coordinators) {
    const nextProgramId = toCanonicalOrNull(coordinator.programId) ?? coordinator.programId;
    const nextProgramKey = normalizeProgramKey(nextProgramId);
    if (nextProgramId === coordinator.programId && nextProgramKey === coordinator.programKey) continue;

    await prisma.coordinator.update({
      where: { id: coordinator.id },
      data: {
        programId: nextProgramId,
        programKey: nextProgramKey,
      },
    });
    coordinatorsUpdated += 1;
  }

  const courses = await prisma.course.findMany({
    select: { id: true, programCode: true, programName: true },
  });
  for (const course of courses) {
    const nextProgramCode = toCanonicalOrNull(course.programCode);
    const nextProgramName = toCanonicalOrNull(course.programName);
    if (nextProgramCode === course.programCode && nextProgramName === course.programName) continue;

    await prisma.course.update({
      where: { id: course.id },
      data: {
        programCode: nextProgramCode,
        programName: nextProgramName,
      },
    });
    coursesUpdated += 1;
  }

  const sampleGroups = await prisma.sampleGroup.findMany({
    select: { id: true, programCode: true },
  });
  for (const sampleGroup of sampleGroups) {
    const nextProgramCode = toCanonicalOrNull(sampleGroup.programCode) ?? sampleGroup.programCode;
    if (nextProgramCode === sampleGroup.programCode) continue;

    await prisma.sampleGroup.update({
      where: { id: sampleGroup.id },
      data: {
        programCode: nextProgramCode,
      },
    });
    sampleGroupsUpdated += 1;
  }

  const outboxMessages = await prisma.outboxMessage.findMany({
    where: {
      programCode: {
        not: null,
      },
    },
    select: {
      id: true,
      programCode: true,
    },
  });
  for (const message of outboxMessages) {
    const nextProgramCode = normalizeOutboxProgramCode(message.programCode);
    if (nextProgramCode === message.programCode) continue;

    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        programCode: nextProgramCode,
      },
    });
    outboxUpdated += 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        teachersUpdated,
        coordinatorsUpdated,
        coursesUpdated,
        sampleGroupsUpdated,
        outboxUpdated,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
