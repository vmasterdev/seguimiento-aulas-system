'use strict';

// Reclasifica eventos de NO_CLASIFICADO -> DOCENTE cuando el actor comparte
// al menos 2 tokens significativos con el nombre del docente del curso.

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function normalizeNameKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

// Tokens significativos: descarta iniciales de 1 char y tokens muy comunes
function significantTokens(nameKey) {
  const stopWords = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'EL']);
  return nameKey
    .split(/\s+/)
    .filter(t => t.length >= 3 && !stopWords.has(t));
}

function isTeacherMatch(actorName, teacherName) {
  const actorKey = normalizeNameKey(actorName);
  const teacherKey = normalizeNameKey(teacherName);

  // Coincidencia exacta primero
  if (actorKey === teacherKey) return true;

  const actorTokens = new Set(significantTokens(actorKey));
  const teacherTokens = significantTokens(teacherKey);

  let shared = 0;
  for (const token of teacherTokens) {
    if (actorTokens.has(token)) shared++;
  }
  return shared >= 2;
}

async function main() {
  // 1. Traer cursos con docente y su reporte de actividad más reciente
  const courses = await prisma.course.findMany({
    where: { teacherId: { not: null } },
    select: {
      id: true,
      nrc: true,
      teacher: { select: { fullName: true } },
      activityReports: {
        select: { id: true, importedAt: true },
        orderBy: { importedAt: 'desc' },
        take: 1,
      },
    },
  });

  const coursesWithReport = courses.filter(c => c.activityReports.length > 0 && c.teacher?.fullName);
  console.log(`Cursos con docente y reporte de actividad: ${coursesWithReport.length}`);

  let totalUpdated = 0;
  let totalChecked = 0;
  let coursesFixed = 0;

  for (const course of coursesWithReport) {
    const reportId = course.activityReports[0].id;
    const teacherName = course.teacher.fullName;

    // 2. Traer eventos NO_CLASIFICADO del reporte (agrupados por actorName)
    const groups = await prisma.moodleActivityEvent.groupBy({
      by: ['actorName'],
      where: { reportId, actorCategory: 'NO_CLASIFICADO' },
      _count: { _all: true },
    });

    if (groups.length === 0) continue;

    // 3. Filtrar los actores que coinciden con el docente
    const matchingActors = groups
      .map(g => g.actorName)
      .filter(name => name && isTeacherMatch(name, teacherName));

    if (matchingActors.length === 0) continue;

    totalChecked += groups.reduce((s, g) => s + g._count._all, 0);

    // 4. Actualizar esos eventos
    const result = await prisma.moodleActivityEvent.updateMany({
      where: {
        reportId,
        actorCategory: 'NO_CLASIFICADO',
        actorName: { in: matchingActors },
      },
      data: { actorCategory: 'DOCENTE' },
    });

    totalUpdated += result.count;
    coursesFixed++;
    console.log(
      `  NRC ${course.nrc} | docente: "${teacherName}" | actor(es): ${JSON.stringify(matchingActors)} | eventos: ${result.count}`
    );
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`Cursos reclasificados: ${coursesFixed}`);
  console.log(`Eventos actualizados: ${totalUpdated}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
