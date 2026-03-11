import fs from 'node:fs';
import { NextResponse } from 'next/server';
import {
  getBannerExportSummary,
  getBannerProjectRoot,
  getBannerRunnerStatus,
} from '../../../_lib/banner-runner';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const projectRoot = getBannerProjectRoot();
    return NextResponse.json({
      ok: true,
      projectRoot,
      projectRootExists: fs.existsSync(projectRoot),
      runner: getBannerRunnerStatus(),
      exportSummary: getBannerExportSummary(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible cargar el estado de Banner.';
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
