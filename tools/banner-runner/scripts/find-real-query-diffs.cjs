const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

function normalizeNrc(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.split("-").pop().trim();
}

function loadOriginal(csvPath) {
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
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
  const prisma = new PrismaClient();

  try {
    const original = loadOriginal(csvPath);
    const results = await prisma.bannerResult.findMany({
      where: { queryId },
      select: { nrc: true, period: true, teacherId: true, teacherName: true, status: true },
      orderBy: [{ period: "asc" }, { nrc: "asc" }]
    });

    const changedTeacherId = [];
    const nowWithoutTeacher = [];

    for (const result of results) {
      const before = original.get(`${result.nrc}::${result.period}`);
      if (!before) {
        continue;
      }

      const beforeId = before.teacherId;
      const beforeName = before.teacherName;
      const nowId = String(result.teacherId || "").trim();
      const nowName = String(result.teacherName || "").trim();

      if (beforeId !== nowId && (beforeId || nowId)) {
        changedTeacherId.push({
          nrc: result.nrc,
          period: result.period,
          before: { teacherId: beforeId, teacherName: beforeName },
          now: { teacherId: nowId, teacherName: nowName },
          status: result.status
        });
      }

      if ((beforeId || beforeName) && !nowId && !nowName) {
        nowWithoutTeacher.push({
          nrc: result.nrc,
          period: result.period,
          before: { teacherId: beforeId, teacherName: beforeName },
          now: { teacherId: nowId, teacherName: nowName },
          status: result.status
        });
      }
    }

    console.log(JSON.stringify({ changedTeacherId, nowWithoutTeacher }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
