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
  limit: z.coerce.number().int().min(1).max(500).default(120),
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
  campus: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  costCenter: z.string().trim().max(100).optional(),
  coordination: z.string().trim().max(200).optional(),
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

    const teacher = await this.prisma.teacher.upsert({
      where: { id: teacherId },
      create: {
        id: teacherId,
        sourceId: normalizedSourceId || null,
        documentId: normalizedDocumentId || null,
        fullName: body.fullName,
        email: body.email || null,
        campus: body.campus || null,
        region: body.region || null,
        costCenter: normalizedCostCenter,
        coordination: normalizedCoordination,
      },
      update: {
        sourceId: normalizedSourceId || existingByAlt?.sourceId || undefined,
        documentId: normalizedDocumentId || existingByAlt?.documentId || undefined,
        fullName: body.fullName,
        email: body.email || undefined,
        campus: body.campus || undefined,
        region: body.region || undefined,
        costCenter: normalizedCostCenter || undefined,
        coordination: normalizedCoordination || undefined,
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
    const CAMPUS_KEYS = ['sede', 'campus', 'sdoc', 'centro', 'centro_docente'];
    const REGION_KEYS = ['zona', 'region', 'ubicacion', 'ubica'];
    const COST_KEYS = ['centrocosto', 'costcenter'];
    const COORD_KEYS = ['responsable', 'coordination', 'coordinacion'];

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

          await this.prisma.teacher.upsert({
            where: { id: finalId },
            create: {
              id: finalId,
              sourceId: sourceId || null,
              documentId: documentId || null,
              fullName,
              email: pickValue(row, EMAIL_KEYS) || null,
              campus: pickValue(row, CAMPUS_KEYS) || null,
              region: pickValue(row, REGION_KEYS) || null,
              costCenter,
              coordination,
            },
            update: {
              sourceId: sourceId || existing?.sourceId || undefined,
              documentId: documentId || existing?.documentId || undefined,
              fullName,
              email: pickValue(row, EMAIL_KEYS) || undefined,
              campus: pickValue(row, CAMPUS_KEYS) || undefined,
              region: pickValue(row, REGION_KEYS) || undefined,
              costCenter: costCenter || undefined,
              coordination: coordination || undefined,
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
}
