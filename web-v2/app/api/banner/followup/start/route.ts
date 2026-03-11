import { NextRequest, NextResponse } from 'next/server';
import { startBannerRunFromCourseIds } from '../../../../_lib/banner-runner';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const courseIds = Array.isArray(body.courseIds)
      ? body.courseIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const workers =
      body.workers === undefined || body.workers === null || body.workers === ''
        ? undefined
        : Math.max(1, Number(body.workers));

    const result = await startBannerRunFromCourseIds({
      courseIds,
      queryName: typeof body.queryName === 'string' ? body.queryName : undefined,
      queryId: typeof body.queryId === 'string' ? body.queryId : undefined,
      resume: body.resume === true,
      ...(Number.isFinite(workers) ? { workers } : {}),
    });

    return NextResponse.json({
      ok: true,
      action: 'start-followup',
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible iniciar el seguimiento Banner.';
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
