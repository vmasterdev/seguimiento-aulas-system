import fs from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config/env.js";
import type {
  BannerCredentials,
  BannerEnrollmentCoursePayload,
  BatchItem
} from "../core/types.js";
import { BannerClient } from "../banner/bannerClient.js";
import type { AppLogger } from "../logging/logger.js";

function resolveCredentials(config: AppConfig): BannerCredentials {
  if (!config.banner.username || !config.banner.password) {
    throw new Error("BANNER_USERNAME y BANNER_PASSWORD son obligatorios para exportar matricula desde Banner.");
  }

  return {
    username: config.banner.username,
    password: config.banner.password
  };
}

function dedupeItems(items: BatchItem[], defaultPeriod?: string): BatchItem[] {
  const seen = new Set<string>();
  const output: BatchItem[] = [];

  for (const item of items) {
    const nrc = item.nrc.trim();
    const period = (item.period ?? defaultPeriod ?? "").trim();
    if (!nrc || !period) {
      continue;
    }

    const key = `${period}::${nrc}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push({
      nrc,
      period,
      ...(item.lineNumber !== undefined ? { lineNumber: item.lineNumber } : {})
    });
  }

  return output;
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function safeFileToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "banner-enrollment";
}

export interface BannerEnrollmentExportSummary {
  ok: true;
  kind: "banner-enrollment";
  sourceLabel: string | null;
  outputPath: string;
  outputJsonPath: string;
  processedCourses: number;
  foundCourses: number;
  emptyCourses: number;
  failedCourses: number;
  totalStudents: number;
}

export class EnrollmentExportService {
  constructor(
    private readonly config: AppConfig,
    private readonly bannerClient: BannerClient,
    private readonly logger: AppLogger
  ) {}

  async process(options: {
    items: BatchItem[];
    defaultPeriod?: string;
    sourceLabel?: string;
    outputPath?: string;
  }): Promise<BannerEnrollmentExportSummary> {
    const credentials = resolveCredentials(this.config);
    const items = dedupeItems(options.items, options.defaultPeriod);

    if (!items.length) {
      throw new Error("Debes indicar al menos un NRC con periodo para exportar matricula Banner.");
    }

    const sourceLabel = options.sourceLabel?.trim() || null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseName = sourceLabel ? safeFileToken(sourceLabel) : `banner-enrollment-${stamp}`;
    const outputPath = options.outputPath?.trim()
      ? path.resolve(options.outputPath)
      : path.join(this.config.storage.exportsDir, `${baseName}-${stamp}.csv`);
    const outputJsonPath = outputPath.replace(/\.csv$/i, ".json");

    const session = await this.bannerClient.createSession();
    const courses: Array<
      | (BannerEnrollmentCoursePayload & { errorMessage?: undefined })
      | {
          nrc: string;
          period: string;
          status: "ERROR";
          errorMessage: string;
        }
    > = [];

    try {
      await session.login(credentials);
      await session.prepareLookup();

      for (const item of items) {
        this.logger.info("Consultando matricula oficial Banner", {
          nrc: item.nrc,
          period: item.period ?? ""
        });

        try {
          const result = await session.fetchEnrollment({
            nrc: item.nrc,
            ...(item.period ? { period: item.period } : {})
          });
          courses.push(result);
          this.logger.info("Matricula Banner obtenida", {
            nrc: result.nrc,
            period: result.period,
            students: result.students.length,
            status: result.status
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          courses.push({
            nrc: item.nrc,
            period: item.period ?? "",
            status: "ERROR",
            errorMessage
          });
          this.logger.warn("Fallo consulta de matricula Banner", {
            nrc: item.nrc,
            period: item.period ?? "",
            error: errorMessage
          });
        }
      }
    } finally {
      await session.close();
    }

    const csvLines = [
      [
        "source_label",
        "periodo",
        "nrc",
        "descripcion_periodo",
        "materia_alfa",
        "curso_numero",
        "secuencia",
        "registro",
        "id estudiante",
        "nombre completo",
        "estado",
        "fecha estado",
        "modalidad",
        "creditos",
        "rolled"
      ].join(",")
    ];

    let foundCourses = 0;
    let emptyCourses = 0;
    let failedCourses = 0;
    let totalStudents = 0;

    for (const course of courses) {
      if (course.status === "ERROR") {
        failedCourses += 1;
        continue;
      }

      if (course.students.length > 0) {
        foundCourses += 1;
      } else {
        emptyCourses += 1;
      }

      totalStudents += course.students.length;

      for (const student of course.students) {
        csvLines.push(
          [
            sourceLabel,
            course.period,
            course.nrc,
            course.termDescription ?? "",
            course.subjectCode ?? "",
            course.courseNumber ?? "",
            course.sequenceNumber ?? "",
            student.registrationSequence,
            student.institutionalId ?? "",
            student.fullName ?? "",
            student.statusCode ?? "",
            student.statusDate ?? "",
            student.gradeMode ?? "",
            student.creditHours ?? "",
            student.rolled === null ? "" : student.rolled ? "Y" : "N"
          ]
            .map((value) => escapeCsvCell(value))
            .join(",")
        );
      }
    }

    await fs.writeFile(outputPath, `${csvLines.join("\n")}\n`, "utf8");
    await fs.writeFile(
      outputJsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          sourceLabel,
          processedCourses: courses.length,
          foundCourses,
          emptyCourses,
          failedCourses,
          totalStudents,
          courses
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      ok: true,
      kind: "banner-enrollment",
      sourceLabel,
      outputPath,
      outputJsonPath,
      processedCourses: courses.length,
      foundCourses,
      emptyCourses,
      failedCourses,
      totalStudents
    };
  }
}
