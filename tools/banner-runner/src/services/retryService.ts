import type { AppConfig } from "../config/env.js";
import { ResultStatus } from "../core/types.js";
import { BannerQueryRepository } from "../db/repositories/bannerQueryRepository.js";
import { BannerResultRepository } from "../db/repositories/bannerResultRepository.js";
import { BannerSessionRepository } from "../db/repositories/bannerSessionRepository.js";
import type { AppLogger } from "../logging/logger.js";
import { BannerClient } from "../banner/bannerClient.js";
import { LookupService } from "./lookupService.js";
import { BatchService } from "./batchService.js";

export class RetryService {
  private readonly batchService: BatchService;

  constructor(
    config: AppConfig,
    private readonly queryRepository: BannerQueryRepository,
    private readonly resultRepository: BannerResultRepository,
    sessionRepository: BannerSessionRepository,
    lookupService: LookupService,
    bannerClient: BannerClient,
    private readonly logger: AppLogger
  ) {
    this.batchService = new BatchService(
      config,
      queryRepository,
      resultRepository,
      sessionRepository,
      lookupService,
      bannerClient,
      logger
    );
  }

  async retryErrors(queryId: string, workers?: number) {
    const candidates = await this.resultRepository.findRetryCandidates(queryId, [ResultStatus.ERROR]);

    this.logger.info("Reintentando NRC con error", {
      queryId,
      total: candidates.length
    });

    if (candidates.length === 0) {
      const query = await this.queryRepository.findById(queryId);
      if (!query) {
        throw new Error(`No existe la consulta Banner ${queryId}`);
      }

      const counts = await this.resultRepository.countByStatus(queryId);
      return {
        queryId,
        queryName: query.name,
        processed: 0,
        total: 0,
        counts
      };
    }

    return this.batchService.process({
      queryId,
      items: candidates,
      ...(workers !== undefined ? { workers } : {})
    });
  }
}
