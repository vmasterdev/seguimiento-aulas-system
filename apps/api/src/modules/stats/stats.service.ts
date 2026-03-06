import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class StatsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async overview() {
    const [
      periods,
      teachers,
      coordinators,
      courses,
      sampleGroups,
      evaluations,
      moodleStatusRaw,
      outboxStatusRaw,
      pendingClassify,
    ] = await Promise.all([
      this.prisma.period.count(),
      this.prisma.teacher.count(),
      this.prisma.coordinator.count(),
      this.prisma.course.count(),
      this.prisma.sampleGroup.count(),
      this.prisma.evaluation.count(),
      this.prisma.moodleCheck.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.outboxMessage.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.moodleCheck.count({ where: { status: { in: ['PENDIENTE', 'ERROR_REINTENTABLE'] } } }),
    ]);

    const moodleByStatus = moodleStatusRaw.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all;
      return acc;
    }, {});

    const outboxByStatus = outboxStatusRaw.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all;
      return acc;
    }, {});

    return {
      periods,
      teachers,
      coordinators,
      courses,
      sampleGroups,
      evaluations,
      pendingClassify,
      moodleByStatus,
      outboxByStatus,
      generatedAt: new Date().toISOString(),
    };
  }
}
