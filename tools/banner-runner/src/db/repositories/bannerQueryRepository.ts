import type { BannerQueryStatus, Prisma, PrismaClient } from "@prisma/client";

import { QueryStatus } from "../../core/types.js";

export interface CreateQueryParams {
  name: string;
  inputPath?: string;
  requestedPeriod?: string;
  totalRequested: number;
}

export interface QueryCounters {
  processedCount: number;
  successCount: number;
  errorCount: number;
}

export class BannerQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: CreateQueryParams) {
    const data: Prisma.BannerQueryCreateInput = {
      name: params.name,
      inputPath: params.inputPath ?? null,
      requestedPeriod: params.requestedPeriod ?? null,
      totalRequested: params.totalRequested
    };

    return this.prisma.bannerQuery.create({
      data
    });
  }

  async findById(queryId: string) {
    return this.prisma.bannerQuery.findUnique({
      where: { id: queryId }
    });
  }

  async markRunning(queryId: string, totalRequested?: number) {
    const data: Prisma.BannerQueryUpdateInput = {
      status: QueryStatus.RUNNING as BannerQueryStatus,
      startedAt: new Date(),
      ...(totalRequested !== undefined ? { totalRequested } : {})
    };

    return this.prisma.bannerQuery.update({
      where: { id: queryId },
      data
    });
  }

  async finish(queryId: string, status: QueryStatus, counters: QueryCounters) {
    return this.prisma.bannerQuery.update({
      where: { id: queryId },
      data: {
        status: status as BannerQueryStatus,
        processedCount: counters.processedCount,
        successCount: counters.successCount,
        errorCount: counters.errorCount,
        finishedAt: new Date()
      }
    });
  }
}
