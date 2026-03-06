import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildDeterministicIndex, normalizeMoment, normalizeTemplate, SamplingGenerateSchema } from '@seguimiento/shared';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';
import { isCourseExcludedFromReview, readEnrolledCount } from '../common/review-eligibility.util';
import { getTemplateReplicationFamily } from '../common/template-family.util';

function parseChecklist(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readSpecialChecklistQueue(rawJson: unknown): { active: boolean; reason: string | null } {
  const root = asRecord(rawJson);
  const marker = asRecord(root.specialChecklistQueue);
  return {
    active: marker.active === true,
    reason: typeof marker.reason === 'string' && marker.reason.trim() ? marker.reason.trim() : null,
  };
}

function hasSavedEvaluation(value: unknown): boolean {
  return Object.keys(parseChecklist(value)).length > 0;
}

function countSavedEvaluations(course: { evaluations: Array<{ checklist: unknown }> }): number {
  return course.evaluations.filter((evaluation) => hasSavedEvaluation(evaluation.checklist)).length;
}

function latestSavedEvaluationTime(course: { evaluations: Array<{ checklist: unknown; computedAt: Date }> }): number {
  const timestamps = course.evaluations
    .filter((evaluation) => hasSavedEvaluation(evaluation.checklist))
    .map((evaluation) => new Date(evaluation.computedAt).getTime());
  return timestamps.length ? Math.max(...timestamps) : 0;
}

@Injectable()
export class SamplingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private pickRepresentativeCourse<T extends { nrc: string; evaluations: Array<{ checklist: unknown; computedAt: Date }> }>(
    courses: T[],
    key: string,
    seed: string,
  ): T {
    const reusableCourses = courses
      .filter((course) => countSavedEvaluations(course) > 0)
      .sort((left, right) => {
        const savedDiff = countSavedEvaluations(right) - countSavedEvaluations(left);
        if (savedDiff !== 0) return savedDiff;

        const latestDiff = latestSavedEvaluationTime(right) - latestSavedEvaluationTime(left);
        if (latestDiff !== 0) return latestDiff;

        return left.nrc.localeCompare(right.nrc);
      });

    if (reusableCourses.length) return reusableCourses[0];

    const index = buildDeterministicIndex(seed, [key], courses.length);
    return courses[index];
  }

  private async reconcileGroupEvaluations<T extends { id: string; evaluations: Array<{
    phase: string;
    checklist: unknown;
    score: number;
    observations: string | null;
    computedAt: Date;
    replicatedFromCourseId: string | null;
  }> }>(selected: T, courses: T[]) {
    let reusedEvaluations = 0;
    let groupsReused = 0;

    for (const phase of ['ALISTAMIENTO', 'EJECUCION'] as const) {
      const selectedExisting = selected.evaluations.find(
        (evaluation) => evaluation.phase === phase && hasSavedEvaluation(evaluation.checklist),
      );
      if (selectedExisting) continue;

      const source = courses
        .flatMap((course) =>
          course.evaluations
            .filter((evaluation) => evaluation.phase === phase && hasSavedEvaluation(evaluation.checklist))
            .map((evaluation) => ({ courseId: course.id, evaluation })),
        )
        .sort((left, right) => {
          const manualLeft = left.evaluation.replicatedFromCourseId ? 0 : 1;
          const manualRight = right.evaluation.replicatedFromCourseId ? 0 : 1;
          if (manualRight !== manualLeft) return manualRight - manualLeft;

          return new Date(right.evaluation.computedAt).getTime() - new Date(left.evaluation.computedAt).getTime();
        })[0];

      if (!source) continue;

      const replicatedFromCourseId =
        source.evaluation.replicatedFromCourseId && source.evaluation.replicatedFromCourseId !== selected.id
          ? source.evaluation.replicatedFromCourseId
          : source.courseId === selected.id
            ? null
            : source.courseId;

      await this.prisma.evaluation.upsert({
        where: {
          courseId_phase: {
            courseId: selected.id,
            phase,
          },
        },
        create: {
          courseId: selected.id,
          phase,
          checklist: parseChecklist(source.evaluation.checklist) as Prisma.InputJsonObject,
          score: source.evaluation.score,
          observations: source.evaluation.observations ?? '',
          computedAt: source.evaluation.computedAt,
          replicatedFromCourseId,
        },
        update: {
          checklist: parseChecklist(source.evaluation.checklist) as Prisma.InputJsonObject,
          score: source.evaluation.score,
          observations: source.evaluation.observations ?? '',
          computedAt: source.evaluation.computedAt,
          replicatedFromCourseId,
        },
      });

      reusedEvaluations += 1;
      groupsReused = 1;
    }

    return {
      reusedEvaluations,
      groupsReused,
    };
  }

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
        evaluations: true,
      },
    });

    const reviewableCandidates = candidates.filter(
      (course) =>
        !isCourseExcludedFromReview({
          rawJson: course.rawJson,
          template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
          moodleCheck: course.moodleCheck,
        }),
    );
    const groups = new Map<string, typeof reviewableCandidates>();

    for (const course of reviewableCandidates) {
      if (!course.teacherId) continue;

      const programCode =
        resolveProgramValue({
          teacherCostCenter: course.teacher?.costCenter ?? null,
          teacherLinked: !!course.teacherId,
          courseProgramCode: course.programCode,
          courseProgramName: course.programName,
        }).programCode ?? 'SIN_PROGRAMA';
      const moment = normalizeMoment(course.moment ?? '1');
      const template = normalizeTemplate(course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN');
      const templateFamily = getTemplateReplicationFamily(template);
      const key = [course.teacherId, programCode, moment, templateFamily].join('|');

      const current = groups.get(key) ?? [];
      current.push(course);
      groups.set(key, current);
    }

    await this.prisma.sampleGroup.deleteMany({ where: { periodId: period.id } });

    let created = 0;
    let reusedGroups = 0;
    let reusedEvaluations = 0;
    const preview: Array<Record<string, string>> = [];

    for (const [key, courses] of groups.entries()) {
      if (!courses.length) continue;
      const [teacherId, programCode, moment] = key.split('|');
      const selected = this.pickRepresentativeCourse(courses, key, seed);
      const selectedTemplate = normalizeTemplate(
        selected.moodleCheck?.detectedTemplate ?? selected.templateDeclared ?? 'UNKNOWN',
      );

      await this.prisma.sampleGroup.create({
        data: {
          teacherId,
          periodId: period.id,
          programCode,
          moment,
          modality: period.modality,
          template: selectedTemplate,
          selectedCourseId: selected.id,
          selectionSeed: seed,
        },
      });

      const reconciliation = await this.reconcileGroupEvaluations(selected, courses);
      created += 1;
      reusedGroups += reconciliation.groupsReused;
      reusedEvaluations += reconciliation.reusedEvaluations;
      if (preview.length < 30) {
        preview.push({
          teacherId,
          programCode,
          moment,
          modality: period.modality,
          template: selectedTemplate,
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
      reusedGroups,
      reusedEvaluations,
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

  async reviewQueue(params: {
    periodCode: string;
    phase: 'ALISTAMIENTO' | 'EJECUCION';
    moment?: string;
    category?: 'MUESTREO' | 'TEMPORAL';
  }) {
    const period = await this.prisma.period.findUnique({
      where: { code: params.periodCode },
      select: { id: true, code: true, executionPolicy: true },
    });
    if (!period) {
      throw new NotFoundException(`No existe el periodo ${params.periodCode}.`);
    }

    const category = params.category === 'TEMPORAL' ? 'TEMPORAL' : 'MUESTREO';
    const normalizedMoment = params.moment ? normalizeMoment(params.moment) : undefined;

    if (category === 'TEMPORAL') {
      const courses = await this.prisma.course.findMany({
        where: {
          periodId: period.id,
          teacherId: { not: null },
          moment: normalizedMoment,
        },
        include: {
          period: true,
          teacher: true,
          moodleCheck: true,
          evaluations: {
            where: { phase: params.phase },
            take: 1,
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { nrc: 'asc' }],
      });

      const items = courses
        .filter((course) => readSpecialChecklistQueue(course.rawJson).active)
        .map((course) => {
          const evaluation = course.evaluations[0] ?? null;
          const checklist = parseChecklist(evaluation?.checklist);
          const done = !!evaluation && hasSavedEvaluation(evaluation.checklist);
          const resolvedProgram = resolveProgramValue({
            teacherCostCenter: course.teacher?.costCenter ?? null,
            teacherLinked: !!course.teacherId,
            courseProgramCode: course.programCode,
            courseProgramName: course.programName,
          });
          const specialQueue = readSpecialChecklistQueue(course.rawJson);

          return {
            sampleGroupId: `TEMP:${course.id}`,
            teacherId: course.teacher?.id ?? course.teacherId ?? 'DOCENTE_NO_IDENTIFICADO',
            teacherName: course.teacher?.fullName ?? 'Docente no identificado',
            periodCode: course.period.code,
            programCode: resolvedProgram.programCode ?? course.programCode ?? 'SIN_PROGRAMA',
            modality: course.period.modality,
            moment: course.moment ?? normalizedMoment ?? '1',
            template: normalizeTemplate(course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN'),
            selectedCourse: {
              id: course.id,
              nrc: course.nrc,
              subjectName: course.subjectName,
              enrolledCount: readEnrolledCount(course.rawJson),
              moodleStatus: course.moodleCheck?.status ?? null,
              detectedTemplate: course.moodleCheck?.detectedTemplate ?? null,
              moodleCourseUrl: course.moodleCheck?.moodleCourseUrl ?? null,
              moodleCourseId: course.moodleCheck?.moodleCourseId ?? null,
              resolvedModality: course.moodleCheck?.resolvedModality ?? null,
              resolvedBaseUrl: course.moodleCheck?.resolvedBaseUrl ?? null,
              searchQuery: course.moodleCheck?.searchQuery ?? null,
            },
            evaluation: evaluation
              ? {
                  id: evaluation.id,
                  score: evaluation.score,
                  observations:
                    evaluation.observations ??
                    specialQueue.reason ??
                    'Caso especial temporal para recalificacion.',
                  computedAt: evaluation.computedAt,
                  replicatedFromCourseId: evaluation.replicatedFromCourseId,
                  checklist,
                }
              : null,
            done,
          };
        });

      const doneCount = items.filter((item) => item.done).length;
      const total = items.length;
      const pending = Math.max(0, total - doneCount);
      const reviewedPercent = total === 0 ? 0 : Number(((doneCount / total) * 100).toFixed(2));
      const pendingPercent = total === 0 ? 0 : Number(((pending / total) * 100).toFixed(2));

      return {
        ok: true,
        periodCode: period.code,
        phase: params.phase,
        moment: normalizedMoment ?? null,
        category,
        executionPolicy: period.executionPolicy,
        total,
        done: doneCount,
        pending,
        progress: {
          totalNrcInPeriod: total,
          reviewedNrcInPeriod: doneCount,
          pendingNrcInPeriod: pending,
          reviewedPercent,
          pendingPercent,
        },
        items,
      };
    }

    const groups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: period.id,
        selectedCourseId: { not: null },
        moment: normalizedMoment,
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
      .filter(
        (group) =>
          !isCourseExcludedFromReview({
            rawJson: group.selectedCourse?.rawJson,
            template:
              group.selectedCourse?.moodleCheck?.detectedTemplate ??
              group.selectedCourse?.templateDeclared ??
              group.template,
            moodleCheck: group.selectedCourse?.moodleCheck,
          }),
      )
      .map((group) => {
        const selected = group.selectedCourse!;
        const evaluation = selected.evaluations[0] ?? null;
        const checklist = parseChecklist(evaluation?.checklist);
        const done = !!evaluation && hasSavedEvaluation(evaluation.checklist);
        const resolvedTeacherId = selected.teacher?.id ?? group.teacherId;
        const resolvedTeacherName = selected.teacher?.fullName ?? group.teacher?.fullName ?? 'Docente no identificado';
        const resolvedProgram = resolveProgramValue({
          teacherCostCenter: selected.teacher?.costCenter ?? null,
          teacherLinked: !!selected.teacherId,
          courseProgramCode: selected.programCode,
          courseProgramName: selected.programName,
        });

        return {
          sampleGroupId: group.id,
          teacherId: resolvedTeacherId,
          teacherName: resolvedTeacherName,
          periodCode: group.period.code,
          programCode: resolvedProgram.programCode ?? (!selected.teacherId ? group.programCode : null),
          modality: group.modality,
          moment: group.moment,
          template: group.template,
          selectedCourse: {
            id: selected.id,
            nrc: selected.nrc,
            subjectName: selected.subjectName,
            enrolledCount: readEnrolledCount(selected.rawJson),
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
      select: {
        rawJson: true,
        templateDeclared: true,
        moodleCheck: {
          select: {
            detectedTemplate: true,
          },
        },
      },
    });
    const totalNrcInPeriod = periodCourses.filter(
      (course) =>
        !isCourseExcludedFromReview({
          rawJson: course.rawJson,
          template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
          moodleCheck: course.moodleCheck,
        }),
    ).length;

    const progressGroups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: period.id,
        selectedCourseId: { not: null },
      },
      include: {
        selectedCourse: {
          include: {
            moodleCheck: true,
            evaluations: {
              where: { phase: params.phase },
              take: 1,
            },
          },
        },
      },
    });

    const reviewedNrcInPeriod = progressGroups.reduce((acc, group) => {
      if (
        isCourseExcludedFromReview({
          rawJson: group.selectedCourse?.rawJson,
          template: group.selectedCourse?.moodleCheck?.detectedTemplate ?? group.selectedCourse?.templateDeclared ?? 'UNKNOWN',
          moodleCheck: group.selectedCourse?.moodleCheck,
        })
      ) {
        return acc;
      }
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
      moment: normalizedMoment ?? null,
      category,
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
