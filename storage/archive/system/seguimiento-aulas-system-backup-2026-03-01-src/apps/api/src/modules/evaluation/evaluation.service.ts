import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  EvaluationReplicateSchema,
  EvaluationRecalculateSchema,
  EvaluationScoreSchema,
  normalizeTemplate,
  scoreAlistamiento,
  scoreEjecucion,
} from '@seguimiento/shared';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';
import { isBannerExcludedFromReview } from '../common/banner-review.util';

type ChecklistPrimitive = string | number | boolean | null;
type Checklist = Record<string, ChecklistPrimitive>;

const EvaluationNrcTraceQuerySchema = z.object({
  q: z.string().trim().min(1),
  periodCode: z.string().trim().optional(),
  phase: z.enum(['ALISTAMIENTO', 'EJECUCION']).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(120),
});

function toBool(value: ChecklistPrimitive | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'si', 'sí', 'true', 'ok', 'x', 'cumple'].includes(normalized);
  }
  return false;
}

function findMissingChecklistItems(input: {
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  template: string;
  checklist: Checklist;
  executionPolicy: 'APPLIES' | 'AUTO_PASS';
}): string[] {
  const isChecked = (key: string) => toBool(input.checklist[key]);
  const missing: string[] = [];

  if (input.phase === 'ALISTAMIENTO') {
    if (input.template === 'VACIO') return missing;

    if (input.template === 'INNOVAME' || input.template === 'D4') {
      if (!isChecked('plantilla')) missing.push('Cargue de plantilla');
      if (!(isChecked('asistencia') || isChecked('asis'))) missing.push('Asistencia');
      if (!(isChecked('presentacion') || (isChecked('fp') && isChecked('fn')))) missing.push('Presentacion');
      if (!(isChecked('actualizacion_actividades') || isChecked('aa'))) missing.push('Actualizacion actividades');
      return missing;
    }

    if (input.template === 'CRIBA') {
      // Se excluyen intencionalmente los items criba_* para no saturar observaciones.
      if (!isChecked('plantilla')) missing.push('Cargue de plantilla');
      if (!isChecked('fp')) missing.push('Foro presentacion');
      if (!isChecked('fn')) missing.push('Foro novedades');
      if (!(isChecked('asistencia') || isChecked('asis'))) missing.push('Asistencia');
      return missing;
    }

    return missing;
  }

  if (input.executionPolicy === 'AUTO_PASS') return missing;

  if (!isChecked('acuerdo')) missing.push('Acuerdo pedagogico');
  if (!isChecked('grabaciones')) missing.push('Grabaciones');
  if (!isChecked('ingresos')) missing.push('Ingresos (3 por semana)');
  if (!isChecked('calificacion')) missing.push('Calificaciones');
  if (!isChecked('asistencia')) missing.push('Asistencia');
  if (!isChecked('foro_fp')) missing.push('Foro presentacion');
  if (!isChecked('foro_fd')) missing.push('Foro dialogo');
  if (!isChecked('foro_fn')) missing.push('Foro novedades');
  if (!isChecked('foro_ft')) missing.push('Foro tematico');

  return missing;
}

function buildObservations(input: {
  phase: 'ALISTAMIENTO' | 'EJECUCION';
  template: string;
  checklist: Checklist;
  executionPolicy: 'APPLIES' | 'AUTO_PASS';
}): string {
  const missing = findMissingChecklistItems(input);
  if (!missing.length) return '';
  return `Pendiente: ${missing.join(', ')}`;
}

function toChecklist(value: unknown): Checklist {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: Checklist = {};

  for (const [key, raw] of Object.entries(input)) {
    if (raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      output[key] = raw;
      continue;
    }
    if (Array.isArray(raw)) {
      output[key] = raw.length;
      continue;
    }
    if (typeof raw === 'object') {
      output[key] = JSON.stringify(raw);
      continue;
    }
    output[key] = null;
  }

  return output;
}

@Injectable()
export class EvaluationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async replicateFromSelectedCourse(input: {
    selectedCourseId: string;
    periodId: string;
    teacherId: string | null;
    phase: 'ALISTAMIENTO' | 'EJECUCION';
    checklist: Prisma.InputJsonObject;
    score: number;
    observations: string;
  }) {
    if (!input.teacherId) {
      return {
        groupsMatched: 0,
        replicatedCourses: 0,
      };
    }

    const sourceCourse = await this.prisma.course.findUnique({
      where: { id: input.selectedCourseId },
      include: {
        teacher: true,
      },
    });
    const sourceProgramCode =
      resolveProgramValue({
        teacherCostCenter: sourceCourse?.teacher?.costCenter ?? null,
        courseProgramCode: sourceCourse?.programCode ?? null,
        courseProgramName: sourceCourse?.programName ?? null,
      }).programCode ?? null;

    const sampleGroups = await this.prisma.sampleGroup.findMany({
      where: {
        selectedCourseId: input.selectedCourseId,
        periodId: input.periodId,
      },
      select: {
        teacherId: true,
        periodId: true,
        programCode: true,
        moment: true,
        template: true,
      },
    });

    if (!sampleGroups.length) {
      return {
        groupsMatched: 0,
        replicatedCourses: 0,
      };
    }

    const replicatedCourseIds = new Set<string>();

    // Primero actualiza todas las evaluaciones que ya estaban enlazadas a este NRC origen.
    // Esto evita que queden "REPLICADA" con score/observaciones viejas si cambian reglas o datos del grupo.
    const alreadyLinked = await this.prisma.evaluation.findMany({
      where: {
        phase: input.phase,
        replicatedFromCourseId: input.selectedCourseId,
      },
      select: {
        courseId: true,
      },
    });

    for (const linked of alreadyLinked) {
      if (linked.courseId === input.selectedCourseId) continue;

      await this.prisma.evaluation.upsert({
        where: {
          courseId_phase: {
            courseId: linked.courseId,
            phase: input.phase,
          },
        },
        create: {
          courseId: linked.courseId,
          phase: input.phase,
          checklist: input.checklist,
          score: input.score,
          observations: input.observations,
          replicatedFromCourseId: input.selectedCourseId,
        },
        update: {
          checklist: input.checklist,
          score: input.score,
          observations: input.observations,
          replicatedFromCourseId: input.selectedCourseId,
          computedAt: new Date(),
        },
      });

      replicatedCourseIds.add(linked.courseId);
    }

    for (const group of sampleGroups) {
      const candidates = await this.prisma.course.findMany({
        where: {
          teacherId: group.teacherId,
          periodId: group.periodId,
          moment: group.moment,
        },
        include: {
          teacher: true,
          moodleCheck: true,
        },
      });

      for (const candidate of candidates) {
        if (isBannerExcludedFromReview(candidate.rawJson)) continue;
        const candidateProgramCode =
          resolveProgramValue({
            teacherCostCenter: candidate.teacher?.costCenter ?? null,
            courseProgramCode: candidate.programCode,
            courseProgramName: candidate.programName,
          }).programCode ?? null;
        const targetProgramCode = sourceProgramCode ?? group.programCode;
        if ((candidateProgramCode ?? 'SIN_PROGRAMA') !== (targetProgramCode ?? 'SIN_PROGRAMA')) continue;

        const candidateTemplate = normalizeTemplate(
          candidate.moodleCheck?.detectedTemplate ?? candidate.templateDeclared ?? 'UNKNOWN',
        );
        if (candidateTemplate !== group.template) continue;
        if (candidate.id === input.selectedCourseId) continue;

        await this.prisma.evaluation.upsert({
          where: {
            courseId_phase: {
              courseId: candidate.id,
              phase: input.phase,
            },
          },
          create: {
            courseId: candidate.id,
            phase: input.phase,
            checklist: input.checklist,
            score: input.score,
            observations: input.observations,
            replicatedFromCourseId: input.selectedCourseId,
          },
          update: {
            checklist: input.checklist,
            score: input.score,
            observations: input.observations,
            replicatedFromCourseId: input.selectedCourseId,
            computedAt: new Date(),
          },
        });

        replicatedCourseIds.add(candidate.id);
      }
    }

    return {
      groupsMatched: sampleGroups.length,
      replicatedCourses: replicatedCourseIds.size,
    };
  }

  async score(rawPayload: unknown) {
    const payload = parseWithSchema(EvaluationScoreSchema, rawPayload, 'evaluation score request');

    const course = await this.prisma.course.findUnique({
      where: { id: payload.courseId },
      include: {
        period: true,
        moodleCheck: true,
      },
    });

    if (!course) {
      throw new NotFoundException('Curso no encontrado.');
    }

    const template = normalizeTemplate(course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN');
    const checklist = toChecklist(payload.checklist);
    const checklistJson = checklist as Prisma.InputJsonObject;

    const result =
      payload.phase === 'ALISTAMIENTO'
        ? scoreAlistamiento(template, checklist)
        : scoreEjecucion(checklist, {
            executionPolicy: course.period.executionPolicy === 'AUTO_PASS' ? 'AUTO_PASS' : 'APPLIES',
          });
    const executionPolicy = course.period.executionPolicy === 'AUTO_PASS' ? 'AUTO_PASS' : 'APPLIES';
    const observations = buildObservations({
      phase: payload.phase,
      template,
      checklist,
      executionPolicy,
    });

    const evaluation = await this.prisma.evaluation.upsert({
      where: {
        courseId_phase: {
          courseId: course.id,
          phase: payload.phase,
        },
      },
      create: {
        courseId: course.id,
        phase: payload.phase,
        checklist: checklistJson,
        score: result.score,
        observations,
      },
      update: {
        checklist: checklistJson,
        score: result.score,
        observations,
        computedAt: new Date(),
      },
    });
    const replication =
      payload.replicateToGroup
        ? await this.replicateFromSelectedCourse({
            selectedCourseId: course.id,
            periodId: course.periodId,
            teacherId: course.teacherId,
            phase: payload.phase,
            checklist: checklistJson,
            score: result.score,
            observations,
          })
        : { groupsMatched: 0, replicatedCourses: 0 };

    return {
      ok: true,
      evaluation,
      details: result,
      replication,
    };
  }

  async recalculate(rawPayload: unknown) {
    const payload = parseWithSchema(EvaluationRecalculateSchema, rawPayload, 'evaluation recalculate request');
    const phases: Array<'ALISTAMIENTO' | 'EJECUCION'> = payload.phase
      ? [payload.phase]
      : ['ALISTAMIENTO', 'EJECUCION'];

    const courses = await this.prisma.course.findMany({
      where: {
        period: payload.periodCode ? { code: payload.periodCode } : undefined,
      },
      include: {
        period: true,
        moodleCheck: true,
        evaluations: true,
      },
    });

    let processed = 0;

    for (const course of courses) {
      const template = normalizeTemplate(course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN');

      for (const phase of phases) {
        const existing = course.evaluations.find((item) => item.phase === phase);
        const checklist = toChecklist(existing?.checklist);
        const checklistJson = checklist as Prisma.InputJsonObject;

        const result =
          phase === 'ALISTAMIENTO'
            ? scoreAlistamiento(template, checklist)
            : scoreEjecucion(checklist, {
                executionPolicy: course.period.executionPolicy === 'AUTO_PASS' ? 'AUTO_PASS' : 'APPLIES',
              });
        const executionPolicy = course.period.executionPolicy === 'AUTO_PASS' ? 'AUTO_PASS' : 'APPLIES';
        const observations = buildObservations({
          phase,
          template,
          checklist,
          executionPolicy,
        });

        await this.prisma.evaluation.upsert({
          where: {
            courseId_phase: {
              courseId: course.id,
              phase,
            },
          },
          create: {
            courseId: course.id,
            phase,
            checklist: checklistJson,
            score: result.score,
            observations,
          },
          update: {
            checklist: checklistJson,
            score: result.score,
            observations,
            computedAt: new Date(),
          },
        });

        processed += 1;
      }
    }

    return {
      ok: true,
      courses: courses.length,
      evaluationsProcessed: processed,
      phases,
    };
  }

  async replicateSampled(rawPayload: unknown) {
    const payload = parseWithSchema(
      EvaluationReplicateSchema,
      rawPayload,
      'evaluation replicate sampled request',
    );

    const period = await this.prisma.period.findUnique({
      where: { code: payload.periodCode },
      select: { id: true, code: true },
    });
    if (!period) {
      throw new NotFoundException(`No existe el periodo ${payload.periodCode}.`);
    }

    const groups = await this.prisma.sampleGroup.findMany({
      where: {
        periodId: period.id,
        moment: payload.moment,
        selectedCourseId: { not: null },
      },
      include: {
        selectedCourse: {
          include: {
            evaluations: true,
          },
        },
      },
    });

    let groupsWithEvaluation = 0;
    let skippedGroups = 0;
    let replicatedCourses = 0;

    for (const group of groups) {
      const selectedCourse = group.selectedCourse;
      if (!selectedCourse) {
        skippedGroups += 1;
        continue;
      }
      if (isBannerExcludedFromReview(selectedCourse.rawJson)) {
        skippedGroups += 1;
        continue;
      }

      const evaluation = selectedCourse.evaluations.find((item) => item.phase === payload.phase);
      if (!evaluation) {
        skippedGroups += 1;
        continue;
      }

      groupsWithEvaluation += 1;

      const checklist = toChecklist(evaluation.checklist) as Prisma.InputJsonObject;
      const replication = await this.replicateFromSelectedCourse({
        selectedCourseId: selectedCourse.id,
        periodId: selectedCourse.periodId,
        teacherId: selectedCourse.teacherId,
        phase: payload.phase,
        checklist,
        score: evaluation.score,
        observations: evaluation.observations ?? '',
      });
      replicatedCourses += replication.replicatedCourses;
    }

    return {
      ok: true,
      periodCode: period.code,
      phase: payload.phase,
      moment: payload.moment ?? 'ALL',
      groupsTotal: groups.length,
      groupsWithEvaluation,
      groupsSkipped: skippedGroups,
      replicatedCourses,
    };
  }

  async nrcTrace(rawQuery: unknown) {
    const query = parseWithSchema(EvaluationNrcTraceQuerySchema, rawQuery, 'evaluation nrc trace query');

    const courses = await this.prisma.course.findMany({
      where: {
        period: query.periodCode ? { code: query.periodCode } : undefined,
        OR: [
          { nrc: { contains: query.q, mode: 'insensitive' } },
          { programCode: { contains: query.q, mode: 'insensitive' } },
          { programName: { contains: query.q, mode: 'insensitive' } },
          { teacher: { costCenter: { contains: query.q, mode: 'insensitive' } } },
          { teacher: { fullName: { contains: query.q, mode: 'insensitive' } } },
          { teacher: { id: { contains: query.q, mode: 'insensitive' } } },
          { teacher: { sourceId: { contains: query.q, mode: 'insensitive' } } },
          { teacher: { documentId: { contains: query.q, mode: 'insensitive' } } },
          { teacherId: { contains: query.q, mode: 'insensitive' } },
        ],
      },
      include: {
        period: true,
        teacher: true,
        moodleCheck: true,
        evaluations: {
          where: {
            phase: query.phase ?? undefined,
          },
          orderBy: [{ computedAt: 'desc' }],
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: query.limit,
    });

    if (!courses.length) {
      return {
        ok: true,
        query,
        totalCourses: 0,
        totalEvaluations: 0,
        manualEvaluations: 0,
        replicatedEvaluations: 0,
        items: [],
      };
    }

    const courseIds = courses.map((course) => course.id);
    const sourceIds = Array.from(
      new Set(
        courses
          .flatMap((course) => course.evaluations.map((evaluation) => evaluation.replicatedFromCourseId))
          .filter((value): value is string => !!value),
      ),
    );

    const [sourceCourses, replicatedTargets] = await Promise.all([
      sourceIds.length
        ? this.prisma.course.findMany({
            where: { id: { in: sourceIds } },
            select: {
              id: true,
              nrc: true,
            },
          })
        : Promise.resolve([]),
      courseIds.length
        ? this.prisma.evaluation.findMany({
            where: {
              replicatedFromCourseId: { in: courseIds },
              phase: query.phase ?? undefined,
              course: query.periodCode
                ? {
                    period: { code: query.periodCode },
                  }
                : undefined,
            },
            select: {
              replicatedFromCourseId: true,
              phase: true,
              course: {
                select: {
                  nrc: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const sourceById = new Map(sourceCourses.map((course) => [course.id, course.nrc]));
    const replicatedCountBySourcePhase = new Map<string, number>();
    const replicatedTargetsBySourcePhase = new Map<string, string[]>();

    for (const item of replicatedTargets) {
      if (!item.replicatedFromCourseId) continue;
      const key = `${item.replicatedFromCourseId}:${item.phase}`;
      const currentCount = replicatedCountBySourcePhase.get(key) ?? 0;
      replicatedCountBySourcePhase.set(key, currentCount + 1);

      const currentTargets = replicatedTargetsBySourcePhase.get(key) ?? [];
      if (currentTargets.length < 8) {
        currentTargets.push(item.course.nrc);
        replicatedTargetsBySourcePhase.set(key, currentTargets);
      }
    }

    type TraceItem = {
      courseId: string;
      nrc: string;
      periodCode: string;
      teacherName: string | null;
      programCode: string | null;
      moment: string | null;
      template: string;
      phase: string | null;
      score: number | null;
      observations: string | null;
      computedAt: Date | null;
      evaluationType: 'MANUAL' | 'REPLICADA' | 'SIN_EVALUACION';
      replicatedFromCourseId: string | null;
      replicatedFromNrc: string | null;
      replicatedToCount: number;
      replicatedToNrcs: string[];
    };

    const items: TraceItem[] = [];

    for (const course of courses) {
      const resolvedProgram = resolveProgramValue({
        teacherCostCenter: course.teacher?.costCenter ?? null,
        courseProgramCode: course.programCode,
        courseProgramName: course.programName,
      });

      if (!course.evaluations.length) {
        items.push({
          courseId: course.id,
          nrc: course.nrc,
          periodCode: course.period.code,
          teacherName: course.teacher?.fullName ?? null,
          programCode: resolvedProgram.programCode ?? null,
          moment: course.moment ?? null,
          template: normalizeTemplate(course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN'),
          phase: null,
          score: null,
          observations: null,
          computedAt: null,
          evaluationType: 'SIN_EVALUACION',
          replicatedFromCourseId: null,
          replicatedFromNrc: null,
          replicatedToCount: 0,
          replicatedToNrcs: [],
        });
        continue;
      }

      for (const evaluation of course.evaluations) {
        const replicatedFromNrc = evaluation.replicatedFromCourseId
          ? sourceById.get(evaluation.replicatedFromCourseId) ?? null
          : null;
        const replicatedKey = `${course.id}:${evaluation.phase}`;
        const replicatedToCount = replicatedCountBySourcePhase.get(replicatedKey) ?? 0;
        const replicatedToNrcs = replicatedTargetsBySourcePhase.get(replicatedKey) ?? [];

        items.push({
          courseId: course.id,
          nrc: course.nrc,
          periodCode: course.period.code,
          teacherName: course.teacher?.fullName ?? null,
          programCode: resolvedProgram.programCode ?? null,
          moment: course.moment ?? null,
          template: normalizeTemplate(course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN'),
          phase: evaluation.phase,
          score: evaluation.score,
          observations: evaluation.observations,
          computedAt: evaluation.computedAt,
          evaluationType: evaluation.replicatedFromCourseId ? 'REPLICADA' : 'MANUAL',
          replicatedFromCourseId: evaluation.replicatedFromCourseId,
          replicatedFromNrc,
          replicatedToCount,
          replicatedToNrcs,
        });
      }
    }

    const manualEvaluations = items.filter((item) => item.evaluationType === 'MANUAL').length;
    const replicatedEvaluations = items.filter((item) => item.evaluationType === 'REPLICADA').length;

    return {
      ok: true,
      query,
      totalCourses: courses.length,
      totalEvaluations: items.filter((item) => item.evaluationType !== 'SIN_EVALUACION').length,
      manualEvaluations,
      replicatedEvaluations,
      items,
    };
  }

  async list(periodCode?: string, phase?: string) {
    const items = await this.prisma.evaluation.findMany({
      where: {
        phase: phase || undefined,
        course: {
          period: periodCode ? { code: periodCode } : undefined,
        },
      },
      include: {
        course: {
          include: {
            teacher: true,
            period: true,
            moodleCheck: true,
          },
        },
      },
      orderBy: [{ computedAt: 'desc' }],
      take: 1000,
    });

    return {
      total: items.length,
      items,
    };
  }
}
