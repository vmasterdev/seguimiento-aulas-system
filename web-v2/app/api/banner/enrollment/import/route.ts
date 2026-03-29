import { NextRequest, NextResponse } from 'next/server';
import { importBannerEnrollmentFromBanner, importBannerEnrollmentFromSystem } from '../../../../_lib/banner-runner';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const periodCode = typeof body.periodCode === 'string' ? body.periodCode : '';
    const periodCodes = Array.isArray(body.periodCodes)
      ? body.periodCodes.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const sourceLabel = typeof body.sourceLabel === 'string' ? body.sourceLabel : undefined;
    const nrcs = Array.isArray(body.nrcs)
      ? body.nrcs.map((value) => String(value).trim()).filter(Boolean)
      : [];

    const result = nrcs.length
      ? await importBannerEnrollmentFromBanner({
          periodCode,
          nrcs,
          sourceLabel,
        })
      : await importBannerEnrollmentFromSystem({
          periodCodes: periodCode ? [periodCode] : periodCodes,
          sourceLabel,
        });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No fue posible consultar matricula Banner e importarla a analitica.';

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
