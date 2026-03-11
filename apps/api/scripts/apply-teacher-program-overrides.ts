import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hasTeacherProgramOverride, resolveTeacherProgramOverride } from '../src/modules/common/program.util';

const prisma = new PrismaClient();

async function main() {
  let teachersUpdated = 0;
  let coursesUpdated = 0;
  let sampleGroupsUpdated = 0;
  let outboxUpdated = 0;

  const teachers = await prisma.teacher.findMany({
    select: {
      id: true,
      sourceId: true,
      documentId: true,
      fullName: true,
      costCenter: true,
      coordination: true,
    },
  });

  for (const teacher of teachers) {
    if (
      !hasTeacherProgramOverride({
        teacherId: teacher.id,
        teacherSourceId: teacher.sourceId,
        teacherDocumentId: teacher.documentId,
        teacherName: teacher.fullName,
      })
    ) {
      continue;
    }

    const nextProgram = resolveTeacherProgramOverride({
      teacherId: teacher.id,
      teacherSourceId: teacher.sourceId,
      teacherDocumentId: teacher.documentId,
      teacherName: teacher.fullName,
      teacherCostCenter: teacher.costCenter,
    });

    if (!nextProgram) continue;

    const nextCoordination = resolveTeacherProgramOverride({
      teacherId: teacher.id,
      teacherSourceId: teacher.sourceId,
      teacherDocumentId: teacher.documentId,
      teacherName: teacher.fullName,
      teacherCostCenter: teacher.coordination ?? teacher.costCenter,
    });

    if (teacher.costCenter !== nextProgram || teacher.coordination !== nextCoordination) {
      await prisma.teacher.update({
        where: { id: teacher.id },
        data: {
          costCenter: nextProgram,
          coordination: nextCoordination,
        },
      });
      teachersUpdated += 1;
    }

    const coursesResult = await prisma.course.updateMany({
      where: { teacherId: teacher.id },
      data: {
        programCode: nextProgram,
        programName: nextProgram,
      },
    });
    coursesUpdated += coursesResult.count;

    const sampleGroupsResult = await prisma.sampleGroup.updateMany({
      where: { teacherId: teacher.id },
      data: {
        programCode: nextProgram,
      },
    });
    sampleGroupsUpdated += sampleGroupsResult.count;

    const outboxResult = await prisma.outboxMessage.updateMany({
      where: {
        teacherId: teacher.id,
      },
      data: {
        programCode: nextProgram,
      },
    });
    outboxUpdated += outboxResult.count;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        teachersUpdated,
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
