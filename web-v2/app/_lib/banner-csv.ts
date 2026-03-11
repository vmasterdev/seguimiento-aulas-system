type CsvRecord = Record<string, string>;

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

export function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const source = stripBom(content);

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }

      cell += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    if (char === '\r') {
      if (source[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((item) => item.some((cellValue) => cellValue.trim() !== ''));
}

export function parseCsvRecords(content: string): CsvRecord[] {
  const rows = parseCsvRows(content);
  if (!rows.length) return [];

  const headers = rows[0].map((value) => value.trim());
  const records: CsvRecord[] = [];

  for (const row of rows.slice(1)) {
    const record: CsvRecord = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = row[index] ?? '';
    });
    records.push(record);
  }

  return records;
}
