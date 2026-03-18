import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { buildDeterministicIndex, normalizeMoment, normalizeTemplate, SamplingGenerateSchema } from '@seguimiento/shared';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';
import { isBannerExcludedFromReview } from '../common/banner-review.util';

function parseChecklist(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function hasSavedEvaluation(value: unknown): boolean {
  return Object.keys(parseChecklist(value)).length > 0;
}

@Injectable()
export class SamplingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async generate(rawPayload: unknown) {
    const payload = parseWithSchema(SamplingGenerateSchema, rawPayload, 'sampling request');
    const seed = payload.seed ?? `${payload.periodCode}:${new Date().toISOString().slice(0, 10)}`;

    const period = await this.prisma.period.findUnique({ where: { code: payload.periodCode } });
    if (!period) {
      throw new NotFoundException(`No existe el periodo ${payload.periodCode}.`);
    }

    const candidates = await this.prisma.course.findMany({
      where: {
        periodId: period.id,
        teacherId: { not: null },
        moodleCheck: { status: { in: ['OK', 'REVISAR_MANUAL'] } },
      },
      include: {
        moodleCheck: true,
        teacher: true,
      },
    });

    const reviewableCandidates = candidates.filter((course) => !isBannerExcludedFromReview(course.rawJson));
    const groups = new Map<string, typeof reviewableCandidates>();

    for (const course of reviewableCandidates) {
      if (!course.teacherId) continue;

      const programCode =
        resolveProgramValue({
          teacherCostCenter: course.teacher?.costCenter ?? null,
          courseProgramCode: course.programCode,
          courseProgramName: course.programName,
        }).programCode ?? 'SIN_PROGRAMA';
      const moment = normalizeMoment(course.moment ?? '1');
      const modality = period.modality;
      const template = normalizeTemplate(course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN');
      const key = [course.teacherId, programCode, moment, modality, template].join('|');

      const current = groups.get(key) ?? [];
      current.push(course);
      groups.set(key, current);
    }

    await this.prisma.sampleGroup.deleteMany({ where: { periodId: period.id } });

    let created = 0;
    const preview: Array<Record<string, string>> = [];

    for (const [key, courses] of groups.entries()) {
      if (!courses.length) continue;
      const [teacherId, programCode, moment, modality, template] = key.split('|');
      const index = buildDeterministicIndex(seed, [key], courses.length);
      const selected = courses[index];

      await this.prisma.sampleGroup.create({
        data: {
          teacherId,
          periodId: period.id,
          programCode,
          moment,
          modality,
          template,
          selectedCourseId: selected.id,
          selectionSeed: seed,
        },
      });

      created += 1;
      if (preview.length < 30) {
        preview.push({
          teacherId,
          programCode,
          moment,
          modality,
          template,
          selectedNrc: selected.nrc,
        });
      }
    }

    return {
      ok: true,
      period: period.code,
      seed,
      candidateCourses: reviewableCandidates.length,
      groups: groups.size,
      created,
      preview,
    };
  }

  async list(periodCode?: string) {
    const groups = await this.prisma.sampleGroup.findMany({
      where: {
        period: periodCode ? { code: periodCode } : undefined,
      },
      include: {
        period: true,
        teacher: true,
        selectedCourse: {
          include: {
            moodleCheck: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    });

    return {
      total: groups.length,
      items: groups,
    };
  }

  async reviewQueue(params: { periodCode: string; phase: 'ALISTAMIENTO' | 'EJECUCION'; moment?: string }) {
    const period = await this.prisma.period.findUnique({
      where: { code: params.periodCode },
      select: { id: true, code: true, executionPolicy: true },
    });
    if (!period) {
      throw new NotFoundException(`No existe el periodo ${params.periodCode}.`);
    }

    const groups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: period.id,
        selectedCourseId: { not: null },
        moment: params.moment ? normalizeMoment(params.moment) : undefined,
      },
      include: {
        teacher: true,
        period: true,
        selectedCourse: {
          include: {
            teacher: true,
            moodleCheck: true,
            evaluations: {
              where: { phase: params.phase },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    const items = groups
      .filter((group) => group.selectedCourse)
      .filter((group) => !isBannerExcludedFromReview(group.selectedCourse?.rawJson))
      .map((group) => {
        const selected = group.selectedCourse!;
        const evaluation = selected.evaluations[0] ?? null;
        const checklist = parseChecklist(evaluation?.checklist);
        const done = !!evaluation && hasSavedEvaluation(evaluation.checklist);
        const resolvedProgram = resolveProgramValue({
          teacherCostCenter: selected.teacher?.costCenter ?? null,
          courseProgramCode: selected.programCode,
          courseProgramName: selected.programName,
        });

        return {
          sampleGroupId: group.id,
          teacherId: group.teacherId,
          teacherName: group.teacher.fullName,
          periodCode: group.period.code,
          programCode: resolvedProgram.programCode ?? group.programCode,
          modality: group.modality,
          moment: group.moment,
          template: group.template,
          selectedCourse: {
            id: selected.id,
            nrc: selected.nrc,
            subjectName: selected.subjectName,
            moodleStatus: selected.moodleCheck?.status ?? null,
            detectedTemplate: selected.moodleCheck?.detectedTemplate ?? null,
            moodleCourseUrl: selected.moodleCheck?.moodleCourseUrl ?? null,
            moodleCourseId: selected.moodleCheck?.moodleCourseId ?? null,
            resolvedModality: selected.moodleCheck?.resolvedModality ?? null,
            resolvedBaseUrl: selected.moodleCheck?.resolvedBaseUrl ?? null,
            searchQuery: selected.moodleCheck?.searchQuery ?? null,
          },
          evaluation: evaluation
            ? {
                id: evaluation.id,
                score: evaluation.score,
                observations: evaluation.observations,
                computedAt: evaluation.computedAt,
                replicatedFromCourseId: evaluation.replicatedFromCourseId,
                checklist,
              }
            : null,
          done,
        };
      });

    const doneCount = items.filter((item) => item.done).length;
    const periodCourses = await this.prisma.course.findMany({
      where: { periodId: period.id },
      select: { rawJson: true },
    });
    const totalNrcInPeriod = periodCourses.filter((course) => !isBannerExcludedFromReview(course.rawJson)).length;

    const progressGroups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: period.id,
        selectedCourseId: { not: null },
      },
      include: {
        selectedCourse: {
          include: {
            evaluations: {
              where: { phase: params.phase },
              take: 1,
            },
          },
        },
      },
    });

    const reviewedNrcInPeriod = progressGroups.reduce((acc, group) => {
      if (isBannerExcludedFromReview(group.selectedCourse?.rawJson)) return acc;
      const evaluation = group.selectedCourse?.evaluations[0];
      const done = !!evaluation && hasSavedEvaluation(evaluation.checklist);
      return done ? acc + 1 : acc;
    }, 0);

    const pendingNrcInPeriod = Math.max(0, totalNrcInPeriod - reviewedNrcInPeriod);
    const reviewedPercent = totalNrcInPeriod === 0 ? 0 : Number(((reviewedNrcInPeriod / totalNrcInPeriod) * 100).toFixed(2));
    const pendingPercent = totalNrcInPeriod === 0 ? 0 : Number(((pendingNrcInPeriod / totalNrcInPeriod) * 100).toFixed(2));

    return {
      ok: true,
      periodCode: period.code,
      phase: params.phase,
      moment: params.moment ? normalizeMoment(params.moment) : null,
      executionPolicy: period.executionPolicy,
      total: items.length,
      done: doneCount,
      pending: items.length - doneCount,
      progress: {
        totalNrcInPeriod,
        reviewedNrcInPeriod,
        pendingNrcInPeriod,
        reviewedPercent,
        pendingPercent,
      },
      items,
    };
  }
}
