import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { normalizeTemplate, scoreAlistamiento } from '@seguimiento/shared';

type ChecklistPrimitive = string | number | boolean | null;
type Checklist = Record<string, ChecklistPrimitive>;

const DEPRECATED_CRIBA_KEYS = ['criba_it', 'criba_r', 'criba_exa', 'criba_s'] as const;

function toBool(value: ChecklistPrimitive | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'si', 'sí', 'true', 'ok', 'x', 'cumple'].includes(normalized);
  }
  return false;
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

function stripDeprecatedCribaKeys(checklist: Checklist): { checklist: Checklist; removedKeys: string[] } {
  const next: Checklist = { ...checklist };
  const removedKeys: string[] = [];

  for (const key of DEPRECATED_CRIBA_KEYS) {
    if (key in next) {
      delete next[key];
      removedKeys.push(key);
    }
  }

  return { checklist: next, removedKeys };
}

function buildCribaObservations(checklist: Checklist): string {
  const missing: string[] = [];
  if (!toBool(checklist.plantilla)) missing.push('Cargue de plantilla');
  if (!toBool(checklist.fp)) missing.push('Foro presentacion');
  if (!toBool(checklist.fn)) missing.push('Foro novedades');
  if (!(toBool(checklist.asistencia) || toBool(checklist.asis))) missing.push('Asistencia');
  return missing.length ? `Pendiente: ${missing.join(', ')}` : '';
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const courses = await prisma.course.findMany({
      include: {
        moodleCheck: true,
        evaluations: {
          where: {
            phase: 'ALISTAMIENTO',
          },
        },
      },
    });

    let evaluatedCourses = 0;
    let updatedEvaluations = 0;
    let scoreChanged = 0;
    let cleanedChecklists = 0;

    for (const course of courses) {
      const template = normalizeTemplate(course.moodleCheck?.detectedTemplate ?? course.templateDeclared ?? 'UNKNOWN');
      if (template !== 'CRIBA') continue;

      const evaluation = course.evaluations[0];
      if (!evaluation) continue;
      evaluatedCourses += 1;

      const checklist = toChecklist(evaluation.checklist);
      const { checklist: sanitizedChecklist, removedKeys } = stripDeprecatedCribaKeys(checklist);
      const result = scoreAlistamiento(template, sanitizedChecklist);
      const observations = buildCribaObservations(sanitizedChecklist);

      if (removedKeys.length) cleanedChecklists += 1;
      if (Number(evaluation.score) !== result.score) scoreChanged += 1;

      await prisma.evaluation.update({
        where: { id: evaluation.id },
        data: {
          checklist: sanitizedChecklist as Prisma.InputJsonObject,
          score: result.score,
          observations,
          computedAt: new Date(),
        },
      });

      updatedEvaluations += 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          evaluatedCourses,
          updatedEvaluations,
          scoreChanged,
          cleanedChecklists,
          removedKeys: [...DEPRECATED_CRIBA_KEYS],
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
