"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreAlistamiento = scoreAlistamiento;
exports.scoreEjecucion = scoreEjecucion;
const schemas_1 = require("./schemas");
const CRIBA_ITEMS = ["B", "I", "O", "T", "C", "E", "BIB", "FP", "AA"];
function toBool(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value > 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return ["1", "si", "sí", "true", "ok", "x", "cumple"].includes(normalized);
    }
    return false;
}
function scoreAlistamiento(template, checklist) {
    const notes = [];
    const normalizedTemplate = schemas_1.TemplateSchema.safeParse((template ?? "UNKNOWN").toUpperCase()).success
        ? (template ?? "UNKNOWN").toUpperCase()
        : "UNKNOWN";
    if (normalizedTemplate === "VACIO") {
        notes.push("Aula vacia: alistamiento no aplica.");
        return { score: 0, notes };
    }
    const base = (toBool(checklist.plantilla) ? 20 : 0) +
        (toBool(checklist.fp) ? 5 : 0) +
        (toBool(checklist.fn) ? 5 : 0) +
        (toBool(checklist.asis) ? 10 : 0);
    if (normalizedTemplate === "INNOVAME" || normalizedTemplate === "D4") {
        const score = base + (toBool(checklist.aa) ? 10 : 0);
        if (score < 50)
            notes.push("Faltan items de alistamiento para INNOVAME/D4.");
        return { score, notes };
    }
    if (normalizedTemplate === "CRIBA") {
        const unit = 10 / CRIBA_ITEMS.length;
        const cribaScore = CRIBA_ITEMS.reduce((acc, key) => acc + (toBool(checklist[`criba_${key.toLowerCase()}`]) ? unit : 0), 0);
        const score = Number((base + cribaScore).toFixed(2));
        if (score < 50)
            notes.push("Faltan items CRIBA de alistamiento.");
        return { score, notes };
    }
    notes.push("Template desconocida; puntaje parcial calculado.");
    return { score: base, notes };
}
function scoreEjecucion(checklist, options) {
    const notes = [];
    if (options.executionPolicy === "AUTO_PASS") {
        notes.push("Ejecucion auto-pass por politica del periodo.");
        return { score: 50, notes };
    }
    const core = (toBool(checklist.acuerdo) ? 10 : 0) +
        (toBool(checklist.grabaciones) ? 10 : 0) +
        (toBool(checklist.ingresos) ? 10 : 0) +
        (toBool(checklist.calificacion) ? 10 : 0) +
        (toBool(checklist.asistencia) ? 5 : 0);
    const forumWeights = {
        fp: 1.25,
        fd: 1.25,
        fn: 0.5,
        ft: 1.25,
    };
    const achievedForumWeight = Object.entries(forumWeights).reduce((acc, [key, value]) => acc + (toBool(checklist[`foro_${key}`]) ? value : 0), 0);
    const totalForumWeight = Object.values(forumWeights).reduce((acc, item) => acc + item, 0);
    const forumScore = totalForumWeight === 0 ? 0 : (achievedForumWeight / totalForumWeight) * 5;
    const score = Number((core + forumScore).toFixed(2));
    if (score < 50)
        notes.push("Faltan evidencias en ejecucion.");
    return { score, notes };
}
