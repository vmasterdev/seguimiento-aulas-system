"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCourseDate = parseCourseDate;
exports.buildCourseScheduleInfo = buildCourseScheduleInfo;
exports.formatCourseWindowLabel = formatCourseWindowLabel;
exports.buildExecutionExpectations = buildExecutionExpectations;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_INDEX = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
};
function toUtcDate(year, monthIndex, day) {
    const value = new Date(Date.UTC(year, monthIndex, day));
    if (Number.isNaN(value.getTime()) ||
        value.getUTCFullYear() !== year ||
        value.getUTCMonth() !== monthIndex ||
        value.getUTCDate() !== day) {
        return null;
    }
    return value;
}
function parseSlashDate(value, monthFirst) {
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!match)
        return null;
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const month = monthFirst ? first - 1 : second - 1;
    const day = monthFirst ? second : first;
    return toUtcDate(year, month, day);
}
function toDateOnly(value) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
function toIsoDate(value) {
    return value ? value.toISOString().slice(0, 10) : null;
}
function pluralize(value, singular, plural = `${singular}s`) {
    return `${value} ${value === 1 ? singular : plural}`;
}
function parseCourseDateCandidates(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized)
        return [];
    const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        const parsed = toUtcDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
        return parsed ? [parsed] : [];
    }
    const bannerMatch = normalized.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (bannerMatch) {
        const monthIndex = MONTH_INDEX[bannerMatch[2].toLowerCase()];
        if (monthIndex === undefined)
            return [];
        const parsed = toUtcDate(Number(bannerMatch[3]), monthIndex, Number(bannerMatch[1]));
        return parsed ? [parsed] : [];
    }
    // RPACA slash dates llegan en formato month/day/year. Dejamos la variante day/month
    // solo como fallback defensivo si el valor no cuadra con month/day.
    const candidates = [parseSlashDate(normalized, true), parseSlashDate(normalized, false)].filter((item) => item !== null);
    const seen = new Set();
    const unique = [];
    for (const candidate of candidates) {
        const stamp = candidate.getTime();
        if (seen.has(stamp))
            continue;
        seen.add(stamp);
        unique.push(candidate);
    }
    return unique;
}
function parseCourseDate(value) {
    return parseCourseDateCandidates(value)[0] ?? null;
}
function resolveCourseDateRange(input) {
    const startCandidates = parseCourseDateCandidates(input.startDate);
    const endCandidates = parseCourseDateCandidates(input.endDate);
    let best = null;
    for (const start of startCandidates) {
        for (const end of endCandidates) {
            if (end.getTime() < start.getTime())
                continue;
            const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
            if (!best || totalDays < best.totalDays) {
                best = { start, end, totalDays };
            }
        }
    }
    if (best) {
        return { start: best.start, end: best.end };
    }
    return {
        start: startCandidates[0] ?? null,
        end: endCandidates[0] ?? null,
    };
}
function buildCourseScheduleInfo(input) {
    const { start, end } = resolveCourseDateRange(input);
    if (!start || !end || end.getTime() < start.getTime()) {
        return {
            startDate: input.startDate?.trim() || null,
            endDate: input.endDate?.trim() || null,
            startIsoDate: toIsoDate(start),
            endIsoDate: toIsoDate(end),
            totalDays: null,
            totalWeeks: null,
            isShortCourse: false,
            requiredLoginCount: null,
            calendarState: "UNKNOWN",
            progressPercent: null,
        };
    }
    const totalDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
    const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
    const requiredLoginCount = totalWeeks * 3;
    const today = toDateOnly(input.now ? new Date(input.now) : new Date());
    let calendarState = "ACTIVE";
    let progressPercent = 0;
    if (today.getTime() < start.getTime()) {
        calendarState = "UPCOMING";
        progressPercent = 0;
    }
    else if (today.getTime() > end.getTime()) {
        calendarState = "ENDED";
        progressPercent = 100;
    }
    else {
        calendarState = "ACTIVE";
        const elapsedDays = Math.floor((today.getTime() - start.getTime()) / DAY_MS) + 1;
        progressPercent = Number(((elapsedDays / totalDays) * 100).toFixed(2));
    }
    return {
        startDate: input.startDate?.trim() || null,
        endDate: input.endDate?.trim() || null,
        startIsoDate: toIsoDate(start),
        endIsoDate: toIsoDate(end),
        totalDays,
        totalWeeks,
        isShortCourse: totalDays <= 28,
        requiredLoginCount,
        calendarState,
        progressPercent,
    };
}
function formatCourseWindowLabel(schedule) {
    if (!schedule.startDate || !schedule.endDate)
        return null;
    const metrics = [];
    if (typeof schedule.totalDays === "number")
        metrics.push(pluralize(schedule.totalDays, "dia"));
    if (typeof schedule.totalWeeks === "number")
        metrics.push(pluralize(schedule.totalWeeks, "semana"));
    const suffix = metrics.length ? ` (${metrics.join(" / ")})` : "";
    return `${schedule.startDate} -> ${schedule.endDate}${suffix}`;
}
function buildExecutionExpectations(schedule) {
    if (!schedule.isShortCourse) {
        return {
            requiredForumMode: "STANDARD",
            ingresosLabel: "Ingresos (3 por semana)",
            reviewHint: null,
            shortCourseHint: null,
        };
    }
    const metrics = [];
    if (typeof schedule.totalDays === "number")
        metrics.push(pluralize(schedule.totalDays, "dia"));
    if (typeof schedule.totalWeeks === "number")
        metrics.push(pluralize(schedule.totalWeeks, "semana"));
    const durationLabel = metrics.length ? ` (${metrics.join(" / ")})` : "";
    const requiredLoginCount = schedule.requiredLoginCount ?? 3;
    return {
        requiredForumMode: "SHORT",
        ingresosLabel: `Ingresos (minimo ${requiredLoginCount} en total)`,
        reviewHint: `Curso corto detectado${durationLabel}. Revisalo por la ventana real del NRC, no como curso regular de 8 semanas.`,
        shortCourseHint: `Para ejecucion se esperan al menos ${requiredLoginCount} ingresos en total, foro de presentacion, foro de novedades y al menos uno entre foro de dialogo o foro tematico.`,
    };
}
