import { Controller, Get, Inject, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('/review')
export class ReviewController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Cola de revisión ordenada por urgencia de calendario.
   * GET /review/queue?periodCode=202615&moment=MD2&phase=EJECUCION&category=MUESTREO
   */
  @Get('/queue')
  async queue(@Query() query: Record<string, unknown>) {
    const periodCode = String(query.periodCode ?? '').trim();
    const moment = String(query.moment ?? '').trim();
    const phase = String(query.phase ?? 'ALISTAMIENTO').trim().toUpperCase();

    if (!periodCode || !moment) {
      return { ok: false, error: 'Se requieren periodCode y moment.' };
    }

    const period = await this.prisma.period.findUnique({
      where: { code: periodCode },
      select: { id: true, code: true },
    });

    if (!period) {
      return {
        ok: true,
        periodCode,
        phase,
        moment,
        total: 0,
        done: 0,
        pending: 0,
        items: [],
      };
    }

    const groups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: period.id,
        moment,
        selectedCourseId: { not: null },
      },
      include: {
        teacher: { select: { id: true, fullName: true } },
        selectedCourse: {
          include: {
            evaluations: {
              where: { phase },
              select: { id: true, phase: true, score: true },
            },
            moodleCheck: { select: { moodleCourseUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const items = groups
      .filter((g) => g.selectedCourse !== null)
      .map((g) => {
        const course = g.selectedCourse!;
        const hasEval = course.evaluations.length > 0;
        return {
          sampleGroupId: g.id,
          teacherName: g.teacher.fullName,
          periodCode: period.code,
          programCode: g.programCode,
          modality: g.modality,
          moment: g.moment,
          template: g.template,
          done: hasEval,
          selectedCourse: {
            id: course.id,
            nrc: course.nrc,
            subjectName: course.subjectName ?? null,
            bannerStartDate: course.bannerStartDate ?? null,
            bannerEndDate: course.bannerEndDate ?? null,
            enrolledCount: null,
            moodleCourseUrl: course.moodleCheck?.moodleCourseUrl ?? null,
          },
        };
      });

    const done = items.filter((i) => i.done).length;

    return {
      ok: true,
      periodCode: period.code,
      phase,
      moment,
      total: items.length,
      done,
      pending: items.length - done,
      items,
    };
  }
}
