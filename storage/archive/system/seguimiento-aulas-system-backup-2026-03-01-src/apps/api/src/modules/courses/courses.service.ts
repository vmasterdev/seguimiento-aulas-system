import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { MoodleStatusSchema, normalizeMoment, normalizeTeacherId, TemplateSchema } from '@seguimiento/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue } from '../common/program.util';

const CoursesQuerySchema = z.object({
  periodCode: z.string().trim().optional(),
  status: MoodleStatusSchema.optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
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
  moment: z.string().trim().optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const AssignTeacherSchema = z.object({
  teacherId: z.string().trim().min(1),
  fullName: z.string().trim().max(200).optional(),
  email: z.string().trim().email().optional(),
});

@Injectable()
export class CoursesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(rawQuery: unknown) {
    const query = parseWithSchema(CoursesQuerySchema, rawQuery, 'courses query');

    const where = {
      period: query.periodCode ? { code: query.periodCode } : undefined,
      moodleCheck: query.status ? { status: query.status } : undefined,
      OR: query.q
        ? [
            { nrc: { contains: query.q, mode: 'insensitive' as const } },
            { subjectName: { contains: query.q, mode: 'insensitive' as const } },
            { teacher: { fullName: { contains: query.q, mode: 'insensitive' as const } } },
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
          courseProgramCode: item.programCode,
          courseProgramName: item.programName,
        });

        return {
          ...item,
          programCode: resolvedProgram.programCode,
          programName: resolvedProgram.programName,
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
        evaluations: { orderBy: { computedAt: 'desc' } },
      },
    });

    if (!course) {
      throw new NotFoundException('Curso no encontrado.');
    }

    const resolvedProgram = resolveProgramValue({
      teacherCostCenter: course.teacher?.costCenter ?? null,
      courseProgramCode: course.programCode,
      courseProgramName: course.programName,
    });

    return {
      ...course,
      programCode: resolvedProgram.programCode,
      programName: resolvedProgram.programName,
    };
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

  async missingTeacherList(rawQuery: unknown) {
    const query = parseWithSchema(MissingTeacherQuerySchema, rawQuery, 'missing teacher query');
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    const normalizedMoment = query.moment ? normalizeMoment(query.moment) : undefined;

    const where = {
      period: query.periodCode ? { code: query.periodCode } : undefined,
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
      const raw = course.rawJson && typeof course.rawJson === 'object' ? (course.rawJson as Record<string, unknown>) : {};
      const row =
        raw.row && typeof raw.row === 'object' ? (raw.row as Record<string, unknown>) : ({} as Record<string, unknown>);
      const sourceTeacherId = String(row.id_docente ?? row.docente_id ?? row.id ?? '').trim();
      const sourceDocumentId = String(
        row.identificacion ?? row.cedula ?? row.identificacion_docente ?? row.cedula_docente ?? '',
      ).trim();
      const sourceTeacherName = String(
        row.docente ?? row.nombre_docente ?? row.profesor ?? row.nombre_profesor ?? '',
      ).trim();
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
        courseProgramCode: course.programCode,
        courseProgramName: course.programName,
      });

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
        sourceTeacherId: sourceTeacherId || null,
        sourceDocumentId: sourceDocumentId || null,
        sourceTeacherName: sourceTeacherName || null,
        missingInSystemTeacher,
        missingInRpacaTeacherId,
        missingInRpacaTeacherName,
        missingReasons,
      };
      })
      .filter(
        (item) =>
          item.missingInSystemTeacher || item.missingInRpacaTeacherId || item.missingInRpacaTeacherName,
      );

    const total = mapped.length;
    const paged = mapped.slice(offset, offset + limit);

    return {
      ok: true,
      total,
      limit,
      offset,
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
        programCode: upsertedTeacher.costCenter ?? course.programCode,
        programName: upsertedTeacher.costCenter ?? course.programName,
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
          courseProgramCode: updatedCourse.programCode,
          courseProgramName: updatedCourse.programName,
        }),
      },
    };
  }
}
