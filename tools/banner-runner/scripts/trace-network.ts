import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { BannerClient } from "../src/banner/bannerClient.js";
import { loadBannerProfile } from "../src/config/bannerProfile.js";
import { loadConfig } from "../src/config/env.js";
import { createLogger } from "../src/logging/logger.js";
import { ensureStoragePaths } from "../src/storage/fsPaths.js";

interface CapturedRequest {
  type: "request";
  url: string;
  method: string;
  resourceType: string;
  postData: string | null;
}

interface CapturedResponse {
  type: "response";
  url: string;
  method: string;
  status: number;
  ok: boolean;
  resourceType: string;
  bodySnippet: string | null;
}

type CapturedEvent = CapturedRequest | CapturedResponse;

async function main() {
  const [, , nrc, period] = process.argv;

  if (!nrc || !period) {
    throw new Error("Uso: pnpm exec tsx scripts/trace-network.ts <nrc> <period>");
  }

  const config = loadConfig();

  await ensureStoragePaths({
    root: config.storage.root,
    evidenceDir: config.storage.evidenceDir,
    exportsDir: config.storage.exportsDir,
    logsDir: config.logging.logsDir,
    authDir: config.storage.authDir
  });

  const outputDir = path.join(config.storage.root, "network-traces");
  await mkdir(outputDir, { recursive: true });

  const logger = createLogger(config.logging.logsDir, config.logging.level);
  const profile = await loadBannerProfile(config.banner.profilePath);
  const client = new BannerClient(config, profile, logger);
  const session = await client.createSession({
    headless: false
  });

  const captured: CapturedEvent[] = [];

  session.page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("uniminuto.edu")) {
      return;
    }

    captured.push({
      type: "request",
      url,
      method: request.method(),
      resourceType: request.resourceType(),
      postData: request.postData() ?? null
    });
  });

  session.page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("uniminuto.edu")) {
      return;
    }

    const request = response.request();
    const contentType = response.headers()["content-type"] ?? "";
    const shouldReadBody =
      contentType.includes("json") ||
      contentType.includes("javascript") ||
      contentType.includes("xml") ||
      contentType.includes("html");

    let bodySnippet: string | null = null;

    if (shouldReadBody) {
      const rawBody = (await response.text().catch(() => null)) ?? null;
      const snippetLength = url.includes("/rest-services/message/") ? 1000000 : 4000;
      bodySnippet = rawBody?.slice(0, snippetLength) ?? null;
    }

    captured.push({
      type: "response",
      url,
      method: request.method(),
      status: response.status(),
      ok: response.ok(),
      resourceType: request.resourceType(),
      bodySnippet
    });
  });

  try {
    await session.login({
      username: config.banner.username,
      password: config.banner.password
    });
    await session.prepareLookup();
    await session.lookup({ nrc, period });
  } finally {
    const outputPath = path.join(
      outputDir,
      `trace-${period}-${nrc}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
    await writeFile(outputPath, JSON.stringify(captured, null, 2), "utf8");
    console.log(JSON.stringify({ outputPath, events: captured.length }, null, 2));
    await session.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
