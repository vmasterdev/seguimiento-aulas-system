import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { BannerRunnerRun, BannerRunnerStatus } from './types';

const BANNER_ROOT =
  process.env.BANNER_PROJECT_ROOT ?? '/mnt/c/Users/Duvan/Documents/banner buscador de docente en nrc';
const SYSTEM_ROOT = path.resolve(process.cwd(), '..', '..');
const LOG_DIR = path.join(SYSTEM_ROOT, 'storage', 'outputs', 'ops-studio-v2', 'banner-runs');

type BannerCommand = 'lookup' | 'batch' | 'retry-errors' | 'export';

type BannerRunState = BannerRunnerRun & {
  process: ChildProcessWithoutNullStreams;
  cancelRequested: boolean;
};

export type StartBannerOptions =
  | {
      command: 'lookup';
      nrc: string;
      period?: string;
      queryName?: string;
    }
  | {
      command: 'batch';
      input: string;
      period?: string;
      queryName?: string;
      queryId?: string;
      workers?: number;
      resume?: boolean;
    }
  | {
      command: 'retry-errors';
      queryId: string;
      workers?: number;
    }
  | {
      command: 'export';
      queryId: string;
      format?: string;
    };

let currentRun: BannerRunState | null = null;
let lastRun: BannerRunnerRun | null = null;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function publicRun(run: BannerRunnerRun | BannerRunState | null): BannerRunnerRun | null {
  if (!run) return null;
  return {
    id: run.id,
    command: run.command,
    args: run.args,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    exitCode: run.exitCode,
    pid: run.pid,
    logPath: run.logPath,
  };
}

function readLogTail(logPath?: string, maxChars = 14000): string {
  if (!logPath) return '';
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    if (content.length <= maxChars) return content;
    return content.slice(content.length - maxChars);
  } catch {
    return '';
  }
}

function resolveInputPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) return trimmed;

  const bannerCandidate = path.resolve(BANNER_ROOT, trimmed);
  if (fs.existsSync(bannerCandidate)) return bannerCandidate;

  return path.resolve(SYSTEM_ROOT, trimmed);
}

function buildArgs(options: StartBannerOptions): string[] {
  const args = ['--import', 'tsx', 'src/cli.ts', options.command];

  if (options.command === 'lookup') {
    args.push('--nrc', options.nrc.trim());
    if (options.period?.trim()) args.push('--period', options.period.trim());
    if (options.queryName?.trim()) args.push('--query-name', options.queryName.trim());
    return args;
  }

  if (options.command === 'batch') {
    args.push('--input', resolveInputPath(options.input));
    if (options.period?.trim()) args.push('--period', options.period.trim());
    if (options.queryName?.trim()) args.push('--query-name', options.queryName.trim());
    if (options.queryId?.trim()) args.push('--query-id', options.queryId.trim());
    if (options.workers && Number.isFinite(options.workers)) args.push('--workers', String(options.workers));
    if (options.resume) args.push('--resume');
    return args;
  }

  if (options.command === 'retry-errors') {
    args.push('--query-id', options.queryId.trim());
    if (options.workers && Number.isFinite(options.workers)) args.push('--workers', String(options.workers));
    return args;
  }

  args.push('--query-id', options.queryId.trim());
  if (options.format?.trim()) args.push('--format', options.format.trim());
  return args;
}

function validateOptions(options: StartBannerOptions) {
  if (options.command === 'lookup' && !options.nrc.trim()) {
    throw new Error('Debes indicar un NRC para lookup.');
  }

  if (options.command === 'batch') {
    if (!options.input.trim()) throw new Error('Debes indicar un archivo de entrada para batch.');
    const inputPath = resolveInputPath(options.input);
    if (!fs.existsSync(inputPath)) {
      throw new Error(`No existe el archivo de entrada: ${inputPath}`);
    }
  }

  if (options.command === 'retry-errors' && !options.queryId.trim()) {
    throw new Error('Debes indicar queryId para retry-errors.');
  }

  if (options.command === 'export' && !options.queryId.trim()) {
    throw new Error('Debes indicar queryId para export.');
  }
}

export function getBannerRunnerStatus(): BannerRunnerStatus {
  return {
    running: Boolean(currentRun),
    current: publicRun(currentRun),
    lastRun,
    logTail: readLogTail(currentRun?.logPath ?? lastRun?.logPath),
  };
}

export function startBannerRun(options: StartBannerOptions) {
  if (currentRun) {
    throw new Error('Ya existe una ejecucion Banner en curso. Cancela o espera a que termine.');
  }

  validateOptions(options);
  ensureLogDir();

  const args = buildArgs(options);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `${stamp}_${options.command}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });

  logStream.write(`[START] ${new Date().toISOString()}\n`);
  logStream.write(`[CWD] ${BANNER_ROOT}\n`);
  logStream.write(`[CMD] node ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n\n`);

  const child = spawn('node', args, {
    cwd: BANNER_ROOT,
    env: process.env,
    stdio: 'pipe',
  });

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const startedAt = new Date().toISOString();
  currentRun = {
    id: runId,
    command: options.command,
    args,
    startedAt,
    status: 'RUNNING',
    pid: child.pid,
    logPath,
    process: child,
    cancelRequested: false,
  };

  child.stdout.on('data', (chunk) => {
    logStream.write(String(chunk));
  });
  child.stderr.on('data', (chunk) => {
    logStream.write(String(chunk));
  });
  child.on('error', (error) => {
    logStream.write(`\n[PROCESS_ERROR] ${error.message}\n`);
  });
  child.on('close', (code) => {
    const endedAt = new Date().toISOString();
    const cancelled = currentRun?.cancelRequested ?? false;
    const status: BannerRunnerRun['status'] = cancelled ? 'CANCELLED' : code === 0 ? 'COMPLETED' : 'FAILED';

    lastRun = {
      id: runId,
      command: options.command,
      args,
      startedAt,
      endedAt,
      status,
      exitCode: code,
      pid: child.pid,
      logPath,
    };
    currentRun = null;

    logStream.write(`\n[END] ${endedAt}\n`);
    logStream.write(`[STATUS] ${status}\n`);
    logStream.write(`[EXIT_CODE] ${String(code)}\n`);
    logStream.end();
  });

  return {
    ok: true,
    run: publicRun(currentRun),
  };
}

export function cancelBannerRun() {
  if (!currentRun) {
    throw new Error('No hay ejecucion Banner activa para cancelar.');
  }

  currentRun.cancelRequested = true;
  const killed = currentRun.process.kill();
  return {
    ok: true,
    killed,
    run: publicRun(currentRun),
  };
}

export function getBannerProjectRoot() {
  return BANNER_ROOT;
}
