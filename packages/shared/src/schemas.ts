import { z } from "zod";

export const MomentSchema = z.enum(["MD1", "MD2", "1", "INTER", "RM1", "RM2"]);
export const TemplateSchema = z.enum(["VACIO", "CRIBA", "INNOVAME", "D4", "UNKNOWN"]);
export const MoodleStatusSchema = z.enum([
  "PENDIENTE",
  "EN_PROCESO",
  "OK",
  "ERROR_REINTENTABLE",
  "DESCARTADO_NO_EXISTE",
  "REVISAR_MANUAL",
]);
export const ErrorCodeSchema = z.enum(["NO_EXISTE", "SIN_ACCESO", "TIMEOUT", "OTRO"]);
export const EvaluationPhaseSchema = z.enum(["ALISTAMIENTO", "EJECUCION"]);
export const ExecutionPolicySchema = z.enum(["APPLIES", "AUTO_PASS"]);
export const OutboxStatusSchema = z.enum(["DRAFT", "EXPORTED", "SENT_MANUAL", "SENT_AUTO"]);

export const QueueEnqueueSchema = z.object({
  periodCode: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  statuses: z.array(MoodleStatusSchema).optional(),
});

export const SamplingGenerateSchema = z.object({
  periodCode: z.string().trim().min(3),
  seed: z.string().trim().min(1).optional(),
});

export const EvaluationScoreSchema = z.object({
  courseId: z.string().trim().min(1),
  phase: EvaluationPhaseSchema,
  checklist: z.record(z.any()).default({}),
  replicateToGroup: z.coerce.boolean().optional().default(false),
});

export const EvaluationRecalculateSchema = z.object({
  periodCode: z.string().trim().optional(),
  phase: EvaluationPhaseSchema.optional(),
});

export const EvaluationReplicateSchema = z.object({
  periodCode: z.string().trim().min(3),
  phase: EvaluationPhaseSchema,
  moment: MomentSchema.optional(),
});

export const OutboxGenerateSchema = z.object({
  periodCode: z.string().trim().min(3),
  periodCodes: z.array(z.string().trim().min(3)).min(1).max(24).optional(),
  phase: EvaluationPhaseSchema,
  moment: MomentSchema.optional(),
  moments: z.array(MomentSchema).min(1).max(6).optional(),
  audience: z.enum(["DOCENTE", "COORDINADOR", "GLOBAL"]).default("DOCENTE"),
  recipientName: z.string().trim().min(1).max(160).optional(),
  recipientEmails: z.array(z.string().trim().email()).min(1).max(20).optional(),
});

export const OutboxExportSchema = z.object({
  ids: z.array(z.string().trim().min(1)).optional(),
});

export const OutboxSendSchema = z.object({
  ids: z.array(z.string().trim().min(1)).optional(),
  periodCode: z.string().trim().min(3).optional(),
  periodCodes: z.array(z.string().trim().min(3)).min(1).max(24).optional(),
  phase: EvaluationPhaseSchema.optional(),
  moment: MomentSchema.optional(),
  moments: z.array(MomentSchema).min(1).max(6).optional(),
  audience: z.enum(["DOCENTE", "COORDINADOR", "GLOBAL"]).optional(),
  status: OutboxStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  forceTo: z.string().trim().email().optional(),
  dryRun: z.coerce.boolean().optional().default(false),
});
