function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function readBannerReview(rawJson: unknown): Record<string, unknown> | null {
  const root = asRecord(rawJson);
  const bannerReview = asRecord(root.bannerReview);
  return Object.keys(bannerReview).length ? bannerReview : null;
}

export function readBannerReviewStatus(rawJson: unknown): string | null {
  const bannerReview = readBannerReview(rawJson);
  const status = bannerReview?.status;
  return typeof status === 'string' && status.trim() ? status.trim().toUpperCase() : null;
}

export function isBannerExcludedFromReview(rawJson: unknown): boolean {
  return readBannerReviewStatus(rawJson) === 'SIN_DOCENTE';
}
