import { NextRequest, NextResponse } from 'next/server';
import {
  cancelBannerRun,
  importBannerResultToSystem,
  startBannerRun,
  type StartBannerOptions,
} from '../../../_lib/banner-runner';

type ActionBody = {
  action?: 'start' | 'cancel' | 'import';
  payload?: Record<string, unknown>;
};

export const runtime = 'nodejs';

function asStartPayload(payload: Record<string, unknown>): StartBannerOptions {
  return payload as unknown as StartBannerOptions;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ActionBody;
    const action = body.action;
    const payload = body.payload ?? {};

    if (!action) {
      return NextResponse.json({ ok: false, error: 'Debes indicar una accion.', message: 'Debes indicar una accion.' }, { status: 400 });
    }

    let result: unknown;

    if (action === 'start') {
      result = startBannerRun(asStartPayload(payload));
    } else if (action === 'cancel') {
      result = cancelBannerRun();
    } else if (action === 'import') {
      const inputPath = typeof payload.inputPath === 'string' ? payload.inputPath : undefined;
      result = await importBannerResultToSystem(inputPath);
    } else {
      const message = `Accion no soportada: ${String(action)}`;
      return NextResponse.json({ ok: false, error: message, message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      action,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fallo ejecutando accion Banner.';
    return NextResponse.json(
      {
        ok: false,
        error: message,
        message,
      },
      { status: 500 },
    );
  }
}
