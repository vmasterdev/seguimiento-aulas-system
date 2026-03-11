import { SUPPORTED_MOMENTS, type SupportedMoment } from './outbox.constants';

export function sanitizeForFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

export function toEml(payload: { to: string; cc?: string; subject: string; html: string }) {
  const headers = [
    `To: ${payload.to}`,
    payload.cc ? `Cc: ${payload.cc}` : null,
    `Subject: ${payload.subject.replace(/[\r\n]+/g, ' ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  return `${headers}\n${payload.html}`;
}

export function parseEnvBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'si', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMomentLabel(value: string): string {
  const normalized = (value || '').trim().toUpperCase();
  if (normalized === 'MD1') return 'M1';
  if (normalized === 'MD2') return 'M2';
  if (normalized === '1') return 'RYC';
  return value || '-';
}

export function isSupportedMoment(value: string | null | undefined): value is SupportedMoment {
  return Boolean(value) && SUPPORTED_MOMENTS.includes(value as SupportedMoment);
}

export function normalizeMomentList(
  moment?: SupportedMoment,
  moments?: SupportedMoment[],
): SupportedMoment[] {
  const seen = new Set<SupportedMoment>();
  const selected: SupportedMoment[] = [];
  for (const value of [moment, ...(moments ?? [])]) {
    if (!value || !SUPPORTED_MOMENTS.includes(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    selected.push(value);
  }
  return selected;
}

export function normalizeRecipientEmails(input: string[] | undefined): string[] {
  if (!input?.length) return [];
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const raw of input) {
    const normalized = raw.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(normalized);
  }
  return emails;
}

export function normalizePeriodCodeList(periodCode?: string, periodCodes?: string[]): string[] {
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const value of [periodCode, ...(periodCodes ?? [])]) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    selected.push(normalized);
  }
  return selected;
}

export function parseStoredRecipientEmails(value?: string | null): string[] {
  if (!value) return [];
  return normalizeRecipientEmails(value.split(/[\n,;]+/));
}
