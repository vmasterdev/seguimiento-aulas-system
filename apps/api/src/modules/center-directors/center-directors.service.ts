import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { parseWithSchema } from '../common/zod.util';

const ListQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(120),
  offset: z.coerce.number().int().min(0).default(0),
});

const UpsertSchema = z.object({
  id: z.string().trim().optional(),
  campusCode: z.string().trim().min(1, 'Codigo de centro requerido').max(20),
  campusName: z.string().trim().max(200).optional(),
  fullName: z.string().trim().min(1, 'Nombre requerido').max(200),
  email: z.string().trim().email('Correo invalido'),
  region: z.string().trim().max(100).optional(),
});

const CAMPUS_NAMES: Record<string, string> = {
  IBA: 'Ibague',
  NVA: 'Neiva',
  LER: 'Lerida',
  GAR: 'Garzon',
  PIT: 'Pitalito',
  CTD: 'Chaparral',
  CTP: 'Centro Tutorial Purificacion',
};

@Injectable()
export class CenterDirectorsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(rawQuery: unknown) {
    const query = parseWithSchema(ListQuerySchema, rawQuery, 'center directors query');
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 120;
    const q = query.q?.trim();

    const where = q
      ? {
          OR: [
            { campusCode: { contains: q, mode: 'insensitive' as const } },
            { campusName: { contains: q, mode: 'insensitive' as const } },
            { fullName: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            { region: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const [total, items, allCampuses] = await Promise.all([
      this.prisma.centerDirector.count({ where }),
      this.prisma.centerDirector.findMany({
        where,
        orderBy: [{ campusCode: 'asc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.teacher.findMany({
        select: { campus: true, region: true },
        where: { campus: { not: null } },
        distinct: ['campus'],
      }),
    ]);

    const knownCampuses = allCampuses
      .map((t) => ({ campusCode: t.campus!, region: t.region ?? null }))
      .filter((c) => c.campusCode);

    return {
      ok: true,
      total,
      limit,
      offset,
      items,
      knownCampuses,
      campusNamesMap: CAMPUS_NAMES,
    };
  }

  async upsertOne(payload: unknown) {
    const body = parseWithSchema(UpsertSchema, payload, 'upsert center director payload');
    const campusCode = body.campusCode.trim().toUpperCase();
    if (!campusCode) {
      throw new BadRequestException('Codigo de centro requerido.');
    }
    const email = body.email.trim().toLowerCase();
    const id = body.id?.trim() || undefined;
    const campusName = body.campusName?.trim() || CAMPUS_NAMES[campusCode] || null;

    const existingById = id ? await this.prisma.centerDirector.findUnique({ where: { id } }) : null;
    const existingByCode =
      existingById ?? (await this.prisma.centerDirector.findUnique({ where: { campusCode } }));

    const finalId = existingById?.id ?? existingByCode?.id;

    const director = finalId
      ? await this.prisma.centerDirector.update({
          where: { id: finalId },
          data: {
            campusCode,
            campusName,
            fullName: body.fullName,
            email,
            region: body.region || null,
          },
        })
      : await this.prisma.centerDirector.create({
          data: {
            campusCode,
            campusName,
            fullName: body.fullName,
            email,
            region: body.region || null,
          },
        });

    return { ok: true, director };
  }

  async remove(id: string) {
    const existing = await this.prisma.centerDirector.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Director de centro ${id} no encontrado.`);
    }
    await this.prisma.centerDirector.delete({ where: { id } });
    return { ok: true };
  }
}
