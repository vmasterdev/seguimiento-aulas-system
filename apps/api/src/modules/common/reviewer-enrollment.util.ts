function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function readReviewerEnrollment(rawJson: unknown): Record<string, unknown> | null {
  const root = asRecord(rawJson);
  const reviewerEnrollment = asRecord(root.reviewerEnrollment);
  return Object.keys(reviewerEnrollment).length ? reviewerEnrollment : null;
}

export function readReviewerEnrollmentStatus(rawJson: unknown): string | null {
  const reviewerEnrollment = readReviewerEnrollment(rawJson);
  const status = reviewerEnrollment?.status;
  return typeof status === 'string' && status.trim() ? status.trim().toUpperCase() : null;
}

export function isReviewerEnrollmentExcludedFromReview(rawJson: unknown): boolean {
  return readReviewerEnrollmentStatus(rawJson) === 'NO_MATRICULADO';
}
