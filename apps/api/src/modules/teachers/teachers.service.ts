import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { normalizeHeader, normalizeTeacherId } from '@seguimiento/shared';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { resolveProgramValue, resolveTeacherProgramOverride } from '../common/program.util';
import { readBannerReview, readBannerReviewStatus } from '../common/banner-review.util';

const TeachersQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(120),
  offset: z.coerce.number().int().min(0).default(0),
});

const UpsertTeacherSchema = z.object({
  id: z.string().trim().optional(),
  sourceId: z.string().trim().optional(),
  documentId: z.string().trim().optional(),
  fullName: z.string().trim().min(1, 'Nombre requerido').max(200),
  email: z
    .string()
    .trim()
    .email('Correo invalido')
    .optional()
    .or(z.literal('')),
  email2: z
    .string()
    .trim()
    .email('Correo 2 invalido')
    .optional()
    .or(z.literal('')),
  campus: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  costCenter: z.string().trim().max(100).optional(),
  coordination: z.string().trim().max(200).optional(),
  escalafon: z.string().trim().max(100).optional(),
  dedicacion: z.string().trim().max(100).optional(),
  tipoContrato: z.string().trim().max(100).optional(),
  fechaInicio: z.string().trim().optional(),
  fechaFin: z.string().trim().optional(),
  antiguedadText: z.string().trim().max(200).optional(),
  programaAcademico: z.string().trim().max(200).optional(),
  programaCodigo: z.string().trim().max(50).optional(),
  previousEmployment: z.boolean().optional(),
});

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiters = [',', ';', '\t', '|'];
  return delimiters
    .map((delimiter) => ({ delimiter, score: firstLine.split(delimiter).length }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter ?? ',';
}

function normalizeRowKeys(input: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    normalized[normalizeHeader(key)] = String(value ?? '').trim();
  }
  return normalized;
}

function pickValue(row: Record<string, string>, candidates: string[]): string {
  for (const candidate of candidates) {
    const value = row[candidate];
    if (value) return value;
  }

  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const fuzzy = keys.find((key) => key.includes(candidate));
    if (fuzzy && row[fuzzy]) return row[fuzzy];
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

@Injectable()
export class TeachersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async syncTeacherProgramToCourses(teacherId: string, program: string | null) {
    const resolved = resolveProgramValue({ teacherId, teacherCostCenter: program });
    if (!resolved.programCode && !resolved.programName) return;

    await this.prisma.course.updateMany({
      where: { teacherId },
      data: {
        programCode: resolved.programCode,
        programName: resolved.programName,
      },
    });
  }

  async list(rawQuery: unknown) {
    const query = parseWithSchema(TeachersQuerySchema, rawQuery, 'teachers query');
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 120;
    const q = query.q?.trim();

    const where = q
      ? {
          OR: [
            { id: { contains: q, mode: 'insensitive' as const } },
            { sourceId: { contains: q, mode: 'insensitive' as const } },
            { documentId: { contains: q, mode: 'insensitive' as const } },
            { fullName: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { email2: { contains: q, mode: 'insensitive' as const } },
            { coordination: { contains: q, mode: 'insensitive' as const } },
            { costCenter: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const [total, items] = await Promise.all([
      this.prisma.teacher.count({ where }),
      this.prisma.teacher.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
    ]);

    return {
      ok: true,
      total,
      limit,
      offset,
      items,
    };
  }

  async upsertOne(payload: unknown) {
    const body = parseWithSchema(UpsertTeacherSchema, payload, 'upsert teacher payload');

    const normalizedId = normalizeTeacherId(body.id ?? '');
    const normalizedSourceId = normalizeTeacherId(body.sourceId ?? '');
    const normalizedDocumentId = normalizeTeacherId(body.documentId ?? '');
    const candidateId = normalizedId || normalizedSourceId || normalizedDocumentId;
    if (!candidateId) {
      throw new BadRequestException('Debes indicar ID, sourceId o documentId.');
    }

    const existingById = await this.prisma.teacher.findUnique({ where: { id: candidateId } });
    const existingByAlt =
      existingById ??
      (await this.prisma.teacher.findFirst({
        where: {
          OR: [
            ...(normalizedSourceId ? [{ sourceId: normalizedSourceId }] : []),
            ...(normalizedDocumentId ? [{ documentId: normalizedDocumentId }] : []),
          ],
        },
      }));
    const teacherId = existingByAlt?.id ?? candidateId;
    const normalizedCostCenter = resolveTeacherProgramOverride({
      teacherId,
      teacherSourceId: normalizedSourceId || existingByAlt?.sourceId || null,
      teacherDocumentId: normalizedDocumentId || existingByAlt?.documentId || null,
      teacherName: body.fullName,
      teacherCostCenter: body.costCenter || existingByAlt?.costCenter || null,
    });
    const normalizedCoordination = resolveTeacherProgramOverride({
      teacherId,
      teacherSourceId: normalizedSourceId || existingByAlt?.sourceId || null,
      teacherDocumentId: normalizedDocumentId || existingByAlt?.documentId || null,
      teacherName: body.fullName,
      teacherCostCenter: body.coordination || body.costCenter || existingByAlt?.coordination || existingByAlt?.costCenter || null,
    });

    const parseDateLocal = (v: string | undefined): Date | null | undefined => {
      if (v === undefined) return undefined;
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const fechaInicioVal = parseDateLocal(body.fechaInicio);
    const fechaFinVal = parseDateLocal(body.fechaFin);

    const teacher = await this.prisma.teacher.upsert({
      where: { id: teacherId },
      create: {
        id: teacherId,
        sourceId: normalizedSourceId || null,
        documentId: normalizedDocumentId || null,
        fullName: body.fullName,
        email: body.email || null,
        email2: body.email2 || null,
        campus: body.campus || null,
        region: body.region || null,
        costCenter: normalizedCostCenter,
        coordination: normalizedCoordination,
        escalafon: body.escalafon || null,
        dedicacion: body.dedicacion || null,
        tipoContrato: body.tipoContrato || null,
        fechaInicio: fechaInicioVal ?? null,
        fechaFin: fechaFinVal ?? null,
        antiguedadText: body.antiguedadText || null,
        programaAcademico: body.programaAcademico || null,
        programaCodigo: body.programaCodigo || null,
        previousEmployment: body.previousEmployment ?? false,
      },
      update: {
        sourceId: normalizedSourceId || existingByAlt?.sourceId || undefined,
        documentId: normalizedDocumentId || existingByAlt?.documentId || undefined,
        fullName: body.fullName,
        email: body.email || undefined,
        email2: body.email2 !== undefined ? (body.email2 || null) : undefined,
        campus: body.campus || undefined,
        region: body.region || undefined,
        costCenter: normalizedCostCenter || undefined,
        coordination: normalizedCoordination || undefined,
        escalafon: body.escalafon !== undefined ? (body.escalafon || null) : undefined,
        dedicacion: body.dedicacion !== undefined ? (body.dedicacion || null) : undefined,
        tipoContrato: body.tipoContrato !== undefined ? (body.tipoContrato || null) : undefined,
        fechaInicio: fechaInicioVal ?? undefined,
        fechaFin: fechaFinVal ?? undefined,
        antiguedadText: body.antiguedadText !== undefined ? (body.antiguedadText || null) : undefined,
        programaAcademico: body.programaAcademico !== undefined ? (body.programaAcademico || null) : undefined,
        programaCodigo: body.programaCodigo !== undefined ? (body.programaCodigo || null) : undefined,
        previousEmployment: body.previousEmployment !== undefined ? body.previousEmployment : undefined,
      },
    });

    await this.syncTeacherProgramToCourses(teacher.id, normalizedCostCenter);

    return { ok: true, teacher };
  }

  async importCsv(files: Express.Multer.File[], _payload: unknown) {
    const ID_KEYS = ['id', 'id_docente', 'docente_id'];
    const DOC_KEYS = ['cedula', 'identificacion', 'cedula_docente', 'identificacion_docente'];
    const NAME_KEYS = ['docente', 'nombre_docente', 'nombre', 'profesor', 'nombre_profesor'];
    const EMAIL_KEYS = ['email', 'correo', 'correo_docente', 'email_docente'];
    const EMAIL2_KEYS = ['email2', 'correo2', 'correo_admin', 'correo_secundario', 'email_admin'];
    const CAMPUS_KEYS = ['sede', 'campus', 'sdoc', 'centro', 'centro_docente'];
    const REGION_KEYS = ['zona', 'region', 'ubicacion', 'ubica'];
    const COST_KEYS = ['centrocosto', 'costcenter'];
    const COORD_KEYS = ['responsable', 'coordination', 'coordinacion'];
    const ESCALAFON_KEYS = ['escalafon', 'escalafón', 'rango', 'categoria'];
    const DEDICACION_KEYS = ['dedicacion', 'dedicación', 'tipo_dedicacion'];
    const TIPO_CONTRATO_KEYS = ['tipo_contrato', 'tipocontrato', 'contrato'];
    const FECHA_INICIO_KEYS = ['fecha_inicio', 'fechainicio', 'inicio'];
    const FECHA_FIN_KEYS = ['fecha_fin', 'fechafin', 'fin', 'fecha_terminacion'];
    const ANTIGUEDAD_KEYS = ['antiguedad', 'antigüedad', 'tiempo_servicio'];
    const PROG_ACAD_KEYS = ['programa_academico', 'programa_académico', 'programaacademico'];
    const PROG_CODE_KEYS = ['programa', 'codigo_programa', 'codigoprograma'];

    function parseDate(value: string | null): Date | null {
      if (!value) return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      const d = new Date(trimmed);
      if (Number.isNaN(d.getTime())) return null;
      return d;
    }

    let totalRows = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const file of files) {
      const text = file.buffer.toString('utf8');
      const delimiter = detectDelimiter(text);
      const records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        delimiter,
        trim: true,
        relax_column_count: true,
      }) as Array<Record<string, unknown>>;
      totalRows += records.length;

      for (let index = 0; index < records.length; index += 1) {
        try {
          const row = normalizeRowKeys(records[index]);
          const id = normalizeTeacherId(pickValue(row, ID_KEYS));
          const documentId = normalizeTeacherId(pickValue(row, DOC_KEYS));
          const sourceId = id;
          const teacherId = id || documentId;
          const fullName = pickValue(row, NAME_KEYS);

          if (!teacherId || !fullName) {
            skipped += 1;
            continue;
          }

          const existing =
            (await this.prisma.teacher.findUnique({ where: { id: teacherId } })) ??
            (await this.prisma.teacher.findFirst({
              where: {
                OR: [
                  ...(sourceId ? [{ sourceId }] : []),
                  ...(documentId ? [{ documentId }] : []),
                ],
              },
            }));
          const finalId = existing?.id ?? teacherId;

          const costCenter = resolveTeacherProgramOverride({
            teacherId: finalId,
            teacherSourceId: sourceId || existing?.sourceId || null,
            teacherDocumentId: documentId || existing?.documentId || null,
            teacherName: fullName,
            teacherCostCenter: pickValue(row, COST_KEYS) || existing?.costCenter || null,
          });
          const coordination = resolveTeacherProgramOverride({
            teacherId: finalId,
            teacherSourceId: sourceId || existing?.sourceId || null,
            teacherDocumentId: documentId || existing?.documentId || null,
            teacherName: fullName,
            teacherCostCenter: pickValue(row, COORD_KEYS) || pickValue(row, COST_KEYS) || existing?.coordination || existing?.costCenter || null,
          });

          const escalafonVal = pickValue(row, ESCALAFON_KEYS) || null;
          const dedicacionVal = pickValue(row, DEDICACION_KEYS) || null;
          const tipoContratoVal = pickValue(row, TIPO_CONTRATO_KEYS) || null;
          const fechaInicioVal = parseDate(pickValue(row, FECHA_INICIO_KEYS));
          const fechaFinVal = parseDate(pickValue(row, FECHA_FIN_KEYS));
          const antiguedadVal = pickValue(row, ANTIGUEDAD_KEYS) || null;
          const programaAcademicoVal = pickValue(row, PROG_ACAD_KEYS) || null;
          const programaCodigoVal = pickValue(row, PROG_CODE_KEYS) || null;

          await this.prisma.teacher.upsert({
            where: { id: finalId },
            create: {
              id: finalId,
              sourceId: sourceId || null,
              documentId: documentId || null,
              fullName,
              email: pickValue(row, EMAIL_KEYS) || null,
              email2: pickValue(row, EMAIL2_KEYS) || null,
              campus: pickValue(row, CAMPUS_KEYS) || null,
              region: pickValue(row, REGION_KEYS) || null,
              costCenter,
              coordination,
              escalafon: escalafonVal,
              dedicacion: dedicacionVal,
              tipoContrato: tipoContratoVal,
              fechaInicio: fechaInicioVal,
              fechaFin: fechaFinVal,
              antiguedadText: antiguedadVal,
              programaAcademico: programaAcademicoVal,
              programaCodigo: programaCodigoVal,
            },
            update: {
              sourceId: sourceId || existing?.sourceId || undefined,
              documentId: documentId || existing?.documentId || undefined,
              fullName,
              email: pickValue(row, EMAIL_KEYS) || undefined,
              email2: pickValue(row, EMAIL2_KEYS) || undefined,
              campus: pickValue(row, CAMPUS_KEYS) || undefined,
              region: pickValue(row, REGION_KEYS) || undefined,
              costCenter: costCenter || undefined,
              coordination: coordination || undefined,
              escalafon: escalafonVal ?? undefined,
              dedicacion: dedicacionVal ?? undefined,
              tipoContrato: tipoContratoVal ?? undefined,
              fechaInicio: fechaInicioVal ?? undefined,
              fechaFin: fechaFinVal ?? undefined,
              antiguedadText: antiguedadVal ?? undefined,
              programaAcademico: programaAcademicoVal ?? undefined,
              programaCodigo: programaCodigoVal ?? undefined,
            },
          });

          await this.syncTeacherProgramToCourses(finalId, costCenter || existing?.costCenter || null);

          if (existing) {
            updated += 1;
          } else {
            created += 1;
          }
        } catch (error) {
          skipped += 1;
          const message = error instanceof Error ? error.message : 'Error desconocido';
          if (errors.length < 50) {
            errors.push(`${file.originalname} fila ${index + 2}: ${message}`);
          }
        }
      }
    }

    return {
      ok: true,
      files: files.length,
      totalRows,
      created,
      updated,
      skipped,
      errors,
    };
  }

  async consolidateBannerIdsFromResolvedCourses() {
    const courses = await this.prisma.course.findMany({
      where: {
        teacherId: { not: null },
      },
      select: {
        id: true,
        nrc: true,
        rawJson: true,
        teacher: {
          select: {
            id: true,
            fullName: true,
            extraJson: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const byTeacher = new Map<
      string,
      {
        teacherId: string;
        teacherName: string;
        teacherExtraJson: Record<string, unknown>;
        bannerIds: Set<string>;
        courseRefs: string[];
      }
    >();

    let skippedWithoutLinkedTeacher = 0;
    let skippedWithoutBannerId = 0;

    for (const course of courses) {
      const bannerStatus = readBannerReviewStatus(course.rawJson);
      if (bannerStatus !== 'ENCONTRADO') continue;
      if (!course.teacher) {
        skippedWithoutLinkedTeacher += 1;
        continue;
      }

      const bannerReview = readBannerReview(course.rawJson);
      const bannerTeacherId = normalizeTeacherId(bannerReview?.teacherId ?? '');
      if (!bannerTeacherId) {
        skippedWithoutBannerId += 1;
        continue;
      }

      const bucket = byTeacher.get(course.teacher.id) ?? {
        teacherId: course.teacher.id,
        teacherName: course.teacher.fullName,
        teacherExtraJson: asRecord(course.teacher.extraJson),
        bannerIds: new Set<string>(),
        courseRefs: [],
      };

      bucket.bannerIds.add(bannerTeacherId);
      bucket.courseRefs.push(`${course.nrc}`);
      byTeacher.set(course.teacher.id, bucket);
    }

    let updatedTeachers = 0;
    let alreadyConsistent = 0;
    let conflicts = 0;
    const conflictSamples: Array<{ teacherId: string; fullName: string; bannerIds: string[] }> = [];

    for (const item of byTeacher.values()) {
      const ids = [...item.bannerIds];
      if (!ids.length) continue;
      if (ids.length > 1) {
        conflicts += 1;
        if (conflictSamples.length < 10) {
          conflictSamples.push({
            teacherId: item.teacherId,
            fullName: item.teacherName,
            bannerIds: ids,
          });
        }
        continue;
      }

      const bannerPersonId = ids[0];
      const existingBannerPersonId = normalizeTeacherId(item.teacherExtraJson.bannerPersonId ?? '');
      if (existingBannerPersonId === bannerPersonId) {
        alreadyConsistent += 1;
        continue;
      }

      const nextExtraJson: Record<string, unknown> = {
        ...item.teacherExtraJson,
        bannerPersonId,
        bannerPersonIdSource: 'BANNER_REVIEW',
        bannerPersonIdUpdatedAt: new Date().toISOString(),
      };

      await this.prisma.teacher.update({
        where: { id: item.teacherId },
        data: {
          extraJson: nextExtraJson as Prisma.InputJsonValue,
        },
      });
      updatedTeachers += 1;
    }

    return {
      ok: true,
      reviewedCourses: courses.length,
      candidateTeachers: byTeacher.size,
      updatedTeachers,
      alreadyConsistent,
      conflicts,
      skippedWithoutLinkedTeacher,
      skippedWithoutBannerId,
      conflictSamples,
    };
  }

  async keepOnlyBySourceIds(keepSourceIds: string[], dryRun = true) {
    const keepSet = new Set(keepSourceIds.map((s) => String(s).trim()).filter(Boolean));

    const toDelete = await this.prisma.teacher.findMany({
      where: {
        OR: [
          { sourceId: null },
          { sourceId: { notIn: [...keepSet] } },
        ],
      },
      include: { _count: { select: { courses: true } } },
      orderBy: { fullName: 'asc' },
    });

    const toKeepCount = await this.prisma.teacher.count({
      where: { sourceId: { in: [...keepSet] } },
    });

    const coursesToUnlink = toDelete.reduce((sum, t) => sum + t._count.courses, 0);

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        toKeepCount,
        toDeleteCount: toDelete.length,
        coursesToUnlink,
        samples: toDelete.slice(0, 30).map((t) => ({
          id: t.id,
          fullName: t.fullName,
          sourceId: t.sourceId,
          courseCount: t._count.courses,
        })),
      };
    }

    let deletedTeachers = 0;
    let unlinkedCourses = 0;

    for (const teacher of toDelete) {
      try {
        const unlinked = await this.prisma.course.updateMany({
          where: { teacherId: teacher.id },
          data: { teacherId: null },
        });
        unlinkedCourses += unlinked.count;
        await this.prisma.outboxMessage.deleteMany({ where: { teacherId: teacher.id } });
        await this.prisma.sampleGroup.deleteMany({ where: { teacherId: teacher.id } });
        await this.prisma.teacher.delete({ where: { id: teacher.id } });
        deletedTeachers++;
      } catch {
        // continuar con el siguiente
      }
    }

    const finalCount = await this.prisma.teacher.count();
    return {
      ok: true,
      dryRun: false,
      deletedTeachers,
      unlinkedCourses,
      finalTeacherCount: finalCount,
    };
  }

  async dedupPreview() {
    const totalTeachers = await this.prisma.teacher.count();

    const teachersWithSourceId = await this.prisma.teacher.findMany({
      where: { sourceId: { not: null } },
      include: { _count: { select: { courses: true } } },
      orderBy: { fullName: 'asc' },
    });

    const bySourceId = new Map<string, typeof teachersWithSourceId>();
    for (const t of teachersWithSourceId) {
      const key = t.sourceId!;
      if (!bySourceId.has(key)) bySourceId.set(key, []);
      bySourceId.get(key)!.push(t);
    }

    const dupGroups = [...bySourceId.values()].filter((g) => g.length > 1);
    const teachersThatWouldBeDeleted = dupGroups.reduce((sum, g) => sum + g.length - 1, 0);

    const orphansCount = await this.prisma.teacher.count({
      where: { courses: { none: {} } },
    });

    return {
      ok: true,
      totalTeachers,
      duplicateGroupCount: dupGroups.length,
      teachersThatWouldBeDeleted,
      orphansWithNoCourses: orphansCount,
      estimatedAfterMerge: totalTeachers - teachersThatWouldBeDeleted,
      groups: dupGroups.slice(0, 100).map((group) => {
        const sorted = [...group].sort((a, b) => b._count.courses - a._count.courses);
        return {
          sourceId: group[0].sourceId,
          keepId: sorted[0].id,
          keepName: sorted[0].fullName,
          count: group.length,
          teachers: sorted.map((t) => ({
            id: t.id,
            fullName: t.fullName,
            sourceId: t.sourceId,
            documentId: t.documentId,
            courseCount: t._count.courses,
          })),
        };
      }),
    };
  }

  async dedupApply(options: { removeOrphans?: boolean } = {}) {
    const teachersWithSourceId = await this.prisma.teacher.findMany({
      where: { sourceId: { not: null } },
      include: { _count: { select: { courses: true } } },
    });

    const bySourceId = new Map<string, typeof teachersWithSourceId>();
    for (const t of teachersWithSourceId) {
      const key = t.sourceId!;
      if (!bySourceId.has(key)) bySourceId.set(key, []);
      bySourceId.get(key)!.push(t);
    }

    let mergedGroups = 0;
    let deletedTeachers = 0;
    let coursesReassigned = 0;
    let orphansDeleted = 0;

    for (const group of bySourceId.values()) {
      if (group.length < 2) continue;

      const sorted = [...group].sort((a, b) => b._count.courses - a._count.courses);
      const keeper = sorted[0];
      const duplicates = sorted.slice(1);

      for (const dup of duplicates) {
        try {
          const reassigned = await this.prisma.course.updateMany({
            where: { teacherId: dup.id },
            data: { teacherId: keeper.id },
          });
          coursesReassigned += reassigned.count;

          await this.prisma.sampleGroup.updateMany({
            where: { teacherId: dup.id },
            data: { teacherId: keeper.id },
          });

          await this.prisma.outboxMessage.deleteMany({ where: { teacherId: dup.id } });

          await this.prisma.teacher.delete({ where: { id: dup.id } });
          deletedTeachers++;
        } catch {
          // Si falla un registro individual, continuar con los demas
        }
      }
      mergedGroups++;
    }

    if (options.removeOrphans) {
      const orphans = await this.prisma.teacher.findMany({
        where: { courses: { none: {} } },
        select: { id: true },
      });
      for (const orphan of orphans) {
        try {
          await this.prisma.outboxMessage.deleteMany({ where: { teacherId: orphan.id } });
          await this.prisma.sampleGroup.deleteMany({ where: { teacherId: orphan.id } });
          await this.prisma.teacher.delete({ where: { id: orphan.id } });
          orphansDeleted++;
        } catch {
          // Continuar si falla
        }
      }
    }

    const finalCount = await this.prisma.teacher.count();
    return {
      ok: true,
      mergedGroups,
      deletedTeachers,
      coursesReassigned,
      orphansDeleted,
      finalTeacherCount: finalCount,
    };
  }

  async deleteOne(id: string) {
    // Desvincula cursos del docente
    const unlinked = await this.prisma.course.updateMany({
      where: { teacherId: id },
      data: { teacherId: null },
    });
    // Elimina outbox messages del docente
    await this.prisma.outboxMessage.deleteMany({ where: { teacherId: id } });
    // Elimina sampleGroups del docente
    await this.prisma.sampleGroup.deleteMany({ where: { teacherId: id } });
    // Elimina el docente
    await this.prisma.teacher.delete({ where: { id } });
    return { ok: true, unlinkedCourses: unlinked.count };
  }

  async deleteAll() {
    // Desvincula todos los cursos primero
    const unlinked = await this.prisma.course.updateMany({
      where: { teacherId: { not: null } },
      data: { teacherId: null },
    });
    // Borra sampleGroups (teacherId es requerido, todos referencian un docente)
    await this.prisma.sampleGroup.deleteMany({});
    // Borra outboxMessages que tengan docente asignado
    await this.prisma.outboxMessage.deleteMany({ where: { NOT: { teacherId: null } } });
    // Elimina todos los docentes
    const deleted = await this.prisma.teacher.deleteMany({});
    return {
      ok: true,
      deletedTeachers: deleted.count,
      unlinkedCourses: unlinked.count,
    };
  }
}
