import prismaClientModule from "@prisma/client";

const { PrismaClient } = prismaClientModule;

const queryId = process.argv[2];

if (!queryId) {
  console.error("Uso: node scripts/query-progress.mjs <queryId>");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const query = await prisma.bannerQuery.findUnique({
    where: { id: queryId },
    select: {
      id: true,
      name: true,
      totalRequested: true,
      status: true
    }
  });

  if (!query) {
    console.error(`No existe banner_query ${queryId}`);
    process.exit(1);
  }

  const grouped = await prisma.bannerResult.groupBy({
    by: ["status"],
    where: { queryId },
    _count: { _all: true }
  });

  const counts = {
    ENCONTRADO: 0,
    SIN_DOCENTE: 0,
    NO_ENCONTRADO: 0,
    ERROR: 0
  };

  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  const processed =
    counts.ENCONTRADO + counts.SIN_DOCENTE + counts.NO_ENCONTRADO + counts.ERROR;

  console.log(
    JSON.stringify(
      {
        queryId: query.id,
        name: query.name,
        status: query.status,
        totalRequested: query.totalRequested,
        processed,
        counts
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
