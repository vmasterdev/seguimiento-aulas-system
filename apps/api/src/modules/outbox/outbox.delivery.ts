import { BadRequestException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { parseEnvBoolean } from './outbox.utils';

export type DeliveryMode = 'SMTP' | 'OUTLOOK';

export function createSmtpTransport() {
  const host = process.env.OUTBOX_SMTP_HOST?.trim();
  if (!host) {
    throw new BadRequestException(
      'Falta OUTBOX_SMTP_HOST. Configura SMTP antes de usar /outbox/send.',
    );
  }

  const portRaw = process.env.OUTBOX_SMTP_PORT?.trim() || '25';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new BadRequestException(`OUTBOX_SMTP_PORT invalido: "${portRaw}".`);
  }

  const secure = parseEnvBoolean(process.env.OUTBOX_SMTP_SECURE, false);
  const ignoreTLS = parseEnvBoolean(process.env.OUTBOX_SMTP_IGNORE_TLS, false);
  const rejectUnauthorized = parseEnvBoolean(process.env.OUTBOX_SMTP_REJECT_UNAUTHORIZED, false);
  const user = process.env.OUTBOX_SMTP_USER?.trim();
  const pass = process.env.OUTBOX_SMTP_PASS ?? '';
  const requireAuth = parseEnvBoolean(process.env.OUTBOX_SMTP_REQUIRE_AUTH, !!user);

  if (requireAuth && !user) {
    throw new BadRequestException(
      'OUTBOX_SMTP_REQUIRE_AUTH=true requiere OUTBOX_SMTP_USER y OUTBOX_SMTP_PASS.',
    );
  }

  const from = process.env.OUTBOX_SMTP_FROM?.trim();
  if (!from) {
    throw new BadRequestException(
      'Falta OUTBOX_SMTP_FROM. Ejemplo: "Campus Virtual <campus.virtual@uniminuto.edu>".',
    );
  }

  const replyTo = process.env.OUTBOX_SMTP_REPLY_TO?.trim() || undefined;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ignoreTLS,
    auth: requireAuth ? { user, pass } : undefined,
    tls: {
      rejectUnauthorized,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  return {
    transporter,
    from,
    replyTo,
  };
}

export function resolveDeliveryMode(): DeliveryMode {
  const raw = (process.env.OUTBOX_DELIVERY_MODE ?? 'SMTP').trim().toUpperCase();
  if (raw === 'SMTP' || raw === 'OUTLOOK') return raw;
  throw new BadRequestException(
    `OUTBOX_DELIVERY_MODE invalido: "${raw}". Usa "SMTP" o "OUTLOOK".`,
  );
}

export function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function normalizeFingerprintToken(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function buildSendFingerprint(input: {
  to: string;
  audience: string;
  periodCode: string;
  phase: string;
  moment: string;
  recipientName: string;
  scopeKey?: string | null;
}): string {
  return [
    normalizeFingerprintToken(input.to),
    normalizeFingerprintToken(input.audience),
    normalizeFingerprintToken(input.periodCode),
    normalizeFingerprintToken(input.phase),
    normalizeFingerprintToken(input.moment),
    normalizeFingerprintToken(input.recipientName),
    normalizeFingerprintToken(input.scopeKey),
  ].join('|');
}
