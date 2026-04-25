import fs from "node:fs";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function toUtcDate(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function parseSlashDate(value, monthFirst) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const month = monthFirst ? first - 1 : second - 1;
  const day = monthFirst ? second : first;

  return toUtcDate(year, month, day);
}

function parseDateCandidates(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const parsed = toUtcDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    return parsed ? [parsed] : [];
  }

  const bannerMatch = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (bannerMatch) {
    const monthIndex = MONTH_INDEX[bannerMatch[2].toLowerCase()];
    if (monthIndex === undefined) return [];
    const parsed = toUtcDate(Number(bannerMatch[3]), monthIndex, Number(bannerMatch[1]));
    return parsed ? [parsed] : [];
  }

  const candidates = [parseSlashDate(text, true), parseSlashDate(text, false)].filter(Boolean);
  const seen = new Set();
  const unique = [];

  for (const candidate of candidates) {
    const stamp = candidate.getTime();
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    unique.push(candidate);
  }

  return unique;
}

function resolveRange(startDate, endDate) {
  const startCandidates = parseDateCandidates(startDate);
  const endCandidates = parseDateCandidates(endDate);
  let best = null;

  for (const start of startCandidates) {
    for (const end of endCandidates) {
      if (end.getTime() < start.getTime()) continue;
      const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
      if (!best || totalDays < best.totalDays) {
        best = { start, end, totalDays };
      }
    }
  }

  if (best) return best;
  return {
    start: startCandidates[0] ?? null,
    end: endCandidates[0] ?? null,
    totalDays: null,
  };
}

function toIsoDate(date) {
  return date ? date.toISOString().slice(0, 10) : "";
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function durationBand(days) {
  if (typeof days !== "number") return "SIN_FECHA";
  if (days <= 14) return "2_SEMANAS_O_MENOS";
  if (days <= 21) return "3_SEMANAS";
  if (days <= 28) return "4_SEMANAS";
  if (days <= 56) return "5_A_8_SEMANAS";
  return "MAS_DE_8_SEMANAS";
}

function writeCsv(filePath, rows) {
  const header = [
    "course_id",
    "period_code",
    "period_label",
    "nrc",
    "moment",
    "subject_name",
    "start_date",
    "end_date",
    "start_iso_date",
    "end_iso_date",
    "duration_days",
    "short_course",
    "duration_band",
  ];

  const body = rows.map((row) =>
    [
      row.courseId,
      row.periodCode,
      row.periodLabel,
      row.nrc,
      row.moment,
      row.subjectName,
      row.startDate,
      row.endDate,
      row.startIsoDate,
      row.endIsoDate,
      row.durationDays ?? "",
      row.shortCourse,
      row.durationBand,
    ]
      .map(escapeCsv)
      .join(","),
  );

  fs.writeFileSync(filePath, `${[header.join(","), ...body].join("\n")}\n`, "utf8");
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  const data = JSON.parse(input);
  const rows = data.items
    .map((item) => {
      const row = item.rawJson?.row ?? {};
      const startDate = String(
        row.fecha_inicial_1 ?? row.fecha_inicio ?? row.start_date ?? row.fecha_inicial ?? "",
      ).trim();
      const endDate = String(
        row.fecha_final_1 ?? row.fecha_fin ?? row.end_date ?? row.fecha_final ?? "",
      ).trim();
      const range = resolveRange(startDate, endDate);
      const days = typeof range.totalDays === "number" ? range.totalDays : null;

      return {
        courseId: item.id,
        periodCode: item.period?.code ?? "",
        periodLabel: item.period?.label ?? "",
        nrc: item.nrc,
        moment: item.moment ?? "",
        subjectName: item.subjectName ?? "",
        startDate,
        endDate,
        startIsoDate: toIsoDate(range.start),
        endIsoDate: toIsoDate(range.end),
        durationDays: days,
        shortCourse: typeof days === "number" && days <= 28 ? "SI" : "NO",
        durationBand: durationBand(days),
      };
    })
    .sort((left, right) => left.periodCode.localeCompare(right.periodCode) || left.nrc.localeCompare(right.nrc));

  const outDir = path.resolve("storage/outputs/course-dates");
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(outDir, `all-nrc-dates-${stamp}.csv`);
  const shortCsvPath = path.join(outDir, `short-courses-${stamp}.csv`);
  const jsonPath = path.join(outDir, `all-nrc-dates-${stamp}.json`);

  writeCsv(csvPath, rows);
  writeCsv(
    shortCsvPath,
    rows.filter((row) => row.shortCourse === "SI"),
  );

  const byPeriod = {};
  const byDurationBand = {};

  for (const row of rows) {
    byPeriod[row.periodCode] = (byPeriod[row.periodCode] ?? 0) + 1;
    byDurationBand[row.durationBand] = (byDurationBand[row.durationBand] ?? 0) + 1;
  }

  const summary = {
    total: rows.length,
    withBothDates: rows.filter((row) => row.startDate && row.endDate).length,
    shortCourses: rows.filter((row) => row.shortCourse === "SI").length,
    byPeriod,
    byDurationBand,
  };

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
        rows,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        csvPath,
        shortCsvPath,
        jsonPath,
        summary,
      },
      null,
      2,
    ),
  );
});
