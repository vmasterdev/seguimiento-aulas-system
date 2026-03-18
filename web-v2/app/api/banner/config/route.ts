import { NextRequest, NextResponse } from 'next/server';
import { getBannerProjectConfig, setBannerProjectRoot } from '../../../_lib/banner-runner';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      ...getBannerProjectConfig(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible cargar la configuracion de Banner.';
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const projectRoot = typeof body.projectRoot === 'string' ? body.projectRoot : '';
    return NextResponse.json({
      ok: true,
      ...setBannerProjectRoot(projectRoot),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible guardar la ruta de Banner.';
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
