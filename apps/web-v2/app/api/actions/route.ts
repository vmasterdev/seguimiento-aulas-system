import { NextRequest, NextResponse } from 'next/server';
import { cancelBannerRun, startBannerRun } from '../../lib/banner-runner';

const API_BASE =
  process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';

type ActionBody = {
  action?: string;
  payload?: Record<string, unknown>;
};

async function proxyApi(path: string, payload?: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(payload ?? {}),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const message =
      typeof parsed === 'string'
        ? parsed
        : typeof (parsed as { message?: unknown })?.message === 'string'
          ? String((parsed as { message?: string }).message)
          : `Error HTTP ${response.status}`;
    throw new Error(message);
  }

  return parsed;
}

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ActionBody;
    const action = String(body.action ?? '').trim();
    const payload = body.payload ?? {};

    if (!action) {
      return NextResponse.json({ ok: false, error: 'Accion no enviada.' }, { status: 400 });
    }

    let result: unknown;

    switch (action) {
      case 'queue.enqueue':
        result = await proxyApi('/queue/enqueue-classify', payload);
        break;
      case 'queue.retry':
        result = await proxyApi('/queue/retry', payload);
        break;
      case 'sampling.generate':
        result = await proxyApi('/sampling/generate', payload);
        break;
      case 'sidecar.start':
        result = await proxyApi('/integrations/moodle-sidecar/run/start', payload);
        break;
      case 'sidecar.cancel':
        result = await proxyApi('/integrations/moodle-sidecar/run/cancel', {});
        break;
      case 'sidecar.import':
        result = await proxyApi('/integrations/moodle-sidecar/import', payload);
        break;
      case 'banner.start':
        result = startBannerRun(payload as Parameters<typeof startBannerRun>[0]);
        break;
      case 'banner.cancel':
        result = cancelBannerRun();
        break;
      default:
        return NextResponse.json(
          {
            ok: false,
            error: `Accion no soportada: ${action}`,
          },
          { status: 400 },
        );
    }

    return NextResponse.json({
      ok: true,
      action,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Fallo ejecutando accion.',
      },
      { status: 500 },
    );
  }
}
