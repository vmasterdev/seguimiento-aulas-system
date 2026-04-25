import type { Prisma, PrismaClient } from "@prisma/client";

export class BannerSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: {
    queryId?: string;
    bannerBaseUrl?: string;
    loginUrl?: string;
    metadata?: Record<string, unknown>;
  }) {
    const data: Prisma.BannerSessionUncheckedCreateInput = {
      queryId: params.queryId ?? null,
      bannerBaseUrl: params.bannerBaseUrl ?? null,
      loginUrl: params.loginUrl ?? null,
      ...(params.metadata !== undefined ? { metadata: params.metadata as Prisma.InputJsonValue } : {})
    };

    return this.prisma.bannerSession.create({
      data
    });
  }

  async finish(
    sessionId: string,
    params: {
      success: boolean;
      metadata?: Record<string, unknown>;
    }
  ) {
    const data: Prisma.BannerSessionUpdateInput = {
      success: params.success,
      endedAt: new Date(),
      ...(params.metadata !== undefined ? { metadata: params.metadata as Prisma.InputJsonValue } : {})
    };

    return this.prisma.bannerSession.update({
      where: { id: sessionId },
      data
    });
  }
}
