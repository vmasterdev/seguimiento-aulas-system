import { NextResponse } from 'next/server';
import { getOpsData } from '../../lib/ops-data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const data = await getOpsData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'No fue posible construir el dashboard operativo.',
      },
      { status: 500 },
    );
  }
}
