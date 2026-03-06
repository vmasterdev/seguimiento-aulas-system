import { normalizeTemplate } from '@seguimiento/shared';
import { isBannerExcludedFromReview } from './banner-review.util';
import { isReviewerEnrollmentExcludedFromReview } from './reviewer-enrollment.util';

type MoodleReviewState = {
  status?: string | null;
  detectedTemplate?: string | null;
  errorCode?: string | null;
  moodleCourseUrl?: string | null;
  moodleCourseId?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

export function readEnrolledCount(rawJson: unknown): number | null {
  const root = asRecord(rawJson);
  const row = asRecord(root.row);
  const value = String(row.inscritos ?? row.inscrito ?? row.matriculados ?? '').trim();
  if (!value) return null;

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function isVacioWithStudents(input: { rawJson: unknown; template: string | null | undefined }): boolean {
  if (normalizeTemplate(input.template ?? 'UNKNOWN') !== 'VACIO') return false;
  const enrolledCount = readEnrolledCount(input.rawJson);
  return enrolledCount !== null && enrolledCount > 0;
}

export function isVacioWithoutStudents(input: { rawJson: unknown; template: string | null | undefined }): boolean {
  if (normalizeTemplate(input.template ?? 'UNKNOWN') !== 'VACIO') return false;
  const enrolledCount = readEnrolledCount(input.rawJson);
  return enrolledCount === 0;
}

export function isOpcionGradoOrPractica(rawJson: unknown): boolean {
  const root = asRecord(rawJson);
  const row = asRecord(root.row);
  const subject = normalizeText(
    String(row.titulo ?? row.subject_name ?? row.asignatura ?? row.materia ?? row.subject ?? '').trim(),
  );
  if (!subject) return false;

  return (
    subject.includes('OPCION DE GRADO') ||
    subject.includes('OPCION GRADO') ||
    subject.includes('PRACTICA') ||
    subject.includes('PRACTICAS')
  );
}

function isFinalCourseUrl(url: string | null | undefined): boolean {
  return /\/course\/view\.php\?id=\d+/.test(String(url ?? ''));
}

function isManuallyExcluded(rawJson: unknown): boolean {
  const root = asRecord(rawJson);
  const manualExclusion = asRecord(root.manualExclusion);
  return manualExclusion.active === true;
}

export function isMoodleExcludedFromReview(moodleCheck?: MoodleReviewState | null): boolean {
  if (!moodleCheck) return false;

  if (moodleCheck.status === 'DESCARTADO_NO_EXISTE') return true;
  if (moodleCheck.errorCode === 'SIN_ACCESO' || moodleCheck.errorCode === 'NO_EXISTE') return true;

  if (moodleCheck.status !== 'REVISAR_MANUAL') return false;

  const hasCourseId = Boolean(String(moodleCheck.moodleCourseId ?? '').trim());
  const hasFinalUrl = isFinalCourseUrl(moodleCheck.moodleCourseUrl);
  return !hasCourseId && !hasFinalUrl;
}

export function getCourseReviewExclusionReason(input: {
  rawJson: unknown;
  template: string | null | undefined;
  moodleCheck?: MoodleReviewState | null;
}): string | null {
  if (isManuallyExcluded(input.rawJson)) return 'EXCLUIDO_MANUAL';
  if (isBannerExcludedFromReview(input.rawJson)) return 'BANNER';
  if (isReviewerEnrollmentExcludedFromReview(input.rawJson)) return 'NO_MATRICULADO';
  if (isOpcionGradoOrPractica(input.rawJson)) return 'OPCION_GRADO_PRACTICA';
  if (isVacioWithoutStudents(input)) return 'VACIO_SIN_ESTUDIANTES';
  if (isMoodleExcludedFromReview(input.moodleCheck)) return 'MOODLE_SIN_ACCESO';
  return null;
}

export function isCourseExcludedFromReview(input: {
  rawJson: unknown;
  template: string | null | undefined;
  moodleCheck?: MoodleReviewState | null;
}): boolean {
  return Boolean(getCourseReviewExclusionReason(input));
}
