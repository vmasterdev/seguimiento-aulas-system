import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { normalizeProgramKey } from '@seguimiento/shared';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';
import { normalizeProgramValue } from '../common/program.util';

const CoordinatorsQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(120),
  offset: z.coerce.number().int().min(0).default(0),
});

const UpsertCoordinatorSchema = z.object({
  id: z.string().trim().optional(),
  programId: z.string().trim().min(1, 'Programa requerido').max(200),
  fullName: z.string().trim().min(1, 'Nombre requerido').max(200),
  email: z.string().trim().email('Correo invalido'),
  campus: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  sourceSheet: z.string().trim().max(120).optional(),
});

@Injectable()
export class CoordinatorsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(rawQuery: unknown) {
    const query = parseWithSchema(CoordinatorsQuerySchema, rawQuery, 'coordinators query');
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 120;
    const q = query.q?.trim();

    const where = q
      ? {
          OR: [
            { programId: { contains: q, mode: 'insensitive' as const } },
            { programKey: { contains: q, mode: 'insensitive' as const } },
            { fullName: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { campus: { contains: q, mode: 'insensitive' as const } },
            { region: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const [total, items] = await Promise.all([
      this.prisma.coordinator.count({ where }),
      this.prisma.coordinator.findMany({
        where,
        orderBy: [{ programId: 'asc' }, { fullName: 'asc' }, { email: 'asc' }],
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
    const body = parseWithSchema(UpsertCoordinatorSchema, payload, 'upsert coordinator payload');
    const programId = normalizeProgramValue(body.programId);
    if (!programId) {
      throw new BadRequestException('Programa requerido.');
    }

    const programKey = normalizeProgramKey(programId);
    if (!programKey) {
      throw new BadRequestException('No fue posible normalizar el programa del coordinador.');
    }

    const email = body.email.trim().toLowerCase();
    const coordinatorId = body.id?.trim() || null;

    const existingById = coordinatorId
      ? await this.prisma.coordinator.findUnique({ where: { id: coordinatorId } })
      : null;
    const existingByProgramEmail =
      existingById ??
      (await this.prisma.coordinator.findUnique({
        where: {
          programKey_email: {
            programKey,
            email,
          },
        },
      }));

    const finalId = existingById?.id ?? existingByProgramEmail?.id ?? coordinatorId ?? undefined;

    const coordinator = finalId
      ? await this.prisma.coordinator.upsert({
          where: { id: finalId },
          create: {
            id: finalId,
            programId,
            programKey,
            fullName: body.fullName,
            email,
            campus: body.campus || null,
            region: body.region || null,
            sourceSheet: body.sourceSheet || existingByProgramEmail?.sourceSheet || 'MANUAL',
          },
          update: {
            programId,
            programKey,
            fullName: body.fullName,
            email,
            campus: body.campus || null,
            region: body.region || null,
            sourceSheet: body.sourceSheet || existingByProgramEmail?.sourceSheet || 'MANUAL',
          },
        })
      : await this.prisma.coordinator.create({
          data: {
            programId,
            programKey,
            fullName: body.fullName,
            email,
            campus: body.campus || null,
            region: body.region || null,
            sourceSheet: body.sourceSheet || 'MANUAL',
          },
        });

    return { ok: true, coordinator };
  }
}
