import type {
  BannerResultStatus as PrismaBannerResultStatus,
  Prisma,
  PrismaClient
} from "@prisma/client";

import { ResultStatus } from "../../core/types.js";

export interface SaveBannerResultInput {
  queryId: string;
  sessionId?: string;
  nrc: string;
  period?: string;
  teacherName?: string | null;
  teacherId?: string | null;
  programName?: string | null;
  rawPayload?: Record<string, unknown>;
  additionalData?: Record<string, unknown>;
  status: ResultStatus;
  errorMessage?: string | null;
  checkedAt: Date;
  screenshotPath?: string | null;
  htmlPath?: string | null;
}

const emptyCounts: Record<ResultStatus, number> = {
  [ResultStatus.ENCONTRADO]: 0,
  [ResultStatus.SIN_DOCENTE]: 0,
  [ResultStatus.NO_ENCONTRADO]: 0,
  [ResultStatus.ERROR]: 0
};

function normalizePeriod(period?: string): string {
  return (period ?? "").trim();
}

function asJson(value?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}

export class BannerResultRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(input: SaveBannerResultInput) {
    const period = normalizePeriod(input.period);
    const createData: Prisma.BannerResultUncheckedCreateInput = {
      queryId: input.queryId,
      sessionId: input.sessionId ?? null,
      nrc: input.nrc,
      period,
      teacherName: input.teacherName ?? null,
      teacherId: input.teacherId ?? null,
      programName: input.programName ?? null,
      status: input.status as PrismaBannerResultStatus,
      errorMessage: input.errorMessage ?? null,
      checkedAt: input.checkedAt,
      screenshotPath: input.screenshotPath ?? null,
      htmlPath: input.htmlPath ?? null,
      ...(input.rawPayload !== undefined
        ? { rawPayload: input.rawPayload as Prisma.InputJsonValue }
        : {}),
      ...(input.additionalData !== undefined
        ? { additionalData: input.additionalData as Prisma.InputJsonValue }
        : {})
    };
    const updateData: Prisma.BannerResultUncheckedUpdateInput = {
      sessionId: input.sessionId ?? null,
      teacherName: input.teacherName ?? null,
      teacherId: input.teacherId ?? null,
      programName: input.programName ?? null,
      status: input.status as PrismaBannerResultStatus,
      errorMessage: input.errorMessage ?? null,
      checkedAt: input.checkedAt,
      screenshotPath: input.screenshotPath ?? null,
      htmlPath: input.htmlPath ?? null,
      ...(input.rawPayload !== undefined
        ? { rawPayload: input.rawPayload as Prisma.InputJsonValue }
        : {}),
      ...(input.additionalData !== undefined
        ? { additionalData: input.additionalData as Prisma.InputJsonValue }
        : {})
    };

    return this.prisma.bannerResult.upsert({
      where: {
        queryId_nrc_period: {
          queryId: input.queryId,
          nrc: input.nrc,
          period
        }
      },
      create: createData,
      update: updateData
    });
  }

  async findByQueryId(queryId: string) {
    return this.prisma.bannerResult.findMany({
      where: { queryId },
      orderBy: [{ checkedAt: "asc" }, { nrc: "asc" }]
    });
  }

  async findExistingKeys(queryId: string): Promise<Set<string>> {
    const results = await this.prisma.bannerResult.findMany({
      where: { queryId },
      select: {
        nrc: true,
        period: true
      }
    });

    return new Set(results.map((result) => `${result.nrc}::${result.period}`));
  }

  async findRetryCandidates(queryId: string, statuses: ResultStatus[]) {
    const results = await this.prisma.bannerResult.findMany({
      where: {
        queryId,
        status: {
          in: statuses as PrismaBannerResultStatus[]
        }
      },
      orderBy: [{ checkedAt: "asc" }, { nrc: "asc" }]
    });

    return results.map((result) => {
      const item = {
        nrc: result.nrc
      } as { nrc: string; period?: string };

      if (result.period) {
        item.period = result.period;
      }

      return item;
    });
  }

  async countByStatus(queryId: string): Promise<Record<ResultStatus, number>> {
    const grouped = await this.prisma.bannerResult.groupBy({
      by: ["status"],
      where: { queryId },
      _count: {
        _all: true
      }
    });

    return grouped.reduce<Record<ResultStatus, number>>((accumulator, item) => {
      accumulator[item.status as ResultStatus] = item._count._all;
      return accumulator;
    }, { ...emptyCounts });
  }
}
