import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { BannerQueryRepository } from "../db/repositories/bannerQueryRepository.js";
import { BannerResultRepository } from "../db/repositories/bannerResultRepository.js";
import type { AppLogger } from "../logging/logger.js";
import { stringifyCsv } from "./csv.js";

export interface ExportOutput {
  csvPath?: string;
  jsonPath?: string;
}

function additionalDataValue(additionalData: unknown, fieldName: string): string {
  if (!additionalData || typeof additionalData !== "object" || Array.isArray(additionalData)) {
    return "";
  }

  const value = (additionalData as Record<string, unknown>)[fieldName];
  return typeof value === "string" ? value : "";
}

export class ExportService {
  constructor(
    private readonly queryRepository: BannerQueryRepository,
    private readonly resultRepository: BannerResultRepository,
    private readonly exportsDir: string,
    private readonly logger: AppLogger
  ) {}

  async exportQueryResults(
    queryId: string,
    formats: Array<"csv" | "json">
  ): Promise<ExportOutput> {
    await mkdir(this.exportsDir, { recursive: true });

    const query = await this.queryRepository.findById(queryId);
    const results = await this.resultRepository.findByQueryId(queryId);
    const rows = results.map((result) => ({
      query_id: result.queryId,
      nrc: result.nrc,
      period: result.period,
      teacher_name: result.teacherName ?? "",
      teacher_id: result.teacherId ?? "",
      program_name: result.programName ?? "",
      status: result.status,
      error_message: result.errorMessage ?? "",
      checked_at: result.checkedAt.toISOString(),
      screenshot_path: result.screenshotPath ?? "",
      html_path: result.htmlPath ?? "",
      raw_payload: JSON.stringify(result.rawPayload ?? {}),
      additional_data: JSON.stringify(result.additionalData ?? {}),
      start_date: additionalDataValue(result.additionalData, "startDate"),
      end_date: additionalDataValue(result.additionalData, "endDate")
    }));

    const timestamp = formatExportTimestamp(new Date());
    const baseName = buildExportBaseName(query?.name, queryId, timestamp);
    const output: ExportOutput = {};

    if (formats.includes("csv")) {
      const csvPath = path.join(this.exportsDir, `${baseName}.csv`);
      await writeFile(csvPath, stringifyCsv(rows), "utf8");
      output.csvPath = path.relative(process.cwd(), csvPath);
    }

    if (formats.includes("json")) {
      const jsonPath = path.join(this.exportsDir, `${baseName}.json`);
      await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");
      output.jsonPath = path.relative(process.cwd(), jsonPath);
    }

    this.logger.info("Exportacion completada", {
      queryId,
      formats
    });

    return output;
  }
}

export function buildExportBaseName(
  queryName: string | null | undefined,
  queryId: string,
  timestamp: string
): string {
  const readableName = sanitizeFilenameSegment(queryName);
  if (readableName) {
    return `${readableName}-${timestamp}`;
  }

  return `consulta-${queryId}-${timestamp}`;
}

function sanitizeFilenameSegment(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatExportTimestamp(value: Date): string {
  return value.toISOString().replaceAll(":", "-");
}
