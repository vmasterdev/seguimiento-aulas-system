import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BatchItem } from "../core/types.js";

function parseDelimitedLine(line: string, delimiter = ","): string[] {
  const result: string[] = [];
  let buffer = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        buffer += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      result.push(buffer.trim());
      buffer = "";
      continue;
    }

    buffer += char;
  }

  result.push(buffer.trim());
  return result;
}

function detectDelimiter(line: string): "," | ";" {
  const commaCount = (line.match(/,/g) ?? []).length;
  const semicolonCount = (line.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function normalizeNrc(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const lastSegment = trimmed.split("-").pop()?.trim() ?? trimmed;
  return lastSegment || trimmed;
}

function normalizeRecord(nrc: string, period?: string, lineNumber?: number): BatchItem | null {
  const cleanNrc = normalizeNrc(nrc);
  const cleanPeriod = period?.trim();

  if (!cleanNrc) {
    return null;
  }

  const item: BatchItem = {
    nrc: cleanNrc
  };

  if (cleanPeriod) {
    item.period = cleanPeriod;
  }

  if (lineNumber !== undefined) {
    item.lineNumber = lineNumber;
  }

  return item;
}

function dedupe(items: BatchItem[]): BatchItem[] {
  const seen = new Set<string>();
  const output: BatchItem[] = [];

  for (const item of items) {
    const key = `${item.nrc}::${item.period ?? ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

function parseCsv(content: string): BatchItem[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const firstLine = lines[0]!;
  const delimiter = detectDelimiter(firstLine);
  const header = parseDelimitedLine(firstLine, delimiter);
  const normalizedHeader = header.map((value) => value.toLowerCase());
  const hasHeader = normalizedHeader.includes("nrc");
  const nrcIndex = hasHeader ? normalizedHeader.indexOf("nrc") : 0;
  const periodIndex = hasHeader
    ? normalizedHeader.findIndex((value) => value === "period" || value === "periodo")
    : 1;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dedupe(
    dataLines
      .map((line, index) => {
        const values = parseDelimitedLine(line, delimiter);
        return normalizeRecord(
          values[nrcIndex] ?? "",
          periodIndex >= 0 ? values[periodIndex] : undefined,
          index + (hasHeader ? 2 : 1)
        );
      })
      .filter((item): item is BatchItem => item !== null)
  );
}

function parseTxt(content: string): BatchItem[] {
  return dedupe(
    content
      .split(/\r?\n/)
      .map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          return null;
        }

        const separator = trimmed.includes(",") ? "," : trimmed.includes(";") ? ";" : undefined;
        if (!separator) {
          return normalizeRecord(trimmed, undefined, index + 1);
        }

        const [nrc, period] = parseDelimitedLine(trimmed, separator);
        return normalizeRecord(nrc ?? "", period, index + 1);
      })
      .filter((item): item is BatchItem => item !== null)
  );
}

export async function readBatchInput(filePath: string): Promise<BatchItem[]> {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const content = await readFile(absolutePath, "utf8");
  const extension = path.extname(absolutePath).toLowerCase();

  if (extension === ".csv") {
    return parseCsv(content);
  }

  if (extension === ".txt") {
    return parseTxt(content);
  }

  throw new Error(`Formato de entrada no soportado: ${extension || "sin extension"}`);
}

export const inputParsers = {
  parseCsv,
  parseTxt
};
