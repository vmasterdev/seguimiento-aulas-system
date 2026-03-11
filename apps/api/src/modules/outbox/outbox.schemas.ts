import { z } from 'zod';

export const OutboxResendUpdatedSchema = z.object({
  id: z.string().trim().min(1),
  forceTo: z.string().trim().email().optional(),
  dryRun: z.coerce.boolean().optional().default(false),
});

export const OutboxResendByCourseSchema = z.object({
  courseId: z.string().trim().min(1),
  phase: z.enum(['ALISTAMIENTO', 'EJECUCION']).default('ALISTAMIENTO'),
  forceTo: z.string().trim().email().optional(),
  dryRun: z.coerce.boolean().optional().default(false),
});

export const OutboxPreviewByCourseSchema = z.object({
  courseId: z.string().trim().min(1),
  phase: z.enum(['ALISTAMIENTO', 'EJECUCION']).default('ALISTAMIENTO'),
});
