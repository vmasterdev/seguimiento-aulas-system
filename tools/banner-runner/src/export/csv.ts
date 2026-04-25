function escapeValue(value: unknown): string {
  const normalized = String(value ?? "");
  if (normalized.includes(",") || normalized.includes("\"") || normalized.includes("\n")) {
    return `"${normalized.replaceAll("\"", "\"\"")}"`;
  }

  return normalized;
}

export function stringifyCsv<T extends Record<string, unknown>>(rows: T[]): string {
  const firstRow = rows[0];
  if (!firstRow) {
    return "";
  }

  const headers = Object.keys(firstRow);
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeValue(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
}
