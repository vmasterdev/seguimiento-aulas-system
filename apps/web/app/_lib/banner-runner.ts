import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCsvRecords } from './banner-csv';
import {
  prepareBannerBatchFromCourseIds,
  prepareBannerBatchFromSystem,
  type StartBannerBatchFromCourseIdsOptions,
  type StartBannerBatchFromSystemOptions,
} from './banner-batch';

const execFileAsync = promisify(execFile);

function resolveBannerRoot() {
  const candidates = [
    process.env.BANNER_PROJECT_ROOT,
    '/mnt/c/Users/Duvan/Documents/banner buscador de docente en nrc',
    '/mnt/c/Users/Duvan/Documents/banner buscador de docente en nrc - BORRAR',
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0] ?? '/mnt/c/Users/Duvan/Documents/banner buscador de docente en nrc';
}

const BANNER_ROOT = resolveBannerRoot();
const SYSTEM_ROOT = path.resolve(process.cwd(), '..', '..');
const LOG_DIR = path.join(SYSTEM_ROOT, 'storage', 'outputs', 'banner-runs');
const BANNER_EXPORTS_DIR = path.join(BANNER_ROOT, 'storage', 'exports');
const WINDOWS_NODE_CANDIDATE = '/mnt/c/Program Files/nodejs/node.exe';

type BannerCommand = 'lookup' | 'batch' | 'retry-errors' | 'export';

type BannerRunnerRun = {
  id: string;
  command: BannerCommand;
  args: string[];
  startedAt: string;
  endedAt?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  exitCode?: number | null;
  pid?: number;
  logPath: string;
};

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

export type BannerRunnerStatus = {
  running: boolean;
  current: BannerRunnerRun | null;
  lastRun: BannerRunnerRun | null;
  logTail: string;
};

export type BannerExportRecord = {
  queryId: string | null;
  nrc: string;
  period: string | null;
  teacherName: string | null;
  teacherId: string | null;
  programName: string | null;
  status: string | null;
  checkedAt: string | null;
  errorMessage: string | null;
};

export type BannerExportSummary = {
  latestFile: string | null;
  modifiedAt: string | null;
  rowCount: number;
  statusCounts: Record<string, number>;
  preview: BannerExportRecord[];
};

let currentRun: BannerRunState | null = null;
let lastRun: BannerRunnerRun | null = null;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function exists(filePath: string) {
  return fs.existsSync(filePath);
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

function readLogTail(logPath?: string, maxChars = 14000) {
  if (!logPath) return '';
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    if (content.length <= maxChars) return content;
    return content.slice(content.length - maxChars);
  } catch {
    return '';
  }
}

function resolveInputPath(rawPath: string) {
  const trimmed = rawPath.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) return trimmed;

  const bannerCandidate = path.resolve(BANNER_ROOT, trimmed);
  if (exists(bannerCandidate)) return bannerCandidate;

  return path.resolve(SYSTEM_ROOT, trimmed);
}

function assertBannerProjectAvailable() {
  if (!exists(BANNER_ROOT)) {
    throw new Error(`No existe el proyecto Banner en: ${BANNER_ROOT}`);
  }

  const cliPath = path.join(BANNER_ROOT, 'src', 'cli.ts');
  if (!exists(cliPath)) {
    throw new Error(`No se encontro src/cli.ts en el proyecto Banner: ${BANNER_ROOT}`);
  }
}

function shouldUseWindowsNode() {
  return BANNER_ROOT.startsWith('/mnt/') && exists(WINDOWS_NODE_CANDIDATE);
}

function resolveNodeExecutable() {
  return shouldUseWindowsNode() ? WINDOWS_NODE_CANDIDATE : 'node';
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
  assertBannerProjectAvailable();

  if (options.command === 'lookup' && !options.nrc.trim()) {
    throw new Error('Debes indicar un NRC para la consulta individual.');
  }

  if (options.command === 'batch') {
    if (!options.input.trim()) {
      throw new Error('Debes indicar un archivo de entrada para el lote.');
    }
    const inputPath = resolveInputPath(options.input);
    if (!exists(inputPath)) {
      throw new Error(`No existe el archivo de entrada: ${inputPath}`);
    }
  }

  if (options.command === 'retry-errors' && !options.queryId.trim()) {
    throw new Error('Debes indicar el Query ID para reintentar errores.');
  }

  if (options.command === 'export' && !options.queryId.trim()) {
    throw new Error('Debes indicar el Query ID para exportar resultados.');
  }
}

function normalizeNrcKey(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  const relevant = digits.length > 5 ? digits.slice(-5) : digits;
  return String(Number(relevant));
}

function pickLatestBannerExportFile() {
  if (!exists(BANNER_EXPORTS_DIR)) return null;

  const files = fs
    .readdirSync(BANNER_EXPORTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
    .map((entry) => path.join(BANNER_EXPORTS_DIR, entry.name))
    .map((filePath) => ({
      filePath,
      stats: fs.statSync(filePath),
    }))
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);

  for (const item of files) {
    try {
      const content = fs.readFileSync(item.filePath, 'utf8');
      const [header] = parseCsvRecords(content);
      if (header && 'query_id' in header) return item.filePath;
    } catch {
      continue;
    }
  }

  return null;
}

export function getBannerExportSummary(): BannerExportSummary {
  const latestFile = pickLatestBannerExportFile();
  if (!latestFile) {
    return {
      latestFile: null,
      modifiedAt: null,
      rowCount: 0,
      statusCounts: {},
      preview: [],
    };
  }

  const content = fs.readFileSync(latestFile, 'utf8');
  const records = parseCsvRecords(content);
  const stats = fs.statSync(latestFile);
  const statusCounts: Record<string, number> = {};
  const previewByNrc: Record<string, BannerExportRecord> = {};

  for (const row of records) {
    const status = String(row.status ?? '').trim() || null;
    if (status) statusCounts[status] = (statusCounts[status] ?? 0) + 1;

    const item: BannerExportRecord = {
      queryId: String(row.query_id ?? '').trim() || null,
      nrc: String(row.nrc ?? '').trim(),
      period: String(row.period ?? '').trim() || null,
      teacherName: String(row.teacher_name ?? '').trim() || null,
      teacherId: String(row.teacher_id ?? '').trim() || null,
      programName: String(row.program_name ?? '').trim() || null,
      status,
      checkedAt: String(row.checked_at ?? '').trim() || null,
      errorMessage: String(row.error_message ?? '').trim() || null,
    };

    const nrcKey = normalizeNrcKey(item.nrc);
    if (nrcKey && !previewByNrc[nrcKey]) {
      previewByNrc[nrcKey] = item;
    }
  }

  const preview = records
    .slice(0, 15)
    .map((row) => previewByNrc[normalizeNrcKey(String(row.nrc ?? ''))])
    .filter((item): item is BannerExportRecord => Boolean(item));

  return {
    latestFile,
    modifiedAt: stats.mtime.toISOString(),
    rowCount: records.length,
    statusCounts,
    preview,
  };
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
  const nodeExecutable = resolveNodeExecutable();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `${stamp}_${options.command}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });

  logStream.write(`[START] ${new Date().toISOString()}\n`);
  logStream.write(`[CWD] ${BANNER_ROOT}\n`);
  logStream.write(`[EXECUTABLE] ${nodeExecutable}\n`);
  logStream.write(`[CMD] ${nodeExecutable} ${args.map((arg) => JSON.stringify(arg)).join(' ')}\n\n`);

  const child = spawn(nodeExecutable, args, {
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

export async function startBannerRunFromSystem(options: StartBannerBatchFromSystemOptions) {
  const prepared = await prepareBannerBatchFromSystem(options);
  const started = startBannerRun({
    command: 'batch',
    input: prepared.inputPath,
    queryName: options.queryName,
    queryId: options.queryId,
    workers: options.workers,
    resume: options.resume,
  });

  return {
    ...started,
    batch: prepared,
  };
}

export async function startBannerRunFromCourseIds(options: StartBannerBatchFromCourseIdsOptions) {
  const prepared = await prepareBannerBatchFromCourseIds(options);
  const started = startBannerRun({
    command: 'batch',
    input: prepared.inputPath,
    queryName: options.queryName,
    queryId: options.queryId,
    workers: options.workers,
    resume: options.resume,
  });

  return {
    ...started,
    batch: prepared,
  };
}

export function cancelBannerRun() {
  if (!currentRun) {
    throw new Error('No hay una ejecucion Banner activa para cancelar.');
  }

  currentRun.cancelRequested = true;
  const killed = currentRun.process.kill();
  return {
    ok: true,
    killed,
    run: publicRun(currentRun),
  };
}

export async function importBannerResultToSystem(inputPath?: string) {
  const summary = getBannerExportSummary();
  const targetPath = inputPath?.trim() ? resolveInputPath(inputPath) : summary.latestFile;

  if (!targetPath || !exists(targetPath)) {
    throw new Error('No existe un archivo Banner disponible para importar.');
  }

  const commandArgs = [
    '-C',
    path.join(SYSTEM_ROOT, 'apps', 'api'),
    'exec',
    'tsx',
    'scripts/import-banner-review.ts',
    targetPath,
  ];

  const { stdout, stderr } = await execFileAsync('pnpm', commandArgs, {
    cwd: SYSTEM_ROOT,
    env: process.env,
    maxBuffer: 1024 * 1024 * 8,
  });

  const output = String(stdout || stderr || '').trim();
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    return {
      ok: true,
      sourceFile: path.basename(targetPath),
      rawOutput: output,
    };
  }
}

export function getBannerProjectRoot() {
  return BANNER_ROOT;
}
