import { TemplateSchema } from "./schemas";
import { buildCourseScheduleInfo } from "./course-schedule";

export type TemplateType = ReturnType<typeof TemplateSchema.parse>;

type BooleanRecord = Record<string, boolean | number | string | null | undefined>;

export type ScoreResult = {
  score: number;
  notes: string[];
};

const CRIBA_ITEMS = ["B", "I", "O", "T", "C", "E", "BIB", "FP", "AA"];

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "si", "sí", "true", "ok", "x", "cumple"].includes(normalized);
  }
  return false;
}

export function scoreAlistamiento(template: string | null | undefined, checklist: BooleanRecord): ScoreResult {
  const notes: string[] = [];
  const normalizedTemplate = TemplateSchema.safeParse((template ?? "UNKNOWN").toUpperCase()).success
    ? (template ?? "UNKNOWN").toUpperCase()
    : "UNKNOWN";

  if (normalizedTemplate === "VACIO") {
    notes.push("Aula vacia: alistamiento no aplica.");
    return { score: 0, notes };
  }

  // Modo manual simplificado para INNOVAME/D4:
  // 1) plantilla 20
  // 2) asistencia 10
  // 3) presentacion 10 (o FP+FN = 5+5)
  // 4) actualizacion de actividades 10
  if (normalizedTemplate === "INNOVAME" || normalizedTemplate === "D4") {
    const presentacionOk = toBool(checklist.presentacion) || (toBool(checklist.fp) && toBool(checklist.fn));
    const score =
      (toBool(checklist.plantilla) ? 20 : 0) +
      (toBool(checklist.asistencia ?? checklist.asis) ? 10 : 0) +
      (presentacionOk ? 10 : 0) +
      (toBool(checklist.actualizacion_actividades ?? checklist.aa) ? 10 : 0);

    if (score < 50) notes.push("Faltan items de alistamiento (modo manual).");
    return { score, notes };
  }

  // Modo CRIBA vigente:
  // plantilla 20 + FP 5 + FN 5 + asistencia 10 + componentes CRIBA (10 distribuidos en 9 items activos)
  if (normalizedTemplate === "CRIBA") {
    const base =
      (toBool(checklist.plantilla) ? 20 : 0) +
      (toBool(checklist.fp) ? 5 : 0) +
      (toBool(checklist.fn) ? 5 : 0) +
      (toBool(checklist.asistencia ?? checklist.asis) ? 10 : 0);
    const unit = 10 / CRIBA_ITEMS.length;
    const cribaScore = CRIBA_ITEMS.reduce((acc, key) => acc + (toBool(checklist[`criba_${key.toLowerCase()}`]) ? unit : 0), 0);
    const score = Number((base + cribaScore).toFixed(2));
    if (score < 50) notes.push("Faltan items CRIBA de alistamiento.");
    return { score, notes };
  }

  notes.push("Template desconocida; puntaje parcial calculado.");
  return { score: 0, notes };
}

export function scoreEjecucion(
  checklist: BooleanRecord,
  options: {
    executionPolicy: "APPLIES" | "AUTO_PASS";
    bannerStartDate?: string | null;
    bannerEndDate?: string | null;
  },
): ScoreResult {
  const notes: string[] = [];
  if (options.executionPolicy === "AUTO_PASS") {
    notes.push("Ejecucion auto-pass por politica del periodo.");
    return { score: 50, notes };
  }

  const schedule = buildCourseScheduleInfo({
    startDate: options.bannerStartDate,
    endDate: options.bannerEndDate,
  });

  // ingresos acepta valor numerico (0-100 = tasa de cumplimiento) para puntuacion proporcional
  const ingresosRaw = checklist.ingresos;
  const ingresosScore =
    typeof ingresosRaw === "number"
      ? Number(((Math.max(0, Math.min(100, ingresosRaw)) / 100) * 10).toFixed(2))
      : toBool(ingresosRaw) ? 10 : 0;

  const core =
    (toBool(checklist.acuerdo) ? 10 : 0) +
    (toBool(checklist.grabaciones) ? 10 : 0) +
    ingresosScore +
    (toBool(checklist.calificacion) ? 10 : 0) +
    (toBool(checklist.asistencia) ? 5 : 0);

  const forumScore = schedule.isShortCourse
    ? (toBool(checklist.foro_fp) ? 4 : 0) +
      (toBool(checklist.foro_fn) ? 1 : 0)
    : (() => {
        const forumWeights = {
          fp: 1.25,
          fn: 0.5,
        };

        const achievedForumWeight = Object.entries(forumWeights).reduce(
          (acc, [key, value]) => acc + (toBool(checklist[`foro_${key}`]) ? value : 0),
          0,
        );
        const totalForumWeight = Object.values(forumWeights).reduce((acc, item) => acc + item, 0);
        return totalForumWeight === 0 ? 0 : (achievedForumWeight / totalForumWeight) * 5;
      })();

  const score = Number((core + forumScore).toFixed(2));
  if (schedule.isShortCourse) {
    notes.push("Curso corto: la ejecucion se ajusto a la duracion real del NRC.");
  }
  if (score < 50) notes.push("Faltan evidencias en ejecucion.");
  return { score, notes };
}
