"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxExportSchema = exports.OutboxGenerateSchema = exports.EvaluationRecalculateSchema = exports.EvaluationScoreSchema = exports.SamplingGenerateSchema = exports.QueueEnqueueSchema = exports.OutboxStatusSchema = exports.ExecutionPolicySchema = exports.EvaluationPhaseSchema = exports.ErrorCodeSchema = exports.MoodleStatusSchema = exports.TemplateSchema = exports.MomentSchema = void 0;
const zod_1 = require("zod");
exports.MomentSchema = zod_1.z.enum(["MD1", "MD2", "1", "INTER", "RM1", "RM2"]);
exports.TemplateSchema = zod_1.z.enum(["VACIO", "CRIBA", "INNOVAME", "D4", "UNKNOWN"]);
exports.MoodleStatusSchema = zod_1.z.enum([
    "PENDIENTE",
    "EN_PROCESO",
    "OK",
    "ERROR_REINTENTABLE",
    "DESCARTADO_NO_EXISTE",
    "REVISAR_MANUAL",
]);
exports.ErrorCodeSchema = zod_1.z.enum(["NO_EXISTE", "SIN_ACCESO", "TIMEOUT", "OTRO"]);
exports.EvaluationPhaseSchema = zod_1.z.enum(["ALISTAMIENTO", "EJECUCION"]);
exports.ExecutionPolicySchema = zod_1.z.enum(["APPLIES", "AUTO_PASS"]);
exports.OutboxStatusSchema = zod_1.z.enum(["DRAFT", "EXPORTED", "SENT_MANUAL"]);
exports.QueueEnqueueSchema = zod_1.z.object({
    periodCode: zod_1.z.string().trim().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(5000).optional(),
    statuses: zod_1.z.array(exports.MoodleStatusSchema).optional(),
});
exports.SamplingGenerateSchema = zod_1.z.object({
    periodCode: zod_1.z.string().trim().min(3),
    seed: zod_1.z.string().trim().min(1).optional(),
});
exports.EvaluationScoreSchema = zod_1.z.object({
    courseId: zod_1.z.string().trim().min(1),
    phase: exports.EvaluationPhaseSchema,
    checklist: zod_1.z.record(zod_1.z.any()).default({}),
});
exports.EvaluationRecalculateSchema = zod_1.z.object({
    periodCode: zod_1.z.string().trim().optional(),
    phase: exports.EvaluationPhaseSchema.optional(),
});
exports.OutboxGenerateSchema = zod_1.z.object({
    periodCode: zod_1.z.string().trim().min(3),
    phase: exports.EvaluationPhaseSchema,
    moment: exports.MomentSchema.optional(),
    audience: zod_1.z.string().trim().default("DOCENTE"),
});
exports.OutboxExportSchema = zod_1.z.object({
    ids: zod_1.z.array(zod_1.z.string().trim().min(1)).optional(),
});
