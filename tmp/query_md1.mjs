import { PrismaClient } from '/home/uvan/seguimiento-api-run-20260307/node_modules/@prisma/client/index.js';
const prisma = new PrismaClient();
const groups = await prisma.sampleGroup.findMany({ where: { moment: 'MD1' }, select: { selectedCourseId: true } });
const courseIds = [...new Set(groups.map(g => g.selectedCourseId).filter(Boolean))];
const courses = await prisma.course.findMany({ where: { id: { in: courseIds } }, select: { nrc: true } });
const nrcs = courses.map(c => c.nrc).filter(Boolean).sort();
console.log('TOTAL_BD:' + nrcs.length);
process.stdout.write('NRCS:' + JSON.stringify(nrcs) + '\n');
await prisma.$disconnect();
