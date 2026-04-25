import { PrismaClient } from '/home/uvan/seguimiento-api-run-20260307/node_modules/@prisma/client/index.js';
const prisma = new PrismaClient();

const missingNrcs = ["21-70256","21-70260","21-70261","21-70268","21-70270","21-70274","21-70277","21-70281","21-79292","21-79332","21-79595","21-79597","21-79603","21-79604","41-68201","41-68204"];

const courses = await prisma.course.findMany({
  where: { nrc: { in: missingNrcs } },
  select: {
    nrc: true,
    subjectName: true,
    programCode: true,
    campusCode: true,
    period: { select: { code: true } },
    moodleCheck: {
      select: {
        moodleCourseUrl: true,
        moodleCourseId: true,
        resolvedBaseUrl: true,
        resolvedModality: true,
        status: true,
      }
    }
  }
});

console.log('Encontrados en BD:', courses.length);
for (const c of courses) {
  const mc = c.moodleCheck;
  console.log(`\nNRC: ${c.nrc} | Periodo: ${c.period?.code} | Programa: ${c.programCode} | Campus: ${c.campusCode}`);
  console.log(`  Materia: ${c.subjectName}`);
  console.log(`  moodleCheck existe: ${mc ? 'SI' : 'NO'}`);
  if (mc) {
    console.log(`  moodleCourseUrl: ${mc.moodleCourseUrl ?? 'NULL'}`);
    console.log(`  resolvedBaseUrl: ${mc.resolvedBaseUrl ?? 'NULL'}`);
    console.log(`  resolvedModality: ${mc.resolvedModality ?? 'NULL'}`);
    console.log(`  status: ${mc.status ?? 'NULL'}`);
  }
}

// Resumen por patron
const noCheck = courses.filter(c => !c.moodleCheck).length;
const noUrl = courses.filter(c => c.moodleCheck && !c.moodleCheck.moodleCourseUrl).length;
const noBase = courses.filter(c => c.moodleCheck && !c.moodleCheck.resolvedBaseUrl).length;
console.log(`\n=== RESUMEN ===`);
console.log(`Sin moodleCheck: ${noCheck}`);
console.log(`Con moodleCheck pero sin URL: ${noUrl}`);
console.log(`Con moodleCheck pero sin resolvedBaseUrl: ${noBase}`);

await prisma.$disconnect();
