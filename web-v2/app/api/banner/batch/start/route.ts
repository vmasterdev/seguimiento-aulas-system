import { NextRequest, NextResponse } from 'next/server';
import { startBannerRunFromSystem } from '../../../../_lib/banner-runner';
import type { BannerBatchSource } from '../../../../_lib/banner-batch';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const periodCodes = Array.isArray(body.periodCodes)
      ? body.periodCodes.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const source = String(body.source ?? 'MISSING_TEACHER').trim().toUpperCase() as BannerBatchSource;
    const workers =
      body.workers === undefined || body.workers === null || body.workers === ''
        ? undefined
        : Math.max(1, Number(body.workers));

    const result = await startBannerRunFromSystem({
      periodCodes,
      source,
      queryName: typeof body.queryName === 'string' ? body.queryName : undefined,
      queryId: typeof body.queryId === 'string' ? body.queryId : undefined,
      resume: body.resume === true,
      ...(Number.isFinite(workers) ? { workers } : {}),
    });

    return NextResponse.json({
      ok: true,
      action: 'start-from-db',
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible iniciar el lote Banner desde la base.';
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
