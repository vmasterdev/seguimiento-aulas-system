import { Inject, Injectable, InternalServerErrorException, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { getRedisConnection } from '../common/redis.util';
import { MOODLE_CLASSIFY_QUEUE, type MoodleClassifyJob } from './queue.constants';

type EnqueueInput = {
  periodCode?: string;
  limit?: number;
  statuses?: string[];
};

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queue: Queue<MoodleClassifyJob>;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.queue = new Queue<MoodleClassifyJob>(MOODLE_CLASSIFY_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 1000,
        removeOnFail: 3000,
      },
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async enqueueClassify(input: EnqueueInput) {
    const statuses = input.statuses?.length ? input.statuses : ['PENDIENTE'];
    const limit = input.limit ?? 500;

    const courses = await this.prisma.course.findMany({
      where: {
        period: input.periodCode ? { code: input.periodCode } : undefined,
        moodleCheck: { status: { in: statuses } },
      },
      select: {
        id: true,
        nrc: true,
        periodId: true,
      },
      take: limit,
      orderBy: { updatedAt: 'asc' },
    });

    if (!courses.length) {
      return {
        queued: 0,
        scanned: 0,
        statuses,
      };
    }

    const jobs = courses.map((course) => ({
      name: 'classify-by-nrc',
      data: {
        courseId: course.id,
        nrc: course.nrc,
        periodId: course.periodId,
      },
      opts: {
        jobId: `moodle-classify:${course.id}`,
      },
    }));

    try {
      await this.queue.addBulk(jobs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sampleJob = jobs[0]?.data?.courseId ?? 'N/A';
      throw new InternalServerErrorException(
        `No fue posible encolar trabajos (${jobs.length}). Curso ejemplo: ${sampleJob}. Error: ${message}`,
      );
    }

    await this.prisma.moodleCheck.updateMany({
      where: { courseId: { in: courses.map((course) => course.id) }, status: { in: statuses } },
      data: { status: 'PENDIENTE' },
    });

    return {
      queued: jobs.length,
      scanned: courses.length,
      statuses,
      queue: MOODLE_CLASSIFY_QUEUE,
    };
  }

  async retryErrors(input: Omit<EnqueueInput, 'statuses'>) {
    return this.enqueueClassify({ ...input, statuses: ['ERROR_REINTENTABLE', 'REVISAR_MANUAL'] });
  }

  async queueStats() {
    const [queueCounts, dbCountsRaw] = await Promise.all([
      this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      this.prisma.moodleCheck.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const dbCounts = dbCountsRaw.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = item._count._all;
      return acc;
    }, {});

    return {
      queue: queueCounts,
      moodleChecks: dbCounts,
    };
  }
}
