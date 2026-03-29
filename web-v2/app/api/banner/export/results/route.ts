import { NextRequest, NextResponse } from 'next/server';
import { getAllBannerExportRecords } from '../../../../_lib/banner-runner';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(1, Number(searchParams.get('limit') ?? '500')),
      2000,
    );
    const records = getAllBannerExportRecords(limit);
    return NextResponse.json({
      ok: true,
      total: records.length,
      records,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible leer los resultados Banner.';
    return NextResponse.json({ ok: false, error: message, message }, { status: 500 });
  }
}
