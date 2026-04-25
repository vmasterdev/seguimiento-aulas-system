import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import type { EvidencePaths } from "../core/types.js";
import type { AppLogger } from "../logging/logger.js";

export class EvidenceService {
  constructor(
    private readonly evidenceDir: string,
    private readonly logger: AppLogger
  ) {}

  async capture(
    page: Page,
    params: { queryId: string; nrc: string; period?: string; label: string }
  ): Promise<EvidencePaths> {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const period = params.period?.trim() || "sin-periodo";
    const dir = path.join(this.evidenceDir, params.queryId, `${params.nrc}-${period}-${timestamp}`);

    await mkdir(dir, { recursive: true });

    const screenshotFile = path.join(dir, `${params.label}.png`);
    const htmlFile = path.join(dir, `${params.label}.html`);

    let screenshotPath: string | null = null;
    let htmlPath: string | null = null;

    try {
      await page.screenshot({
        path: screenshotFile,
        fullPage: true
      });
      screenshotPath = path.relative(process.cwd(), screenshotFile);
    } catch (error) {
      this.logger.warn("No fue posible guardar screenshot", {
        queryId: params.queryId,
        nrc: params.nrc,
        error: String(error)
      });
    }

    try {
      const html = await page.content();
      await writeFile(htmlFile, html, "utf8");
      htmlPath = path.relative(process.cwd(), htmlFile);
    } catch (error) {
      this.logger.warn("No fue posible guardar HTML", {
        queryId: params.queryId,
        nrc: params.nrc,
        error: String(error)
      });
    }

    return {
      screenshotPath,
      htmlPath
    };
  }
}
