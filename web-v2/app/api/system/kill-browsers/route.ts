import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

const SYSTEM_ROOT = path.resolve(process.cwd(), '..');
const BANNER_RUNNER_ROOT = path.join(SYSTEM_ROOT, 'tools', 'banner-runner');
const EDGE_PROFILE_DIR = path.join(BANNER_RUNNER_ROOT, 'storage', 'auth', 'edge-profile');

async function countAndKill(processName: string): Promise<number> {
  const { stdout } = await execFileAsync('pkill', ['-c', '-f', processName]).catch(() => ({ stdout: '0' }));
  const count = parseInt(stdout.trim(), 10) || 0;
  await execFileAsync('pkill', ['-9', '-f', processName]).catch(() => {});
  return count;
}

function cleanSingletonLocks(): string[] {
  const removed: string[] = [];
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const name of lockFiles) {
    const lockPath = path.join(EDGE_PROFILE_DIR, name);
    if (fs.existsSync(lockPath)) {
      try {
        fs.rmSync(lockPath, { force: true });
        removed.push(name);
      } catch {
        // ignorar si no se puede eliminar
      }
    }
  }
  return removed;
}

export async function POST() {
  try {
    const [edge, chrome, chromium] = await Promise.all([
      countAndKill('msedge'),
      countAndKill('google-chrome'),
      countAndKill('chromium'),
    ]);

    const total = edge + chrome + chromium;
    const removedLocks = cleanSingletonLocks();

    const parts: string[] = [];
    if (total > 0) parts.push(`${total} proceso(s) terminados (Edge: ${edge}, Chrome: ${chrome}, Chromium: ${chromium})`);
    else parts.push('No había procesos de navegador activos');
    if (removedLocks.length > 0) parts.push(`locks eliminados: ${removedLocks.join(', ')}`);
    else parts.push('sin locks pendientes');

    return NextResponse.json({ ok: true, total, removedLocks, message: parts.join(' — ') + '.' });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
