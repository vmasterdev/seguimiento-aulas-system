import { Command } from "commander";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { BannerClient } from "./banner/bannerClient.js";
import { loadBannerProfile } from "./config/bannerProfile.js";
import { loadConfig } from "./config/env.js";
import { getPrismaClient } from "./db/prisma.js";
import { BannerQueryRepository } from "./db/repositories/bannerQueryRepository.js";
import { BannerResultRepository } from "./db/repositories/bannerResultRepository.js";
import { BannerSessionRepository } from "./db/repositories/bannerSessionRepository.js";
import { EvidenceService } from "./evidence/evidenceService.js";
import { ExportService } from "./export/exportService.js";
import { readBatchInput } from "./input/nrcInput.js";
import { createLogger } from "./logging/logger.js";
import { BatchService } from "./services/batchService.js";
import { EnrollmentExportService } from "./services/enrollmentExportService.js";
import { LookupService } from "./services/lookupService.js";
import { RetryService } from "./services/retryService.js";
import { ensureStoragePaths } from "./storage/fsPaths.js";
import { SpaidenPage } from "./banner/pages/SpaidenPage.js";
import type {
  BannerPersonBatchInputItem,
  BannerPersonBatchItemResult,
  BannerPersonBatchSummary
} from "./core/types.js";

const execFileAsync = promisify(execFile);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRemoteDebugging(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Edge de Windows aun no expone el puerto.
    }

    await sleep(500);
  }

  throw new Error(`No fue posible conectar con Edge en ${url} dentro de ${timeoutMs}ms`);
}

const EDGE_REMOTE_DEBUGGING_TIMEOUT_MS = 45000;

function normalizeSpaidenPersonId(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return trimmed;
  // IDs de 8 o 9 digitos: Banner los acepta como estan (son cedulas ya completas)
  // IDs de 7 digitos o menos: padear a 9 con ceros a la izquierda
  if (trimmed.length >= 8) return trimmed;
  return trimmed.padStart(9, "0");
}

function parseSpaidenBatchInput(raw: string): BannerPersonBatchInputItem[] {
  const parsed = JSON.parse(raw) as unknown;
  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown[] }).items)
      ? (parsed as { items: unknown[] }).items
      : [];

  return source
    .map((item) => {
      if (typeof item === "string") {
        return { personId: item };
      }

      if (item && typeof item === "object" && typeof (item as { personId?: unknown }).personId === "string") {
        return { personId: (item as { personId: string }).personId };
      }

      return null;
    })
    .filter((item): item is BannerPersonBatchInputItem => Boolean(item?.personId?.trim()));
}

async function buildContext() {
  const config = loadConfig();

  await ensureStoragePaths({
    root: config.storage.root,
    evidenceDir: config.storage.evidenceDir,
    exportsDir: config.storage.exportsDir,
    logsDir: config.logging.logsDir,
    authDir: config.storage.authDir
  });

  const logger = createLogger(config.logging.logsDir, config.logging.level);
  const profile = await loadBannerProfile(config.banner.profilePath);
  const prisma = getPrismaClient();

  const queryRepository = new BannerQueryRepository(prisma);
  const resultRepository = new BannerResultRepository(prisma);
  const sessionRepository = new BannerSessionRepository(prisma);
  const evidenceService = new EvidenceService(config.storage.evidenceDir, logger);
  const lookupService = new LookupService(resultRepository, evidenceService, logger);
  const bannerClient = new BannerClient(config, profile, logger);
  const batchService = new BatchService(
    config,
    queryRepository,
    resultRepository,
    sessionRepository,
    lookupService,
    bannerClient,
    logger
  );
  const retryService = new RetryService(
    config,
    queryRepository,
    resultRepository,
    sessionRepository,
    lookupService,
    bannerClient,
    logger
  );
  const exportService = new ExportService(
    queryRepository,
    resultRepository,
    config.storage.exportsDir,
    logger
  );

  return {
    prisma,
    config,
    logger,
    bannerClient,
    batchService,
    retryService,
    exportService
  };
}

async function runWithContext<T>(handler: (context: Awaited<ReturnType<typeof buildContext>>) => Promise<T>) {
  const context = await buildContext();

  try {
    return await handler(context);
  } finally {
    await context.prisma.$disconnect();
  }
}

async function main() {
  const program = new Command();

  program
    .name("banner-docente-nrc")
    .description("Consulta NRC en Banner y persiste resultados localmente.")
    .showHelpAfterError();

  program
    .command("auth")
    .description("Abrir Edge de forma visual para iniciar sesion manual y guardar la sesion")
    .action(async () => {
      await runWithContext(async (context) => {
        if (process.platform !== "win32") {
          const remoteDebuggingUrl = "http://127.0.0.1:9222";
          const edgeUserDataDir = `C:\\Users\\Duvan\\AppData\\Local\\Temp\\banner-docente-edge-profile-${Date.now()}`;
          const loginUrl = "https://genesisadmin.uniminuto.edu/applicationNavigator/seamless";

          await execFileAsync("cmd.exe", [
            "/c",
            "start",
            "",
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "--remote-debugging-port=9222",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${edgeUserDataDir}`,
            "--new-window",
            loginUrl
          ]);

          await sleep(1500);
          await waitForRemoteDebugging(remoteDebuggingUrl, EDGE_REMOTE_DEBUGGING_TIMEOUT_MS);

          process.env.BANNER_REMOTE_DEBUGGING_URL = remoteDebuggingUrl;
          context.config.banner.remoteDebuggingUrl = remoteDebuggingUrl;
        } else {
          process.env.BANNER_REMOTE_DEBUGGING_URL = "";
          context.config.banner.remoteDebuggingUrl = "";
        }

        context.config.banner.headless = false;

        const session = await context.bannerClient.createSession({
          headless: false,
          ignoreStorageState: true
        });

        try {
          await session.openLoginPage();
          console.log(
            "Completa el login y el 2FA en Edge para Banner/Microsoft. Cuando termines, vuelve a esta terminal y presiona Enter para que navegue a SSASECT y guarde la sesion."
          );

          const rl = readline.createInterface({ input, output });

          try {
            await rl.question("");
          } finally {
            rl.close();
          }

          await session.page.goto(context.config.banner.searchUrl, {
            waitUntil: "domcontentloaded",
            timeout: context.config.banner.navigationTimeoutMs
          });

          const authenticated = await session.isAuthenticated(
            Math.min(context.config.banner.navigationTimeoutMs, 10000)
          );

          if (!authenticated) {
            const pageText = await session.page.locator("body").innerText().catch(() => "");
            throw new Error(
              `El login manual no dejo SSASECT disponible. URL actual: ${
                session.page.url()
              }. Vista: ${pageText.slice(0, 180).replace(/\s+/g, " ").trim()}`
            );
          }

          const storageStatePath = await session.saveStorageState();
          console.log(JSON.stringify({ storageStatePath }, null, 2));
        } finally {
          await session.close();
        }
      });
    });

  program
    .command("lookup")
    .description("Buscar un NRC individual")
    .requiredOption("--nrc <nrc>", "NRC a consultar")
    .option("--period <period>", "Periodo academico")
    .option("--query-name <name>", "Nombre de la consulta")
    .action(async (options) => {
      await runWithContext(async (context) => {
        const summary = await context.batchService.process({
          queryName: options.queryName,
          requestedPeriod: options.period,
          items: [{ nrc: options.nrc, period: options.period }]
        });
        console.log(JSON.stringify(summary, null, 2));
      });
    });

  program
    .command("spaiden")
    .description("Abrir SPAIDEN, normalizar el ID y ejecutar el doble Enter inicial")
    .requiredOption("--id <personId>", "ID de la persona a consultar en SPAIDEN")
    .option("--show", "Abrir navegador visible para la prueba", false)
    .action(async (options) => {
      await runWithContext(async (context) => {
        const headless = options.show !== true;
        const session = await context.bannerClient.createSession({ headless });

        try {
          await session.login({
            username: context.config.banner.username,
            password: context.config.banner.password
          });

          let backendResult: Awaited<ReturnType<typeof session.fetchPerson>> | null = null;
          try {
            backendResult = await session.fetchPerson(String(options.id));
            if (backendResult.email) {
              console.log(JSON.stringify(backendResult, null, 2));
              return;
            }
          } catch (error) {
            context.logger.warn("Fallo SPAIDEN por backend; se intenta fallback visual", {
              personId: String(options.id),
              error: error instanceof Error ? error.message : String(error)
            });
          }

          const spaidenPage = new SpaidenPage(session.page, context.config, context.logger, {
            navigationTimeoutMs: context.config.banner.navigationTimeoutMs,
            actionTimeoutMs: context.config.banner.actionTimeoutMs
          });

          const visualResult = await spaidenPage.submitPersonId(String(options.id));
          if (!backendResult) {
            console.log(JSON.stringify(visualResult, null, 2));
            return;
          }

          console.log(
            JSON.stringify(
              {
                ...backendResult,
                lastName: backendResult.lastName ?? visualResult.lastName,
                firstName: backendResult.firstName ?? visualResult.firstName,
                middleName: backendResult.middleName ?? visualResult.middleName,
                email: backendResult.email ?? visualResult.email,
                rawPayload: {
                  ...backendResult.rawPayload,
                  visualFallback: {
                    currentUrl: visualResult.currentUrl,
                    selectorMatched: visualResult.selectorMatched,
                    searchSelectorMatched: visualResult.searchSelectorMatched,
                    emailTabOpened: visualResult.emailTabOpened
                  }
                }
              },
              null,
              2
            )
          );
        } finally {
          await session.close();
        }
      });
    });

  program
    .command("spaiden-batch")
    .description("Consultar SPAIDEN por lote a partir de un JSON con personId")
    .requiredOption("--input <path>", "Ruta al JSON de entrada con personId")
    .option("--output <path>", "Ruta al JSON de salida")
    .option("--show", "Abrir navegador visible para la prueba", false)
    .action(async (options) => {
      await runWithContext(async (context) => {
        const rawInput = await readFile(String(options.input), "utf8");
        const parsedItems = parseSpaidenBatchInput(rawInput);
        const uniqueIds = [...new Set(parsedItems.map((item) => normalizeSpaidenPersonId(item.personId)).filter(Boolean))];

        if (!uniqueIds.length) {
          throw new Error("El archivo de entrada no contiene personId validos para SPAIDEN.");
        }

        const headless = options.show !== true;
        const session = await context.bannerClient.createSession({ headless });

        try {
          await session.login({
            username: context.config.banner.username,
            password: context.config.banner.password
          });

          const items: BannerPersonBatchItemResult[] = [];

          for (const personId of uniqueIds) {
            try {
              const result = await session.fetchPerson(personId);
              items.push({
                ...result,
                errorMessage: null
              });
            } catch (error) {
              items.push({
                personId,
                normalizedPersonId: normalizeSpaidenPersonId(personId),
                lastName: null,
                firstName: null,
                middleName: null,
                email: null,
                status: "NOT_FOUND",
                rawPayload: {},
                errorMessage: error instanceof Error ? error.message : String(error)
              });
            }
          }

          const summary: BannerPersonBatchSummary = {
            ok: true,
            processed: items.length,
            found: items.filter((item) => item.status === "FOUND").length,
            notFound: items.filter((item) => item.status === "NOT_FOUND" && !item.errorMessage).length,
            failed: items.filter((item) => Boolean(item.errorMessage)).length,
            outputPath: options.output ? String(options.output) : null,
            items
          };

          if (summary.outputPath) {
            await writeFile(summary.outputPath, JSON.stringify(summary, null, 2), "utf8");
          }

          console.log(JSON.stringify(summary, null, 2));
        } finally {
          await session.close();
        }
      });
    });

  program
    .command("roster")
    .description("Exportar matricula oficial Banner desde SFAALST para uno o varios NRC")
    .option("--input <path>", "Ruta a CSV/TXT con NRC y periodo")
    .option("--nrc <nrc>", "NRC individual")
    .option("--period <period>", "Periodo academico o periodo por defecto para el archivo")
    .option("--source-label <label>", "Etiqueta del corte exportado")
    .option("--output <path>", "Ruta del CSV de salida")
    .action(async (options) => {
      await runWithContext(async (context) => {
        const items = options.input
          ? await readBatchInput(options.input)
          : options.nrc
            ? [
                {
                  nrc: String(options.nrc).trim(),
                  ...(options.period ? { period: String(options.period).trim() } : {})
                }
              ]
            : [];

        if (!items.length) {
          throw new Error("Debes indicar --input o --nrc para exportar matricula Banner.");
        }

        const service = new EnrollmentExportService(context.config, context.bannerClient, context.logger);
        const summary = await service.process({
          items,
          ...(options.period ? { defaultPeriod: String(options.period).trim() } : {}),
          ...(options.sourceLabel ? { sourceLabel: String(options.sourceLabel).trim() } : {}),
          ...(options.output ? { outputPath: String(options.output).trim() } : {})
        });
        console.log(JSON.stringify(summary, null, 2));
      });
    });

  program
    .command("batch")
    .description("Procesar un lote de NRC desde CSV o TXT")
    .requiredOption("--input <path>", "Ruta al archivo de entrada")
    .option("--period <period>", "Periodo por defecto para registros sin periodo")
    .option("--query-name <name>", "Nombre del lote")
    .option("--query-id <id>", "Reusar una consulta existente")
    .option("--workers <count>", "Numero de workers concurrentes", (value) => Number.parseInt(value, 10))
    .option("--resume", "Continuar solo los NRC pendientes", false)
    .action(async (options) => {
      await runWithContext(async (context) => {
        const items = await readBatchInput(options.input);
        const summary = await context.batchService.process({
          items,
          queryId: options.queryId,
          queryName: options.queryName,
          inputPath: options.input,
          requestedPeriod: options.period,
          resume: options.resume,
          workers: options.workers
        });
        console.log(JSON.stringify(summary, null, 2));
      });
    });

  program
    .command("retry-errors")
    .description("Reintentar registros con estado ERROR")
    .requiredOption("--query-id <id>", "ID de banner_query")
    .option("--workers <count>", "Numero de workers concurrentes", (value) => Number.parseInt(value, 10))
    .action(async (options) => {
      await runWithContext(async (context) => {
        const summary = await context.retryService.retryErrors(options.queryId, options.workers);
        console.log(JSON.stringify(summary, null, 2));
      });
    });

  program
    .command("export")
    .description("Exportar resultados de una consulta a CSV y/o JSON")
    .requiredOption("--query-id <id>", "ID de banner_query")
    .option("--format <formats>", "csv,json | csv | json", "csv,json")
    .action(async (options) => {
      await runWithContext(async (context) => {
        const formats = options.format
          .split(",")
          .map((value: string) => value.trim())
          .filter(Boolean) as Array<"csv" | "json">;
        const output = await context.exportService.exportQueryResults(options.queryId, formats);
        console.log(JSON.stringify(output, null, 2));
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
