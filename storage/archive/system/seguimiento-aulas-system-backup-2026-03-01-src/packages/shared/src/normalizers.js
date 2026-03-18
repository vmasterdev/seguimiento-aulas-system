"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeId = sanitizeId;
exports.normalizeNrc = normalizeNrc;
exports.normalizeMoment = normalizeMoment;
exports.normalizeTemplate = normalizeTemplate;
exports.inferSemesterFromPeriod = inferSemesterFromPeriod;
exports.inferModality = inferModality;
exports.buildDeterministicIndex = buildDeterministicIndex;
exports.normalizeHeader = normalizeHeader;
const node_crypto_1 = require("node:crypto");
const schemas_1 = require("./schemas");
const MODALITY_BY_INDICATIVE = {
    "10": "PP",
    "60": "PP",
    "15": "PD",
    "65": "PD",
};
function normalizeText(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, " ");
}
function sanitizeId(value) {
    return normalizeText(value).replace(/[^\w\-]/g, "");
}
function normalizeNrc(raw, periodCode) {
    const value = normalizeText(raw);
    if (!value)
        return null;
    const periodDigits = normalizeText(periodCode).replace(/[^\d]/g, "").slice(0, 6);
    const periodPrefix = periodDigits.slice(-2);
    const explicit = value.match(/^(\d{2})-(\d+)$/);
    if (explicit) {
        const nrcNum = String(Number(explicit[2]));
        return `${periodPrefix || explicit[1]}-${nrcNum}`;
    }
    const digits = value.replace(/[^\d]/g, "");
    if (!digits)
        return null;
    const nrcNum = String(Number(digits.slice(-5)));
    if (periodPrefix)
        return `${periodPrefix}-${nrcNum}`;
    if (digits.length >= 7) {
        const prefix = digits.slice(0, 2);
        return `${prefix}-${String(Number(digits.slice(2)))}`;
    }
    return nrcNum;
}
function normalizeMoment(raw) {
    const value = normalizeText(raw).toUpperCase().replace(/\s/g, "");
    if (!value)
        return "1";
    if (["MD1", "MOMENTO1", "M1"].includes(value))
        return "MD1";
    if (["MD2", "MOMENTO2", "M2"].includes(value))
        return "MD2";
    if (["INTER", "INTERSEMETRAL"].includes(value))
        return "INTER";
    if (["RM1", "R1"].includes(value))
        return "RM1";
    if (["RM2", "R2"].includes(value))
        return "RM2";
    if (["1", "16", "16SEMANAS"].includes(value))
        return "1";
    return schemas_1.MomentSchema.safeParse(value).success ? value : "1";
}
function normalizeTemplate(raw) {
    const value = normalizeText(raw).toUpperCase();
    if (!value)
        return "UNKNOWN";
    if (value.includes("INNOV"))
        return "INNOVAME";
    if (value.includes("CRIBA"))
        return "CRIBA";
    if (value.includes("VACIO") || value.includes("VACÍO"))
        return "VACIO";
    if (value === "D4" || value.includes("DISTANCIA 4"))
        return "D4";
    return schemas_1.TemplateSchema.safeParse(value).success ? value : "UNKNOWN";
}
function inferSemesterFromPeriod(periodCode) {
    const digits = periodCode.replace(/[^\d]/g, "");
    const suffix = digits.slice(-2);
    if (["10", "15"].includes(suffix))
        return 1;
    if (["60", "65"].includes(suffix))
        return 2;
    if (digits.length >= 6) {
        const month = Number(digits.slice(4, 6));
        if (!Number.isNaN(month) && month <= 6)
            return 1;
    }
    return 2;
}
function inferModality(periodCode, label) {
    const normalizedLabel = normalizeText(label).toUpperCase();
    if (normalizedLabel.includes("PRESENCIAL"))
        return "PP";
    if (normalizedLabel.includes("DISTANCIA"))
        return "PD";
    if (normalizedLabel.includes("POSGRADO"))
        return "POSG";
    const digits = periodCode.replace(/[^\d]/g, "");
    const suffix = digits.slice(-2);
    return MODALITY_BY_INDICATIVE[suffix] ?? "OTRO";
}
function buildDeterministicIndex(seed, values, modulo) {
    const hash = (0, node_crypto_1.createHash)("sha256")
        .update(`${seed}|${values.join("|")}`)
        .digest("hex");
    const int = Number.parseInt(hash.slice(0, 12), 16);
    return modulo > 0 ? int % modulo : 0;
}
function normalizeHeader(header) {
    return normalizeText(header)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
