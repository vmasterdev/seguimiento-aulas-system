import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const INTERNAL_API = process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const SYSTEM_ROOT = path.resolve(process.cwd(), '..');
const EXPORTS_DIR = path.join(SYSTEM_ROOT, 'tools', 'banner-runner', 'storage', 'exports');

function readLatestBannerExportIds(): { ids: string[]; csvFile: string } | null {
  if (!fs.existsSync(EXPORTS_DIR)) return null;

  const files = fs
    .readdirSync(EXPORTS_DIR)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(EXPORTS_DIR, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) return null;

  const csvPath = path.join(EXPORTS_DIR, files[0].name);
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split('\n');
  if (!lines.length) return null;

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const teacherIdIdx = headers.indexOf('teacher_id');
  const statusIdx = headers.indexOf('status');

  if (teacherIdIdx === -1 || statusIdx === -1) return null;

  const ids = new Set<string>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    // CSV simple split (teacher_id no contiene comas)
    const cols = line.split(',');
    const status = (cols[statusIdx] ?? '').trim().replace(/^"|"$/g, '');
    const teacherId = (cols[teacherIdIdx] ?? '').trim().replace(/^"|"$/g, '');
    if (status === 'ENCONTRADO' && teacherId) {
      ids.add(teacherId);
    }
  }

  return { ids: [...ids], csvFile: files[0].name };
}

export async function GET() {
  try {
    const result = readLatestBannerExportIds();
    if (!result) {
      return NextResponse.json({ ok: false, message: 'No se encontro el archivo de exportacion de Banner.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, uniqueCount: result.ids.length, csvFile: result.csvFile });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const dryRun = body.dryRun !== false;

    const result = readLatestBannerExportIds();
    if (!result) {
      return NextResponse.json({ ok: false, message: 'No se encontro el archivo de exportacion de Banner.' }, { status: 404 });
    }

    const response = await fetch(`${INTERNAL_API}/teachers/keep-only`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepSourceIds: result.ids, dryRun }),
    });

    const data = await response.json() as Record<string, unknown>;
    return NextResponse.json({ ...data, csvFile: result.csvFile, uniqueTeachersInBatch: result.ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
