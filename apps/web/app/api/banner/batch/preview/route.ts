import { NextRequest, NextResponse } from 'next/server';
import {
  previewBannerBatchFromSystem,
  type BannerBatchSource,
  type PrepareBannerBatchInput,
} from '../../../../_lib/banner-batch';

export const runtime = 'nodejs';

function asPayload(body: Record<string, unknown>): PrepareBannerBatchInput {
  const periodCodes = Array.isArray(body.periodCodes)
    ? body.periodCodes.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const source = String(body.source ?? 'MISSING_TEACHER').trim().toUpperCase() as BannerBatchSource;
  const limit =
    body.limit === undefined || body.limit === null || body.limit === ''
      ? undefined
      : Math.max(1, Number(body.limit));

  return {
    periodCodes,
    source,
    ...(Number.isFinite(limit) ? { limit } : {}),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await previewBannerBatchFromSystem(asPayload(body)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible previsualizar el lote Banner.';
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
