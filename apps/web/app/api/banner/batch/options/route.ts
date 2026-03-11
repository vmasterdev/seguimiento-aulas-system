import { NextResponse } from 'next/server';
import { getBannerBatchOptions } from '../../../../_lib/banner-batch';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await getBannerBatchOptions());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible cargar las opciones del lote Banner.';
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
