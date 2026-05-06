import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  MoodleStatusSchema,
  normalizeMoment,
  normalizeTeacherId,
  normalizeTemplate,
  TemplateSchema,
} from '@seguimiento/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';
import { readBannerReview, readBannerReviewStatus } from '../common/banner-review.util';
import { getCourseReviewExclusionReason, isCourseExcludedFromReview, readEnrolledCount } from '../common/review-eligibility.util';

const CoursesQuerySchema = z.object({
  periodCode: z.string().trim().optional(),
  status: MoodleStatusSchema.optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const ManualUpdateSchema = z.object({
  status: MoodleStatusSchema.optional(),
  detectedTemplate: TemplateSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  errorCode: z.enum(['NO_EXISTE', 'SIN_ACCESO', 'TIMEOUT', 'OTRO']).optional(),
});

const MissingTeacherQuerySchema = z.object({
  periodCode: z.string().trim().optional(),
  periodCodes: z.string().trim().optional(),
  moment: z.string().trim().optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const BannerTeachersQuerySchema = z.object({
  periodCodes: z.string().trim().optional(),
  onlyUnresolved: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(5000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const MoodleFollowupQuerySchema = z.object({
  kind: z.enum(['sin_matricula', 'no_encontrado', 'ambos']).optional().default('ambos'),
  periodCodes: z.string().trim().optional(),
  moments: z.string().trim().optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

const AssignTeacherSchema = z.object({
  teacherId: z.string().trim().min(1),
  fullName: z.string().trim().max(200).optional(),
  email: z.string().trim().email().optional(),
});

const DeactivateCourseSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

const DeactivateCourseBatchSchema = z.object({
  courseIds: z.array(z.string().trim().min(1)).min(1).max(500),
  reason: z.string().trim().max(1000).optional(),
  confirm: z.coerce.boolean().optional().default(false),
});

const ChecklistTemporalSchema = z.object({
  active: z.coerce.boolean().optional().default(true),
  reason: z.string().trim().max(1000).optional(),
});

@Injectable()
export class CoursesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private parseCsvList(value: string | undefined) {
    return [...new Set(String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean))];
  }

  private classifyMoodleFollowupKind(moodleCheck: { status: string; errorCode: string | null } | null) {
    if (!moodleCheck) return null;
    const status = String(moodleCheck.status ?? '').trim().toUpperCase();
    const errorCode = String(moodleCheck.errorCode ?? '').trim().toUpperCase();
    if (status === 'DESCARTADO_NO_EXISTE' || errorCode === 'NO_EXISTE') return 'no_encontrado' as const;
    if (status === 'REVISAR_MANUAL' && errorCode === 'SIN_ACCESO') return 'sin_matricula' as const;
    return null;
  }

  private readChecklistTemporal(rawJson: unknown): { active: boolean; reason: string | null; at: string | null } {
    const root = this.asRecord(rawJson);
    const marker = this.asRecord(root.specialChecklistQueue);
    return {
      active: marker.active === true,
      reason: typeof marker.reason === 'string' && marker.reason.trim() ? marker.reason.trim() : null,
      at: typeof marker.at === 'string' && marker.at.trim() ? marker.at.trim() : null,
    };
  }

  private withManualExclusion(rawJson: unknown, reason: string) {
    const root =
      rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)
        ? ({ ...(rawJson as Record<string, unknown>) } as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    root.manualExclusion = {
      active: true,
      reason,
      at: new Date().toISOString(),
    };
    return root as Prisma.InputJsonValue;
  }

  private readMoodleSidecarMetrics(rawJson: unknown): {
    participants: number | null;
    participantsDetected: boolean | null;
    updatedAt: string | null;
  } {
    const root = this.asRecord(rawJson);
    const sidecar = this.asRecord(root.moodleSidecar);
    const participantsRaw = sidecar.participants;
    const participants =
      typeof participantsRaw === 'number' && Number.isFinite(participantsRaw)
        ? participantsRaw
        : typeof participantsRaw === 'string' && participantsRaw.trim()
          ? Number(participantsRaw)
          : null;

    return {
      participants: Number.isFinite(participants ?? NaN) ? Number(participants) : null,
      participantsDetected:
        typeof sidecar.participantsDetected === 'boolean' ? sidecar.participantsDetected : null,
      updatedAt: typeof sidecar.updatedAt === 'string' && sidecar.updatedAt.trim() ? sidecar.updatedAt.trim() : null,
    };
  }

  private pickBestReplacement(
    input: {
      group: {
        id: string;
        teacherId: string;
        periodId: string;
        programCode: string;
        template: string;
      };
      removedCourseId: string;
      candidates: Array<{
        id: string;
        nrc: string;
        programCode: string | null;
        programName: string | null;
        teacherId: string | null;
        teacher: { costCenter: string | null } | null;
        templateDeclared: string | null;
        rawJson: unknown;
        moodleCheck: { status: string; detectedTemplate: string | null; errorCode: string | null } | null;
        evaluations: Array<{ replicatedFromCourseId: string | null }>;
      }>;
    },
  ): string | null {
    const groupTemplate = normalizeTemplate(input.group.template || 'UNKNOWN');
    const targetProgramCode = input.group.programCode?.trim() || null;

    const ranked = input.candidates
      .filter((candidate) => candidate.id !== input.removedCourseId)
      .filter(
        (candidate) =>
          !isCourseExcludedFromReview({
            rawJson: candidate.rawJson,
            template: candidate.moodleCheck?.detectedTemplate ?? candidate.templateDeclared ?? 'UNKNOWN',
            moodleCheck: candidate.moodleCheck,
          }),
      )
      .map((candidate) => {
        const resolvedProgram = resolveProgramValue({
          teacherCostCenter: candidate.teacher?.costCenter ?? null,
          teacherLinked: !!candidate.teacherId,
          courseProgramCode: candidate.programCode,
          courseProgramName: candidate.programName,
        });
        const candidateProgramCode = resolvedProgram.programCode ?? null;
        const candidateTemplate = normalizeTemplate(
          candidate.moodleCheck?.detectedTemplate ?? candidate.templateDeclared ?? 'UNKNOWN',
        );
        const hasManualEvaluation = candidate.evaluations.some(
          (evaluation) => !evaluation.replicatedFromCourseId,
        );

        let rank = 0;
        if ((candidateProgramCode ?? 'SIN_PROGRAMA') === (targetProgramCode ?? 'SIN_PROGRAMA')) rank += 100;
        if (candidateTemplate === groupTemplate) rank += 80;
        if (hasManualEvaluation) rank += 20;
        rank += Math.min(candidate.evaluations.length, 5);

        return {
          candidate,
          rank,
        };
      })
      .sort((left, right) => right.rank - left.rank || left.candidate.nrc.localeCompare(right.candidate.nrc));

    return ranked[0]?.candidate.id ?? null;
  }

  async list(rawQuery: unknown) {
    const query = parseWithSchema(CoursesQuerySchema, rawQuery, 'courses query');

    const where = {
      period: query.periodCode ? { code: query.periodCode } : undefined,
      moodleCheck: query.status ? { status: query.status } : undefined,
      OR: query.q
        ? [
            { nrc: { contains: query.q, mode: 'insensitive' as const } },
            { subjectName: { contains: query.q, mode: 'insensitive' as const } },
            { teacherId: { contains: query.q, mode: 'insensitive' as const } },
            { teacher: { fullName: { contains: query.q, mode: 'insensitive' as const } } },
            { teacher: { id: { contains: query.q, mode: 'insensitive' as const } } },
            { teacher: { sourceId: { contains: query.q, mode: 'insensitive' as const } } },
            { teacher: { documentId: { contains: query.q, mode: 'insensitive' as const } } },
            { programName: { contains: query.q, mode: 'insensitive' as const } },
            { programCode: { contains: query.q, mode: 'insensitive' as const } },
            { teacher: { costCenter: { contains: query.q, mode: 'insensitive' as const } } },
          ]
        : undefined,
    };

    const [total, items] = await Promise.all([
      this.prisma.course.count({ where }),
      this.prisma.course.findMany({
        where,
        include: {
          period: true,
          teacher: true,
          moodleCheck: true,
          selectedInGroups: {
            select: {
              id: true,
              moment: true,
              template: true,
              programCode: true,
              modality: true,
            },
          },
          evaluations: {
            orderBy: { computedAt: 'desc' },
            take: 2,
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        skip: query.offset,
        take: query.limit,
      }),
    ]);

    return {
      total,
      limit: query.limit,
      offset: query.offset,
      items: items.map((item) => {
        const resolvedProgram = resolveProgramValue({
          teacherCostCenter: item.teacher?.costCenter ?? null,
          teacherLinked: !!item.teacherId,
          courseProgramCode: item.programCode,
          courseProgramName: item.programName,
        });
        const bannerReviewStatus = readBannerReviewStatus(item.rawJson);
        const moodleSidecarMetrics = this.readMoodleSidecarMetrics(item.rawJson);
        const alistamiento = item.evaluations.find((evaluation) => evaluation.phase === 'ALISTAMIENTO') ?? null;
        const ejecucion = item.evaluations.find((evaluation) => evaluation.phase === 'EJECUCION') ?? null;
        const latestEvaluation = item.evaluations[0] ?? null;

        return {
          ...item,
          programCode: resolvedProgram.programCode,
          programName: resolvedProgram.programName,
          bannerReviewStatus,
          checklistTemporal: this.readChecklistTemporal(item.rawJson),
          selectedForChecklist: item.selectedInGroups.length > 0,
          selectedSampleGroups: item.selectedInGroups,
          moodleSidecarMetrics,
          evaluationSummary: {
            alistamientoScore: alistamiento?.score ?? null,
            ejecucionScore: ejecucion?.score ?? null,
            latestPhase: latestEvaluation?.phase ?? null,
            latestScore: latestEvaluation?.score ?? null,
            latestObservations: latestEvaluation?.observations ?? null,
            latestComputedAt: latestEvaluation?.computedAt ?? null,
            latestReplicatedFromCourseId: latestEvaluation?.replicatedFromCourseId ?? null,
          },
          enrolledCount: readEnrolledCount(item.rawJson),
          reviewExcludedReason: getCourseReviewExclusionReason({
            rawJson: item.rawJson,
            template: item.moodleCheck?.detectedTemplate ?? item.templateDeclared ?? 'UNKNOWN',
            moodleCheck: item.moodleCheck,
          }),
          reviewExcluded: isCourseExcludedFromReview({
            rawJson: item.rawJson,
            template: item.moodleCheck?.detectedTemplate ?? item.templateDeclared ?? 'UNKNOWN',
            moodleCheck: item.moodleCheck,
          }),
        };
      }),
    };
  }

  async byId(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        period: true,
        teacher: true,
        moodleCheck: true,
        selectedInGroups: {
          select: {
            id: true,
            moment: true,
            template: true,
            programCode: true,
            modality: true,
            selectionSeed: true,
            createdAt: true,
          },
        },
        evaluations: { orderBy: { computedAt: 'desc' } },
      },
    });

    if (!course) {
      throw new NotFoundException('Curso no encontrado.');
    }

    const resolvedProgram = resolveProgramValue({
      teacherCostCenter: course.teacher?.costCenter ?? null,
      teacherLinked: !!course.teacherId,
      courseProgramCode: course.programCode,
      courseProgramName: course.programName,
    });
    const bannerReviewStatus = readBannerReviewStatus(course.rawJson);
    const moodleSidecarMetrics = this.readMoodleSidecarMetrics(course.rawJson);
    const sourceIds = [
      ...new Set(
        course.evaluations
          .map((evaluation) => evaluation.replicatedFromCourseId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const sourceCourses = sourceIds.length
      ? await this.prisma.course.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, nrc: true },
        })
      : [];
    const sourceNrcById = new Map(sourceCourses.map((source) => [source.id, source.nrc]));

    return {
      ...course,
      programCode: resolvedProgram.programCode,
      programName: resolvedProgram.programName,
      bannerReviewStatus,
      checklistTemporal: this.readChecklistTemporal(course.rawJson),
      selectedForChecklist: course.selectedInGroups.length > 0,
      selectedSampleGroups: course.selectedInGroups,
      moodleSidecarMetrics,
      evaluations: course.evaluations.map((evaluation) => ({
        ...evaluation,
        evaluationType: evaluation.replicatedFromCourseId ? 'REPLICADA' : 'MANUAL',
        replicatedFromNrc: evaluation.replicatedFromCourseId
          ? sourceNrcById.get(evaluation.replicatedFromCourseId) ?? null
          : null,
      })),
      enrolledCount: readEnrolledCount(course.rawJson),
      reviewExcludedReason: getCourseReviewExclusionReason({
        rawJson: course.rawJson,
        template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
        moodleCheck: course.moodleCheck,
      }),
      reviewExcluded: isCourseExcludedFromReview({
        rawJson: course.rawJson,
        template: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN',
        moodleCheck: course.moodleCheck,
      }),
    };
  }

  async updateMoment(id: string, payload: unknown) {
    const body = parseWithSchema(
      z.object({ moment: z.string().trim().min(1).max(20) }),
      payload,
      'update moment',
    );

    const course = await this.prisma.course.findUnique({ where: { id }, select: { id: true, nrc: true } });
    if (!course) throw new NotFoundException('Curso no encontrado.');

    const normalized = normalizeMoment(body.moment);
    const updated = await this.prisma.course.update({
      where: { id },
      data: { moment: normalized },
      select: { id: true, nrc: true, moment: true },
    });

    return { ok: true, course: updated };
  }

  async manualUpdate(id: string, payload: unknown) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!course) {
      throw new NotFoundException('Curso no encontrado.');
    }

    const body = parseWithSchema(ManualUpdateSchema, payload, 'manual moodle update');

    const updated = await this.prisma.moodleCheck.upsert({
      where: { courseId: id },
      create: {
        courseId: id,
        status: body.status ?? 'REVISAR_MANUAL',
        detectedTemplate: body.detectedTemplate,
        notes: body.notes,
        errorCode: body.errorCode,
      },
      update: {
        status: body.status,
        detectedTemplate: body.detectedTemplate,
        notes: body.notes,
        errorCode: body.errorCode,
      },
    });

    return { ok: true, moodleCheck: updated };
  }

  async moodleFollowupList(rawQuery: unknown) {
    const query = parseWithSchema(MoodleFollowupQuerySchema, rawQuery, 'moodle followup query');
    const limit = query.limit ?? 500;
    const offset = query.offset ?? 0;
    const periodCodes = this.parseCsvList(query.periodCodes);
    const moments = this.parseCsvList(query.moments).map((moment) => normalizeMoment(moment));

    const where = {
      period: periodCodes.length ? { code: { in: periodCodes } } : undefined,
      moment: moments.length ? { in: moments } : undefined,
      moodleCheck: {
        status: {
          in: ['REVISAR_MANUAL', 'DESCARTADO_NO_EXISTE'],
        },
      },
      OR: query.q
        ? [
            { nrc: { contains: query.q, mode: 'insensitive' as const } },
            { subjectName: { contains: query.q, mode: 'insensitive' as const } },
            { programName: { contains: query.q, mode: 'insensitive' as const } },
            { teacher: { fullName: { contains: query.q, mode: 'insensitive' as const } } },
          ]
        : undefined,
    };

    const items = await this.prisma.course.findMany({
      where,
      include: {
        period: true,
        teacher: true,
        moodleCheck: true,
      },
      orderBy: [{ periodId: 'desc' }, { nrc: 'asc' }],
    });

    const mapped = items
      .map((course) => {
        const kind = this.classifyMoodleFollowupKind(course.moodleCheck);
        if (!kind) return null;
        const bannerReviewStatus = readBannerReviewStatus(course.rawJson);
        const resolvedProgram = resolveProgramValue({
          teacherCostCenter: course.teacher?.costCenter ?? null,
          teacherLinked: !!course.teacherId,
          courseProgramCode: course.programCode,
          courseProgramName: course.programName,
        });

        return {
          id: course.id,
          nrc: course.nrc,
          subjectName: course.subjectName,
          periodCode: course.period.code,
          periodLabel: course.period.label,
          moment: course.moment,
          programCode: resolvedProgram.programCode,
          programName: resolvedProgram.programName,
          teacherId: course.teacherId,
          teacherName: course.teacher?.fullName ?? null,
          moodleStatus: course.moodleCheck?.status ?? null,
          moodleErrorCode: course.moodleCheck?.errorCode ?? null,
          moodleNotes: course.moodleCheck?.notes ?? null,
          moodleCourseUrl: course.moodleCheck?.moodleCourseUrl ?? null,
          moodleCourseId: course.moodleCheck?.moodleCourseId ?? null,
          bannerReviewStatus,
          followupKind: kind,
          canSendToBanner: kind === 'no_encontrado',
          canDeactivate: kind === 'no_encontrado' && bannerReviewStatus === 'NO_ENCONTRADO',
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => query.kind === 'ambos' || item.followupKind === query.kind);

    const total = mapped.length;
    const paged = mapped.slice(offset, offset + limit);

    const byKind: Record<string, number> = {};
    const byPeriod: Record<string, number> = {};
    const byBannerStatus: Record<string, number> = {};
    for (const item of mapped) {
      byKind[item.followupKind] = (byKind[item.followupKind] ?? 0) + 1;
      byPeriod[item.periodCode] = (byPeriod[item.periodCode] ?? 0) + 1;
      const bannerKey = item.bannerReviewStatus ?? 'SIN_DATO';
      byBannerStatus[bannerKey] = (byBannerStatus[bannerKey] ?? 0) + 1;
    }

    return {
      ok: true,
      total,
      limit,
      offset,
      filters: {
        kind: query.kind,
        periodCodes,
        moments,
      },
      byKind,
      byPeriod,
      byBannerStatus,
      items: paged,
    };
  }

  async missingTeacherList(rawQuery: unknown) {
    const query = parseWithSchema(MissingTeacherQuerySchema, rawQuery, 'missing teacher query');
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    const normalizedMoment = query.moment ? normalizeMoment(query.moment) : undefined;
    const periodCodes = this.parseCsvList(query.periodCodes);
    const effectivePeriodCodes = periodCodes.length
      ? periodCodes
      : query.periodCode?.trim()
        ? [query.periodCode.trim()]
        : [];

    const where = {
      period: effectivePeriodCodes.length ? { code: { in: effectivePeriodCodes } } : undefined,
      moment: normalizedMoment,
      OR: query.q
        ? [
            { nrc: { contains: query.q, mode: 'insensitive' as const } },
            { subjectName: { contains: query.q, mode: 'insensitive' as const } },
            { programName: { contains: query.q, mode: 'insensitive' as const } },
            { programCode: { contains: query.q, mode: 'insensitive' as const } },
            { teacher: { costCenter: { contains: query.q, mode: 'insensitive' as const } } },
          ]
        : undefined,
    };

    const items = await this.prisma.course.findMany({
      where,
      include: {
        period: true,
        teacher: true,
        moodleCheck: true,
      },
      orderBy: [{ periodId: 'asc' }, { nrc: 'asc' }],
    });

    const mapped = items
      .map((course) => {
        const raw =
          course.rawJson && typeof course.rawJson === 'object' ? (course.rawJson as Record<string, unknown>) : {};
        const row =
          raw.row && typeof raw.row === 'object'
            ? (raw.row as Record<string, unknown>)
            : ({} as Record<string, unknown>);
        const bannerReview = readBannerReview(course.rawJson) ?? {};
        const sourceTeacherId = String(row.id_docente ?? row.docente_id ?? row.id ?? '').trim();
        const sourceDocumentId = String(
          row.identificacion ?? row.cedula ?? row.identificacion_docente ?? row.cedula_docente ?? '',
        ).trim();
        const sourceTeacherName = String(
          row.docente ?? row.nombre_docente ?? row.profesor ?? row.nombre_profesor ?? '',
        ).trim();
        const bannerTeacherId = String(bannerReview.teacherId ?? '').trim();
        const bannerTeacherName = String(bannerReview.teacherName ?? '').trim();
        const bannerStatus = readBannerReviewStatus(course.rawJson);
        const bannerResolved = bannerStatus === 'ENCONTRADO' && !!course.teacherId;
        const missingInSystemTeacher = !course.teacherId;
        const missingInRpacaTeacherId = !sourceTeacherId && !sourceDocumentId;
        const missingInRpacaTeacherName = !sourceTeacherName;
        const missingReasons = [
          ...(missingInRpacaTeacherId ? ['RPACA sin ID_DOCENTE/CEDULA'] : []),
          ...(missingInRpacaTeacherName ? ['RPACA sin NOMBRE_DOCENTE'] : []),
          ...(missingInSystemTeacher ? ['Sin docente asignado en sistema'] : []),
        ];

        const resolvedProgram = resolveProgramValue({
          teacherCostCenter: course.teacher?.costCenter ?? null,
          teacherLinked: !!course.teacherId,
          courseProgramCode: course.programCode,
          courseProgramName: course.programName,
        });

        const preferredTeacherName = bannerTeacherName || sourceTeacherName || course.teacher?.fullName || null;
        const preferredTeacherId = bannerTeacherId || sourceTeacherId || sourceDocumentId || course.teacherId || null;
        const preferredSource =
          bannerTeacherId || bannerTeacherName ? 'BANNER' : sourceTeacherId || sourceTeacherName ? 'RPACA' : course.teacherId ? 'SISTEMA' : null;

        return {
          id: course.id,
          nrc: course.nrc,
          periodCode: course.period.code,
          programCode: resolvedProgram.programCode,
          programName: resolvedProgram.programName,
          subjectName: course.subjectName,
          moment: course.moment,
          moodleStatus: course.moodleCheck?.status ?? null,
          detectedTemplate: course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? null,
          currentTeacherId: course.teacherId,
          currentTeacherName: course.teacher?.fullName ?? null,
          sourceTeacherId: sourceTeacherId || null,
          sourceDocumentId: sourceDocumentId || null,
          sourceTeacherName: sourceTeacherName || null,
          bannerStatus,
          bannerTeacherId: bannerTeacherId || null,
          bannerTeacherName: bannerTeacherName || null,
          preferredTeacherId,
          preferredTeacherName,
          preferredSource,
          bannerResolved,
          missingInSystemTeacher,
          missingInRpacaTeacherId,
          missingInRpacaTeacherName,
          missingReasons,
        };
      })
      .filter(
        (item) =>
          !item.bannerResolved &&
          (item.missingInSystemTeacher || item.missingInRpacaTeacherId || item.missingInRpacaTeacherName),
      );

    const total = mapped.length;
    const paged = mapped.slice(offset, offset + limit);

    return {
      ok: true,
      total,
      limit,
      offset,
      filters: {
        periodCodes: effectivePeriodCodes,
        moment: normalizedMoment ?? null,
        q: query.q ?? null,
      },
      items: paged,
    };
  }

  async bannerTeachersList(rawQuery: unknown) {
    const query = parseWithSchema(BannerTeachersQuerySchema, rawQuery, 'banner teachers query');
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 200;
    const periodCodes = this.parseCsvList(query.periodCodes);

    const items = await this.prisma.course.findMany({
      where: {
        period: periodCodes.length ? { code: { in: periodCodes } } : undefined,
      },
      include: { period: true, teacher: true },
      orderBy: [{ periodId: 'asc' }, { nrc: 'asc' }],
    });

    const mapped = items
      .map((course) => {
        const bannerStatus = readBannerReviewStatus(course.rawJson);
        if (bannerStatus !== 'ENCONTRADO') return null;
        const bannerReview = readBannerReview(course.rawJson) ?? {};
        const bannerTeacherId = String((bannerReview as Record<string, unknown>).teacherId ?? '').trim() || null;
        const bannerTeacherName = String((bannerReview as Record<string, unknown>).teacherName ?? '').trim() || null;
        const bannerResolved = !!course.teacherId;
        return {
          id: course.id,
          nrc: course.nrc,
          periodCode: course.period.code,
          subjectName: course.subjectName,
          programCode: course.programCode,
          bannerTeacherId,
          bannerTeacherName,
          bannerResolved,
          currentTeacherId: course.teacherId,
          currentTeacherName: course.teacher?.fullName ?? null,
          currentTeacherEmail: course.teacher?.email ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => !query.onlyUnresolved || !item.bannerResolved);

    const total = mapped.length;
    const paged = mapped.slice(offset, offset + limit);
    const uniqueTeacherIds = new Set(mapped.map((i) => i.bannerTeacherId).filter(Boolean));
    const resolvedCount = mapped.filter((i) => i.bannerResolved).length;

    return {
      ok: true,
      total,
      limit,
      offset,
      stats: {
        totalNrcs: mapped.length,
        uniqueTeachers: uniqueTeacherIds.size,
        resolved: resolvedCount,
        unresolved: mapped.length - resolvedCount,
      },
      items: paged,
    };
  }

  async assignTeacher(courseId: string, payload: unknown) {
    const body = parseWithSchema(AssignTeacherSchema, payload, 'assign teacher payload');
    const normalizedTeacherId = normalizeTeacherId(body.teacherId);
    if (!normalizedTeacherId) {
      throw new BadRequestException('El ID docente no es valido.');
    }

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: { period: true },
    });
    if (!course) {
      throw new NotFoundException('Curso no encontrado.');
    }

    const existingTeacher =
      (await this.prisma.teacher.findUnique({ where: { id: normalizedTeacherId } })) ??
      (await this.prisma.teacher.findFirst({
        where: {
          OR: [{ sourceId: normalizedTeacherId }, { documentId: normalizedTeacherId }],
        },
      }));

    const sourceRaw =
      course.rawJson && typeof course.rawJson === 'object' ? (course.rawJson as Record<string, unknown>) : {};
    const sourceRow =
      sourceRaw.row && typeof sourceRaw.row === 'object'
        ? (sourceRaw.row as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const fallbackName = String(
      sourceRow.docente ??
        sourceRow.nombre_docente ??
        sourceRow.profesor ??
        sourceRow.nombre_profesor ??
        'Docente no identificado',
    ).trim();
    const fallbackEmail = String(
      sourceRow.email_docente ?? sourceRow.correo_docente ?? sourceRow.email ?? sourceRow.correo ?? '',
    ).trim();

    const teacherIdToUse = existingTeacher?.id ?? normalizedTeacherId;

    const upsertedTeacher = await this.prisma.teacher.upsert({
      where: { id: teacherIdToUse },
      create: {
        id: teacherIdToUse,
        sourceId: existingTeacher?.sourceId ?? normalizedTeacherId,
        documentId: existingTeacher?.documentId ?? null,
        fullName: body.fullName || existingTeacher?.fullName || fallbackName || 'Docente no identificado',
        email: body.email || existingTeacher?.email || fallbackEmail || null,
        campus: existingTeacher?.campus ?? null,
        region: existingTeacher?.region ?? null,
        costCenter: existingTeacher?.costCenter ?? null,
        coordination: existingTeacher?.coordination ?? null,
      },
      update: {
        fullName: body.fullName || existingTeacher?.fullName || fallbackName,
        email: body.email || existingTeacher?.email || fallbackEmail || undefined,
        sourceId: existingTeacher?.sourceId || normalizedTeacherId,
      },
    });

    const raw =
      course.rawJson && typeof course.rawJson === 'object'
        ? ({ ...(course.rawJson as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const row =
      raw.row && typeof raw.row === 'object'
        ? ({ ...(raw.row as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    // Persistimos correcciones manuales en el snapshot de origen para que el NRC deje de salir como faltante.
    if (!String(row.id_docente ?? row.docente_id ?? row.id ?? '').trim()) {
      row.id_docente = teacherIdToUse;
    }
    if (!String(row.docente ?? row.nombre_docente ?? row.profesor ?? row.nombre_profesor ?? '').trim()) {
      row.docente = upsertedTeacher.fullName;
    }
    if (!String(row.email_docente ?? row.correo_docente ?? row.email ?? row.correo ?? '').trim()) {
      row.email_docente = upsertedTeacher.email ?? '';
    }
    raw.row = row;

    const updatedCourse = await this.prisma.course.update({
      where: { id: course.id },
      data: {
        teacherId: teacherIdToUse,
        programCode: resolveProgramValue({
          teacherCostCenter: upsertedTeacher.costCenter,
          teacherLinked: true,
          courseProgramCode: course.programCode,
          courseProgramName: course.programName,
        }).programCode,
        programName: resolveProgramValue({
          teacherCostCenter: upsertedTeacher.costCenter,
          teacherLinked: true,
          courseProgramCode: course.programCode,
          courseProgramName: course.programName,
        }).programName,
        rawJson: raw as unknown as Prisma.InputJsonValue,
      },
      include: {
        period: true,
        teacher: true,
        moodleCheck: true,
      },
    });

    return {
      ok: true,
      course: {
        ...updatedCourse,
        ...resolveProgramValue({
          teacherCostCenter: upsertedTeacher.costCenter,
          teacherLinked: true,
          courseProgramCode: updatedCourse.programCode,
          courseProgramName: updatedCourse.programName,
        }),
      },
    };
  }

  async deactivate(courseId: string, payload: unknown) {
    const body = parseWithSchema(DeactivateCourseSchema, payload, 'deactivate course payload');
    const reason = body.reason?.trim() || 'NRC desactivado manualmente: docente ya no dicta este curso.';

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        teacher: true,
      },
    });
    if (!course) {
      throw new NotFoundException('Curso no encontrado.');
    }

    const selectedGroups = await this.prisma.sampleGroup.findMany({
      where: { selectedCourseId: course.id },
      orderBy: [{ createdAt: 'asc' }],
    });

    const candidateCache = new Map<
      string,
      Array<{
        id: string;
        nrc: string;
        programCode: string | null;
        programName: string | null;
        teacherId: string | null;
        teacher: { costCenter: string | null } | null;
        templateDeclared: string | null;
        rawJson: unknown;
        moodleCheck: { status: string; detectedTemplate: string | null; errorCode: string | null } | null;
        evaluations: Array<{ replicatedFromCourseId: string | null }>;
      }>
    >();

    const replacementByGroupId = new Map<string, string | null>();
    for (const group of selectedGroups) {
      const key = `${group.teacherId}|${group.periodId}|${group.moment}`;
      let candidates = candidateCache.get(key);
      if (!candidates) {
        const rows = await this.prisma.course.findMany({
          where: {
            teacherId: group.teacherId,
            periodId: group.periodId,
            moment: group.moment,
            id: { not: course.id },
          },
          include: {
            teacher: { select: { costCenter: true } },
            moodleCheck: {
              select: {
                status: true,
                detectedTemplate: true,
                errorCode: true,
              },
            },
            evaluations: {
              select: {
                replicatedFromCourseId: true,
              },
            },
          },
          orderBy: [{ nrc: 'asc' }],
        });
        candidates = rows;
        candidateCache.set(key, candidates);
      }

      const replacementId = this.pickBestReplacement({
        group: {
          id: group.id,
          teacherId: group.teacherId,
          periodId: group.periodId,
          programCode: group.programCode,
          template: group.template,
        },
        removedCourseId: course.id,
        candidates,
      });
      replacementByGroupId.set(group.id, replacementId);
    }

    const uniqueReplacementIds = Array.from(
      new Set(Array.from(replacementByGroupId.values()).filter((value): value is string => Boolean(value))),
    );
    const replicatedFromReplacementId = uniqueReplacementIds.length === 1 ? uniqueReplacementIds[0] : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const moodleCheck = await tx.moodleCheck.upsert({
        where: { courseId: course.id },
        create: {
          courseId: course.id,
          status: 'DESCARTADO_NO_EXISTE',
          errorCode: 'NO_EXISTE',
          notes: `[EXCLUIDO_MANUAL] ${reason}`,
        },
        update: {
          status: 'DESCARTADO_NO_EXISTE',
          errorCode: 'NO_EXISTE',
          notes: `[EXCLUIDO_MANUAL] ${reason}`,
        },
      });

      const updatedCourse = await tx.course.update({
        where: { id: course.id },
        data: {
          rawJson: this.withManualExclusion(course.rawJson, reason),
        },
      });

      let groupsReassigned = 0;
      let groupsWithoutReplacement = 0;
      for (const group of selectedGroups) {
        const replacementId = replacementByGroupId.get(group.id) ?? null;
        await tx.sampleGroup.update({
          where: { id: group.id },
          data: {
            selectedCourseId: replacementId,
          },
        });
        if (replacementId) groupsReassigned += 1;
        else groupsWithoutReplacement += 1;
      }

      const replicatedUpdate = await tx.evaluation.updateMany({
        where: {
          replicatedFromCourseId: course.id,
        },
        data: {
          replicatedFromCourseId: replicatedFromReplacementId,
          computedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actor: 'SYSTEM',
          action: 'COURSE_MANUAL_DEACTIVATE',
          entityType: 'COURSE',
          entityId: course.id,
          details: {
            courseId: course.id,
            nrc: course.nrc,
            periodId: course.periodId,
            moment: course.moment,
            teacherId: course.teacherId,
            teacherName: course.teacher?.fullName ?? null,
            reason,
            groupsMatched: selectedGroups.length,
            groupsReassigned,
            groupsWithoutReplacement,
            replicatedFromReplacementId,
            replacementCourseIds: uniqueReplacementIds,
            replicatedEvaluationsUpdated: replicatedUpdate.count,
          },
        },
      });

      return {
        updatedCourse,
        moodleCheck,
        groupsMatched: selectedGroups.length,
        groupsReassigned,
        groupsWithoutReplacement,
        replicatedEvaluationsUpdated: replicatedUpdate.count,
      };
    });

    const replacementCourses = uniqueReplacementIds.length
      ? await this.prisma.course.findMany({
          where: { id: { in: uniqueReplacementIds } },
          select: { id: true, nrc: true },
          orderBy: [{ nrc: 'asc' }],
        })
      : [];

    return {
      ok: true,
      deactivated: {
        courseId: updated.updatedCourse.id,
        nrc: course.nrc,
        reason,
      },
      reassignment: {
        groupsMatched: updated.groupsMatched,
        groupsReassigned: updated.groupsReassigned,
        groupsWithoutReplacement: updated.groupsWithoutReplacement,
        replacementCourses,
      },
      replication: {
        replicatedEvaluationsUpdated: updated.replicatedEvaluationsUpdated,
        replicatedFromReplacementId,
      },
    };
  }

  async deactivateBatch(payload: unknown) {
    const body = parseWithSchema(DeactivateCourseBatchSchema, payload, 'deactivate course batch payload');
    if (!body.confirm) {
      throw new BadRequestException('Debes confirmar la desactivacion multiple.');
    }

    const uniqueIds = [...new Set(body.courseIds)];
    const results: Array<{
      courseId: string;
      ok: boolean;
      nrc: string | null;
      message: string;
    }> = [];

    for (const courseId of uniqueIds) {
      try {
        const response = await this.deactivate(courseId, { reason: body.reason });
        results.push({
          courseId,
          ok: true,
          nrc: response.deactivated?.nrc ?? null,
          message: 'Desactivado',
        });
      } catch (error) {
        results.push({
          courseId,
          ok: false,
          nrc: null,
          message: error instanceof Error ? error.message : 'No fue posible desactivar el NRC.',
        });
      }
    }

    return {
      ok: true,
      requested: uniqueIds.length,
      deactivated: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    };
  }

  async setChecklistTemporal(courseId: string, payload: unknown) {
    const body = parseWithSchema(ChecklistTemporalSchema, payload, 'checklist temporal payload');
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, nrc: true, rawJson: true, period: { select: { code: true } }, moment: true },
    });
    if (!course) {
      throw new NotFoundException('Curso no encontrado.');
    }

    const root = this.asRecord(course.rawJson);
    if (body.active) {
      root.specialChecklistQueue = {
        active: true,
        reason:
          body.reason?.trim() ||
          'NRC agregado temporalmente para recalificacion (rezagado/caso especial).',
        at: new Date().toISOString(),
      };
    } else {
      delete root.specialChecklistQueue;
    }

    await this.prisma.course.update({
      where: { id: course.id },
      data: {
        rawJson: root as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actor: 'SYSTEM',
        action: body.active ? 'COURSE_CHECKLIST_TEMPORAL_ADD' : 'COURSE_CHECKLIST_TEMPORAL_REMOVE',
        entityType: 'COURSE',
        entityId: course.id,
        details: {
          courseId: course.id,
          nrc: course.nrc,
          periodCode: course.period.code,
          moment: course.moment,
          active: body.active,
          reason: body.reason?.trim() || null,
        },
      },
    });

    return {
      ok: true,
      courseId: course.id,
      nrc: course.nrc,
      checklistTemporal: this.readChecklistTemporal(root),
    };
  }

  async rpacaReport(query: unknown): Promise<string> {
    const q = z.object({
      periodCode: z.string().trim().optional(),
      moment: z.string().trim().optional(),
    }).parse(query ?? {});

    const where: Prisma.CourseWhereInput = {};
    if (q.periodCode) {
      const period = await this.prisma.period.findUnique({ where: { code: q.periodCode } });
      if (period) where.periodId = period.id;
    }
    if (q.moment) where.moment = q.moment;

    const courses = await this.prisma.course.findMany({
      where,
      orderBy: [{ period: { code: 'asc' } }, { nrc: 'asc' }],
      select: {
        nrc: true,
        subjectName: true,
        campusCode: true,
        moment: true,
        period: { select: { code: true } },
        moodleCheck: {
          select: {
            status: true,
            detectedTemplate: true,
            errorCode: true,
          },
        },
      },
    });

    const templateLabel = (mc: { status: string; detectedTemplate: string | null; errorCode: string | null } | null): string => {
      if (!mc) return 'NO REGISTRADO';
      const status = mc.status?.toUpperCase() ?? '';
      if (status === 'DESCARTADO_NO_EXISTE' || mc.errorCode === 'NO_EXISTE') return 'NO EXISTE EN MOODLE';
      if (!mc.detectedTemplate) return 'NO REGISTRADO';
      const t = mc.detectedTemplate.toUpperCase();
      if (t === 'CRIBA') return 'CRIBA';
      if (t === 'INNOVAME') return 'INNOVAME';
      if (t === 'D4') return 'D4 (Distancia 4.0)';
      if (t === 'VACIO') return 'VACIO';
      return t;
    };

    const esc = (s: string | null | undefined) => {
      const v = s ?? '';
      if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };

    const header = 'Periodo,Momento,NRC,Nombre Asignatura,Sede,Plantilla Detectada\n';
    const rows = courses.map((c) =>
      [
        esc(c.period.code),
        esc(c.moment),
        esc(c.nrc),
        esc(c.subjectName),
        esc(c.campusCode),
        esc(templateLabel(c.moodleCheck)),
      ].join(','),
    );

    return header + rows.join('\n');
  }
}
