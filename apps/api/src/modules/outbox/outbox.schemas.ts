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

export const OutboxWorkshopInvitationPrepareSchema = z.object({
  periodCode: z.string().trim().min(3),
  phase: z.enum(['ALISTAMIENTO', 'EJECUCION']).default('ALISTAMIENTO'),
  moments: z.array(z.enum(['MD1', 'MD2', '1', 'INTER', 'RM1', 'RM2'])).min(1).max(6).default(['MD1', '1']),
  scoreBands: z.array(z.enum(['ACEPTABLE', 'INSATISFACTORIO'])).min(1).max(2).default(['ACEPTABLE', 'INSATISFACTORIO']),
  sessionTitle: z.string().trim().min(5).max(200),
  sessionDateLabel: z.string().trim().min(5).max(120),
  sessionTimeLabel: z.string().trim().min(3).max(120),
  meetingUrl: z.string().trim().url(),
  introNote: z.string().trim().min(10).max(2000).optional(),
});
