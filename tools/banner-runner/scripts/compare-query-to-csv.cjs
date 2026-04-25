const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

function normalizeNrc(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const lastSegment = trimmed.split("-").pop().trim();
  return lastSegment || trimmed;
}

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",");
  const indexByName = {};
  header.forEach((name, index) => {
    indexByName[name] = index;
  });

  const rows = new Map();

  for (const line of lines) {
    const columns = line.split(",");
    const nrc = normalizeNrc(columns[indexByName.nrc]);
    const period = String(columns[indexByName.periodo] || "").trim();

    rows.set(`${nrc}::${period}`, {
      nrc,
      period,
      teacherId: String(columns[indexByName.teacher_id] || "").trim(),
      teacherName: String(columns[indexByName.teacher_name] || "").trim()
    });
  }

  return rows;
}

async function main() {
  const queryId = process.argv[2];
  const csvPath = process.argv[3];

  if (!queryId || !csvPath) {
    throw new Error("Uso: node scripts/compare-query-to-csv.cjs <queryId> <csvPath>");
  }

  const prisma = new PrismaClient();

  try {
    const original = parseCsv(csvPath);
    const query = await prisma.bannerQuery.findUnique({
      where: { id: queryId }
    });
    const results = await prisma.bannerResult.findMany({
      where: { queryId },
      select: {
        nrc: true,
        period: true,
        teacherId: true,
        teacherName: true,
        status: true
      },
      orderBy: [{ period: "asc" }, { nrc: "asc" }]
    });

    let unchanged = 0;
    let changedTeacher = 0;
    let changedTeacherId = 0;
    let nameFormatOnly = 0;
    let nowWithoutTeacher = 0;
    let newlyAssigned = 0;
    let noMatch = 0;
    const changes = [];

    for (const result of results) {
      const key = `${result.nrc}::${result.period}`;
      const before = original.get(key);

      if (!before) {
        noMatch += 1;
        continue;
      }

      const beforeId = before.teacherId;
      const beforeName = before.teacherName;
      const nowId = String(result.teacherId || "").trim();
      const nowName = String(result.teacherName || "").trim();

      if (beforeId === nowId && beforeName === nowName) {
        unchanged += 1;
        continue;
      }

      if ((beforeId || beforeName) && !nowId && !nowName) {
        nowWithoutTeacher += 1;
      } else if ((!beforeId && !beforeName) && (nowId || nowName)) {
        newlyAssigned += 1;
      } else {
        changedTeacher += 1;
        if (beforeId !== nowId) {
          changedTeacherId += 1;
        } else {
          nameFormatOnly += 1;
        }
      }

      changes.push({
        nrc: result.nrc,
        period: result.period,
        status: result.status,
        before: {
          teacherId: beforeId,
          teacherName: beforeName
        },
        now: {
          teacherId: nowId,
          teacherName: nowName
        }
      });
    }

    const startedAt = query?.startedAt ? new Date(query.startedAt) : null;
    const endedAt = query?.endedAt ? new Date(query.endedAt) : null;
    const durationMs = startedAt && endedAt ? endedAt - startedAt : null;

    console.log(
      JSON.stringify(
        {
          queryId,
          queryName: query?.name || null,
          startedAt: startedAt ? startedAt.toISOString() : null,
          endedAt: endedAt ? endedAt.toISOString() : null,
          durationMs,
          durationSeconds: durationMs !== null ? Math.round(durationMs / 1000) : null,
          compared: results.length,
          unchanged,
          changedTeacher,
          changedTeacherId,
          nameFormatOnly,
          nowWithoutTeacher,
          newlyAssigned,
          noMatch,
          sampleChanges: changes.slice(0, 20)
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
