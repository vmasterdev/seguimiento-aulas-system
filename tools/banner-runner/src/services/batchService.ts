import { errorMessage } from "../core/errors.js";
import type { AppConfig } from "../config/env.js";
import type {
  BatchItem,
  BatchProcessOptions,
  BatchProcessSummary,
  BannerCredentials
} from "../core/types.js";
import { QueryStatus, ResultStatus } from "../core/types.js";
import { BannerClient, type LookupAutomationSession } from "../banner/bannerClient.js";
import { BannerQueryRepository } from "../db/repositories/bannerQueryRepository.js";
import { BannerResultRepository } from "../db/repositories/bannerResultRepository.js";
import { BannerSessionRepository } from "../db/repositories/bannerSessionRepository.js";
import type { AppLogger } from "../logging/logger.js";
import { LookupService } from "./lookupService.js";

function itemKey(item: BatchItem): string {
  return `${item.nrc}::${item.period ?? ""}`;
}

function resolveCredentials(config: AppConfig): BannerCredentials {
  if (!config.banner.username || !config.banner.password) {
    throw new Error("BANNER_USERNAME y BANNER_PASSWORD son obligatorios para ejecutar consultas");
  }

  return {
    username: config.banner.username,
    password: config.banner.password
  };
}

function summarizeCounts(counts: Record<ResultStatus, number>) {
  const processedCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const errorCount = counts[ResultStatus.ERROR];
  const successCount = processedCount - errorCount;

  return {
    processedCount,
    successCount,
    errorCount
  };
}

function partitionItems(items: BatchItem[], workers: number): BatchItem[][] {
  const buckets = Array.from({ length: workers }, () => [] as BatchItem[]);

  items.forEach((item, index) => {
    buckets[index % workers]!.push(item);
  });

  return buckets.filter((bucket) => bucket.length > 0);
}

function deriveQueryStatus(
  counts: Record<ResultStatus, number>,
  totalRequested: number
): QueryStatus {
  const processedCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const errorCount = counts[ResultStatus.ERROR];

  if (processedCount === 0 && totalRequested > 0) {
    return QueryStatus.FAILED;
  }

  if (errorCount > 0 && processedCount === errorCount) {
    return QueryStatus.FAILED;
  }

  if (errorCount > 0) {
    return QueryStatus.PARTIAL;
  }

  return QueryStatus.COMPLETED;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BatchService {
  constructor(
    private readonly config: AppConfig,
    private readonly queryRepository: BannerQueryRepository,
    private readonly resultRepository: BannerResultRepository,
    private readonly sessionRepository: BannerSessionRepository,
    private readonly lookupService: LookupService,
    private readonly bannerClient: BannerClient,
    private readonly logger: AppLogger
  ) {}

  async process(options: BatchProcessOptions): Promise<BatchProcessSummary> {
    const query = options.queryId
      ? await this.requireQuery(options.queryId)
      : await this.queryRepository.create({
          name: options.queryName ?? `batch-${new Date().toISOString()}`,
          totalRequested: options.items.length,
          ...(options.inputPath ? { inputPath: options.inputPath } : {}),
          ...(options.requestedPeriod ? { requestedPeriod: options.requestedPeriod } : {})
        });

    const items = await this.resolveItems(query.id, options.items, options.resume === true);
    const expectedTotal = options.queryId ? query.totalRequested : options.items.length;

    if (items.length === 0) {
      const counts = await this.resultRepository.countByStatus(query.id);
      return {
        queryId: query.id,
        queryName: query.name,
        processed: Object.values(counts).reduce((sum, value) => sum + value, 0),
        total: expectedTotal,
        counts
      };
    }

    const credentials = resolveCredentials(this.config);
    const requestedWorkerCount = Math.min(
      Math.max(options.workers ?? this.config.banner.batchWorkers, 1),
      items.length
    );
    const workerCount =
      this.config.banner.lookupEngine === "backend" ? 1 : requestedWorkerCount;

    await this.queryRepository.markRunning(
      query.id,
      options.queryId ? undefined : options.items.length
    );

    const sessionRecord = await this.sessionRepository.create({
      queryId: query.id,
      bannerBaseUrl: this.config.banner.baseUrl,
      loginUrl: this.config.banner.loginUrl,
      metadata: {
        totalRequested: options.items.length,
        resumed: options.resume === true
      }
    });

    this.logger.info("Iniciando lote Banner", {
      queryId: query.id,
      totalRequested: options.items.length,
      pending: items.length,
      workers: workerCount
    });

    try {
      await this.sessionRepository.finish(sessionRecord.id, {
        success: true,
        metadata: {
          counts: {},
          orchestrator: true,
          workers: workerCount
        }
      });

      const workerBatches = partitionItems(items, workerCount);
      const workerResults =
        this.config.banner.lookupEngine === "backend" && workerCount > 1
          ? await this.processBackendParallelWorkers({
              queryId: query.id,
              workerBatches,
              workerCount,
              credentials,
              ...(options.requestedPeriod ? { requestedPeriod: options.requestedPeriod } : {})
            })
          : await Promise.allSettled(
              workerBatches.map((workerItems, index) =>
                this.processWorker({
                  queryId: query.id,
                  workerIndex: index + 1,
                  workerCount,
                  items: workerItems,
                  credentials,
                  ...(options.requestedPeriod ? { requestedPeriod: options.requestedPeriod } : {})
                })
              )
            );

      const counts = await this.resultRepository.countByStatus(query.id);
      const counterSummary = summarizeCounts(counts);
      const status = deriveQueryStatus(counts, expectedTotal);
      const workerErrors = workerResults
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => errorMessage(result.reason));

      await this.queryRepository.finish(query.id, status, counterSummary);

      if (workerErrors.length > 0) {
        throw new Error(workerErrors.join(" | "));
      }

      return {
        queryId: query.id,
        queryName: query.name,
        processed: counterSummary.processedCount,
        total: expectedTotal,
        counts
      };
    } catch (error) {
      const counts = await this.resultRepository.countByStatus(query.id);
      const counterSummary = summarizeCounts(counts);
      const status = deriveQueryStatus(counts, expectedTotal);
      await this.queryRepository.finish(query.id, status, counterSummary);

      throw error;
    }
  }

  private async processWorker(params: {
    queryId: string;
    workerIndex: number;
    workerCount: number;
    items: BatchItem[];
    credentials: BannerCredentials;
    requestedPeriod?: string;
  }): Promise<void> {
    const sessionRecord = await this.sessionRepository.create({
      queryId: params.queryId,
      bannerBaseUrl: this.config.banner.baseUrl,
      loginUrl: this.config.banner.loginUrl,
      metadata: {
        workerIndex: params.workerIndex,
        workerCount: params.workerCount,
        totalRequested: params.items.length
      }
    });
    const automationSession = await this.bannerClient.createSession();

    try {
      if (this.config.banner.lookupEngine === "backend" && params.workerCount > 1) {
        await delay((params.workerIndex - 1) * 4000);
      }

      await automationSession.login(params.credentials);
      await automationSession.prepareLookup();
      await this.processWorkerItems(params, sessionRecord.id, automationSession);

      await this.sessionRepository.finish(sessionRecord.id, {
        success: true,
        metadata: {
          workerIndex: params.workerIndex,
          workerCount: params.workerCount,
          processed: params.items.length
        }
      });
    } catch (error) {
      await this.sessionRepository.finish(sessionRecord.id, {
        success: false,
        metadata: {
          workerIndex: params.workerIndex,
          workerCount: params.workerCount,
          error: errorMessage(error)
        }
      });
      throw error;
    } finally {
      await automationSession.close();
    }
  }

  private async processBackendParallelWorkers(params: {
    queryId: string;
    workerBatches: BatchItem[][];
    workerCount: number;
    credentials: BannerCredentials;
    requestedPeriod?: string;
  }): Promise<PromiseSettledResult<void>[]> {
    const sharedSession = await this.bannerClient.createSession();

    try {
      await sharedSession.login(params.credentials);
      await sharedSession.prepareLookup();

      const lookupSessions = await sharedSession.createParallelLookupSessions(params.workerBatches.length);

      return Promise.allSettled(
        params.workerBatches.map(async (items, index) => {
          const workerIndex = index + 1;
          const sessionRecord = await this.sessionRepository.create({
            queryId: params.queryId,
            bannerBaseUrl: this.config.banner.baseUrl,
            loginUrl: this.config.banner.loginUrl,
            metadata: {
              workerIndex,
              workerCount: params.workerCount,
              totalRequested: items.length,
              transport: "shared-backend-session"
            }
          });

          try {
            const workerParams = {
              queryId: params.queryId,
              workerIndex,
              workerCount: params.workerCount,
              items,
              credentials: params.credentials
            } as {
              queryId: string;
              workerIndex: number;
              workerCount: number;
              items: BatchItem[];
              credentials: BannerCredentials;
              requestedPeriod?: string;
            };

            if (params.requestedPeriod) {
              workerParams.requestedPeriod = params.requestedPeriod;
            }

            await this.processWorkerItems(
              workerParams,
              sessionRecord.id,
              lookupSessions[index]!
            );

            await this.sessionRepository.finish(sessionRecord.id, {
              success: true,
              metadata: {
                workerIndex,
                workerCount: params.workerCount,
                processed: items.length,
                transport: "shared-backend-session"
              }
            });
          } catch (error) {
            await this.sessionRepository.finish(sessionRecord.id, {
              success: false,
              metadata: {
                workerIndex,
                workerCount: params.workerCount,
                error: errorMessage(error),
                transport: "shared-backend-session"
              }
            });
            throw error;
          }
        })
      );
    } finally {
      await sharedSession.close();
    }
  }

  private async processWorkerItems(
    params: {
      queryId: string;
      workerIndex: number;
      workerCount: number;
      items: BatchItem[];
      credentials: BannerCredentials;
      requestedPeriod?: string;
    },
    sessionId: string,
    automationSession: LookupAutomationSession
  ): Promise<void> {
    for (const item of params.items) {
      this.logger.info("Preparando NRC en Banner", {
        queryId: params.queryId,
        worker: params.workerIndex,
        nrc: item.nrc,
        period: item.period ?? params.requestedPeriod ?? ""
      });

      const request = {
        nrc: item.nrc
      } as { nrc: string; period?: string };
      const period = item.period ?? params.requestedPeriod;

      if (period) {
        request.period = period;
      }

      this.logger.info("Ejecutando lookup NRC", {
        queryId: params.queryId,
        worker: params.workerIndex,
        nrc: request.nrc,
        period: request.period ?? ""
      });

      const result = await this.lookupService.execute({
        automationSession,
        queryId: params.queryId,
        sessionId,
        request
      });

      this.logger.info("Lookup NRC finalizado", {
        queryId: params.queryId,
        worker: params.workerIndex,
        nrc: request.nrc,
        period: request.period ?? "",
        status: result.status
      });
    }
  }

  private async requireQuery(queryId: string) {
    const query = await this.queryRepository.findById(queryId);
    if (!query) {
      throw new Error(`No existe banner_query con id ${queryId}`);
    }

    return query;
  }

  private async resolveItems(
    queryId: string,
    items: BatchItem[],
    resume: boolean
  ): Promise<BatchItem[]> {
    if (!resume) {
      return items;
    }

    const existingKeys = await this.resultRepository.findExistingKeys(queryId);
    const pending = items.filter((item) => !existingKeys.has(itemKey(item)));

    this.logger.info("Lote en modo reanudacion", {
      queryId,
      total: items.length,
      pendientes: pending.length
    });

    return pending;
  }
}
