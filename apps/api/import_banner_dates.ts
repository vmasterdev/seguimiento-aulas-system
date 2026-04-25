import { PrismaClient } from '@prisma/client';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const CSV_PATH = '/home/uvan/banner-batch-run-20260317-1508/storage/exports/full-202615-dates-2026-03-25T13-33-36.093Z.csv';
const PERIOD_CODE = '202615';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

// Simple CSV parser
async function parseCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const rl = createInterface({ input: createReadStream(filePath) });
  let headers: string[] | null = null;

  await new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      const fields: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { fields.push(current); current = ''; continue; }
        current += ch;
      }
      fields.push(current);

      if (!headers) { headers = fields; return; }
      const row: Record<string, string> = {};
      headers!.forEach((h, i) => row[h] = fields[i] ?? '');
      rows.push(row);
    });
    rl.on('close', resolve);
  });

  return rows;
}

async function main() {
  const rows = await parseCsv(CSV_PATH);
  console.log(`Loaded ${rows.length} rows`);

  const withDates = rows.filter(r => r.start_date || r.end_date);
  console.log(`With dates: ${withDates.length}`);

  // Get period id
  const period = await prisma.period.findFirst({ where: { code: PERIOD_CODE } });
  if (!period) throw new Error(`Period ${PERIOD_CODE} not found`);
  console.log(`Period id: ${period.id}`);

  let updated = 0;
  let skipped = 0;

  for (const row of withDates) {
    const nrc = row.nrc.split('-').pop()!.trim();
    const startDate = row.start_date || null;
    const endDate = row.end_date || null;

    const result = await prisma.course.updateMany({
      where: { nrc, periodId: period.id },
      data: { bannerStartDate: startDate, bannerEndDate: endDate }
    });

    if (result.count > 0) updated++;
    else skipped++;
  }

  console.log(`Updated: ${updated}, Skipped: ${skipped}`);

  // Verify
  const total = await prisma.course.count({ where: { periodId: period.id } });
  const withStart = await prisma.course.count({
    where: { periodId: period.id, bannerStartDate: { not: null } }
  });
  console.log(`DB: ${withStart}/${total} courses with bannerStartDate`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
