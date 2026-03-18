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
const SYSTEM_ROOT = path.resolve(process.cwd(), '..');
const LOG_DIR = path.join(SYSTEM_ROOT, 'storage', 'outputs', 'banner-runs');
const BANNER_CONFIG_DIR = path.join(SYSTEM_ROOT, 'storage', 'runtime', 'banner');
const BANNER_CONFIG_FILE = path.join(BANNER_CONFIG_DIR, 'runner-config.json');
const DEV_STACK_ENV_FILE = path.join(SYSTEM_ROOT, 'storage', 'runtime', 'dev-stack', 'stack.env');
const API_SHADOW_RUN_DIR = process.env.API_LINUX_RUN_DIR ?? path.join(process.env.HOME ?? '/home/uvan', 'seguimiento-api-run-20260307');
const BANNER_FALLBACK_ROOT = '/home/uvan/banner-docente-runner';
const WINDOWS_NODE_CANDIDATE = '/mnt/c/Program Files/nodejs/node.exe';
const WINDOWS_POWERSHELL_CANDIDATE = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const STATE_FILE = path.join(LOG_DIR, 'runner-state.json');

type BannerProjectConfig = {
  projectRoot?: string | null;
};

function ensureBannerConfigDir() {
  fs.mkdirSync(BANNER_CONFIG_DIR, { recursive: true });
}

function readBannerProjectConfig(): BannerProjectConfig {
  try {
    const raw = fs.readFileSync(BANNER_CONFIG_FILE, 'utf8');
    return JSON.parse(raw) as BannerProjectConfig;
  } catch {
    return {};
  }
}

function writeBannerProjectConfig(config: BannerProjectConfig) {
  ensureBannerConfigDir();
  fs.writeFileSync(BANNER_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function getBannerRootCandidates() {
  const configuredRoot = readBannerProjectConfig().projectRoot;
  return [
    configuredRoot,
    process.env.BANNER_PROJECT_ROOT,
    '/home/uvan/banner-docente-runner',
    '/home/uvan/banner-batch-run-current',
    '/home/uvan/banner-batch-run-20260317-1508',
    '/mnt/c/Users/Duvan/Documents/banner buscador de docente en nrc',
    '/mnt/c/Users/Duvan/Documents/banner buscador de docente en nrc - BORRAR',
    '/mnt/c/Users/Duvan/Documents/ORGANIZAR TODO/banner buscador de docente en nrc - BORRAR',
  ].filter((value): value is string => Boolean(value && value.trim()));
}

function resolveBannerRoot() {
  const candidates = getBannerRootCandidates();

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return candidates[0] ?? BANNER_FALLBACK_ROOT;
}

function getBannerExportsDir(bannerRoot = getBannerProjectRoot()) {
  return path.join(bannerRoot, 'storage', 'exports');
}

function getWindowsAuthScript(bannerRoot = getBannerProjectRoot()) {
  return path.join(bannerRoot, 'scripts', 'auth-windows.cjs');
}

function getWindowsAuthSessionFile(bannerRoot = getBannerProjectRoot()) {
  return path.join(bannerRoot, 'storage', 'auth', 'banner-auth-session.json');
}

type BannerCommand = 'lookup' | 'batch' | 'retry-errors' | 'export';
type BannerInteractiveCommand = BannerCommand | 'auth';

type BannerRunnerRun = {
  id: string;
  command: BannerInteractiveCommand;
  args: string[];
  startedAt: string;
  endedAt?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  exitCode?: number | null;
  pid?: number;
  logPath: string;
  awaitingInput?: boolean;
};

type BannerRunState = BannerRunnerRun & {
  process?: ChildProcessWithoutNullStreams;
  cancelRequested: boolean;
};

export type StartBannerOptions =
  | {
      command: 'lookup';
      nrc: string;
      period?: string;
      queryName?: string;
      autoImportToSystem?: boolean;
    }
  | {
      command: 'batch';
      input: string;
      period?: string;
      queryName?: string;
      queryId?: string;
      workers?: number;
      resume?: boolean;
      autoImportToSystem?: boolean;
    }
  | {
      command: 'retry-errors';
      queryId: string;
      workers?: number;
      autoImportToSystem?: boolean;
    }
  | {
      command: 'export';
      queryId: string;
      format?: string;
      autoImportToSystem?: boolean;
    };

export type BannerRunnerStatus = {
  running: boolean;
  current: BannerRunnerRun | null;
  lastRun: BannerRunnerRun | null;
  logTail: string;
  liveActivity: BannerLiveActivity | null;
};

export type BannerLiveEventStage = 'PREPARING' | 'LOOKUP' | 'DONE' | 'WARN';

export type BannerLiveEvent = {
  at: string;
  stage: BannerLiveEventStage;
  message: string;
  worker: number | null;
  queryId: string | null;
  nrc: string | null;
  period: string | null;
  status: string | null;
};

export type BannerLiveWorkerState = {
  worker: number;
  at: string;
  stage: BannerLiveEventStage;
  nrc: string | null;
  period: string | null;
  status: string | null;
};

export type BannerLiveActivity = {
  queryId: string | null;
  totalRequested: number | null;
  workers: number | null;
  processed: number;
  pending: number | null;
  recentEvents: BannerLiveEvent[];
  workerStates: BannerLiveWorkerState[];
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

function readPersistedState(): { current: BannerRunnerRun | null; lastRun: BannerRunnerRun | null } {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { current?: BannerRunnerRun | null; lastRun?: BannerRunnerRun | null };
    return {
      current: parsed.current ?? null,
      lastRun: parsed.lastRun ?? null,
    };
  } catch {
    return {
      current: null,
      lastRun: null,
    };
  }
}

function writePersistedState(next: { current: BannerRunnerRun | null; lastRun: BannerRunnerRun | null }) {
  ensureLogDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
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
    awaitingInput: run.awaitingInput,
  };
}

function getPersistedPendingAuthRun() {
  const candidate = getPersistedCurrentRun();
  if (!candidate || candidate.command !== 'auth') {
    return null;
  }
  return candidate;
}

function getPersistedCurrentRun() {
  const persisted = readPersistedState();
  const candidate = persisted.current;
  if (!candidate || candidate.status !== 'RUNNING') {
    return null;
  }
  return candidate;
}

function removeAuthSessionFile() {
  const sessionFile = getWindowsAuthSessionFile();
  try {
    fs.unlinkSync(sessionFile);
  } catch {
    // Ignora sesiones de auth ya limpias o inexistentes.
  }
}

function appendLog(logPath: string, content: string) {
  fs.appendFileSync(logPath, content, 'utf8');
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

function readLogFile(logPath?: string) {
  if (!logPath) return '';
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

function parseLogContextValue(rawValue: string) {
  const trimmed = rawValue.trim().replace(/,$/, '');
  if (!trimmed) return null;
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return numericValue;
  }

  return trimmed;
}

type ParsedLogRecord = {
  at: string;
  level: string;
  message: string;
  context: Record<string, string | number | boolean | null>;
};

function parseBannerLogRecords(logContent: string): ParsedLogRecord[] {
  if (!logContent.trim()) return [];

  const lines = logContent.split(/\r?\n/);
  const records: ParsedLogRecord[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(/^\[(.+?)\]\s+([A-Z]+)\s+(.+)$/);
    if (!match) continue;

    let message = match[3].trim();
    const context: Record<string, string | number | boolean | null> = {};

    if (message.endsWith('{')) {
      message = message.slice(0, -1).trim();
      index += 1;

      while (index < lines.length) {
        const contextLine = lines[index] ?? '';
        if (contextLine.trim() === '}') {
          break;
        }

        const contextMatch = contextLine.match(/^\s*([A-Za-z0-9_]+):\s+(.+?)\s*$/);
        if (contextMatch) {
          context[contextMatch[1]] = parseLogContextValue(contextMatch[2]);
        }

        index += 1;
      }
    }

    records.push({
      at: match[1],
      level: match[2],
      message,
      context,
    });
  }

  return records;
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildLiveActivity(logPath?: string): BannerLiveActivity | null {
  const logContent = readLogFile(logPath);
  if (!logContent.trim()) return null;

  const records = parseBannerLogRecords(logContent);
  if (!records.length) return null;

  let queryId: string | null = null;
  let totalRequested: number | null = null;
  let workerCount: number | null = null;
  let processed = 0;
  const recentEvents: BannerLiveEvent[] = [];
  const workerStates = new Map<number, BannerLiveWorkerState>();

  for (const record of records) {
    if (record.message === 'Iniciando lote Banner') {
      queryId = stringOrNull(record.context.queryId) ?? queryId;
      totalRequested = numberOrNull(record.context.totalRequested) ?? totalRequested;
      workerCount = numberOrNull(record.context.workers) ?? workerCount;
      continue;
    }

    if (
      record.message !== 'Preparando NRC en Banner' &&
      record.message !== 'Ejecutando lookup NRC' &&
      record.message !== 'Lookup NRC finalizado' &&
      record.message !== 'Fallo lookup backend, reinicializando tarea Banner'
    ) {
      continue;
    }

    const worker = numberOrNull(record.context.worker);
    const event: BannerLiveEvent = {
      at: record.at,
      stage:
        record.message === 'Preparando NRC en Banner'
          ? 'PREPARING'
          : record.message === 'Ejecutando lookup NRC'
            ? 'LOOKUP'
            : record.message === 'Lookup NRC finalizado'
              ? 'DONE'
              : 'WARN',
      message: record.message,
      worker,
      queryId: stringOrNull(record.context.queryId) ?? queryId,
      nrc: stringOrNull(record.context.nrc),
      period: stringOrNull(record.context.period),
      status: stringOrNull(record.context.status),
    };

    if (event.queryId) queryId = event.queryId;
    recentEvents.push(event);

    if (worker !== null) {
      workerStates.set(worker, {
        worker,
        at: event.at,
        stage: event.stage,
        nrc: event.nrc,
        period: event.period,
        status: event.status,
      });
    }

    if (event.stage === 'DONE') {
      processed += 1;
    }
  }

  if (!queryId && !recentEvents.length && totalRequested === null) {
    return null;
  }

  return {
    queryId,
    totalRequested,
    workers: workerCount,
    processed,
    pending: totalRequested === null ? null : Math.max(totalRequested - processed, 0),
    recentEvents: recentEvents.slice(-18).reverse(),
    workerStates: [...workerStates.values()].sort((left, right) => left.worker - right.worker),
  };
}

function resolveInputPath(rawPath: string, bannerRoot = getBannerProjectRoot()) {
  const trimmed = rawPath.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) return trimmed;

  const bannerCandidate = path.resolve(bannerRoot, trimmed);
  if (exists(bannerCandidate)) return bannerCandidate;

  return path.resolve(SYSTEM_ROOT, trimmed);
}

function assertBannerProjectAvailable(bannerRoot = getBannerProjectRoot()) {
  if (!exists(bannerRoot)) {
    throw new Error(`No existe el proyecto Banner en: ${bannerRoot}`);
  }

  const cliPath = path.join(bannerRoot, 'src', 'cli.ts');
  if (!exists(cliPath)) {
    throw new Error(`No se encontro src/cli.ts en el proyecto Banner: ${bannerRoot}`);
  }
}

function shouldUseWindowsNode(bannerRoot = getBannerProjectRoot()) {
  return bannerRoot.startsWith('/mnt/') && exists(WINDOWS_NODE_CANDIDATE);
}

function shouldUseWindowsPowerShell(bannerRoot = getBannerProjectRoot()) {
  // The Banner CLI already invokes PowerShell internally for the auth flow when running from WSL.
  // Keep the outer runner on Linux by default so moved pnpm/node_modules trees do not depend on stale *.CMD wrappers.
  return (
    process.env.BANNER_USE_WINDOWS_POWERSHELL === '1' &&
    shouldUseWindowsNode(bannerRoot) &&
    exists(WINDOWS_POWERSHELL_CANDIDATE)
  );
}

function toWindowsPath(filePath: string) {
  const match = filePath.match(/^\/mnt\/([a-z])\/(.+)$/i);
  if (!match) return filePath;
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}

function quotePowerShell(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeWorkers(options: StartBannerOptions) {
  if (options.command !== 'batch' && options.command !== 'retry-errors') return undefined;
  const requested = options.workers;
  if (!requested || !Number.isFinite(requested)) return undefined;
  return 1;
}

function buildCliArgs(options: StartBannerOptions, windowsPaths = false, bannerRoot = getBannerProjectRoot()): string[] {
  const args = ['src/cli.ts', options.command];
  const normalizedWorkers = normalizeWorkers(options);

  if (options.command === 'lookup') {
    args.push('--nrc', options.nrc.trim());
    if (options.period?.trim()) args.push('--period', options.period.trim());
    if (options.queryName?.trim()) args.push('--query-name', options.queryName.trim());
    return args;
  }

  if (options.command === 'batch') {
    const inputPath = resolveInputPath(options.input, bannerRoot);
    args.push('--input', windowsPaths ? toWindowsPath(inputPath) : inputPath);
    if (options.period?.trim()) args.push('--period', options.period.trim());
    if (options.queryName?.trim()) args.push('--query-name', options.queryName.trim());
    if (options.queryId?.trim()) args.push('--query-id', options.queryId.trim());
    if (normalizedWorkers) args.push('--workers', String(normalizedWorkers));
    if (options.resume) args.push('--resume');
    return args;
  }

  if (options.command === 'retry-errors') {
    args.push('--query-id', options.queryId.trim());
    if (normalizedWorkers) args.push('--workers', String(normalizedWorkers));
    return args;
  }

  args.push('--query-id', options.queryId.trim());
  if (options.format?.trim()) args.push('--format', options.format.trim());
  return args;
}

function resolveSpawnCommand(options: StartBannerOptions) {
  const bannerRoot = getBannerProjectRoot();

  if (shouldUseWindowsPowerShell(bannerRoot)) {
    const cliArgs = buildCliArgs(options, true, bannerRoot);
    const command =
      `Set-Location ${quotePowerShell(toWindowsPath(bannerRoot))}; ` +
      `& '.\\node_modules\\.bin\\tsx.CMD' ${cliArgs.map(quotePowerShell).join(' ')}`;

    return {
      bannerRoot,
      executable: WINDOWS_POWERSHELL_CANDIDATE,
      args: ['-NoProfile', '-Command', command],
      displayCommand: command,
    };
  }

  const cliArgs = buildCliArgs(options, false, bannerRoot);
  return {
    bannerRoot,
    executable: 'node',
    args: ['--import', 'tsx', ...cliArgs],
    displayCommand: `node --import tsx ${cliArgs.map((arg) => JSON.stringify(arg)).join(' ')}`,
  };
}

function resolveAuthCommand(mode: 'start' | 'confirm' = 'start') {
  const bannerRoot = getBannerProjectRoot();
  const authScript = getWindowsAuthScript(bannerRoot);

  if (shouldUseWindowsNode(bannerRoot) && exists(WINDOWS_POWERSHELL_CANDIDATE) && exists(authScript)) {
    const command =
      `Set-Location ${quotePowerShell(toWindowsPath(bannerRoot))}; ` +
      `& ${quotePowerShell(toWindowsPath(WINDOWS_NODE_CANDIDATE))} ${quotePowerShell(
        toWindowsPath(authScript)
      )} ${quotePowerShell(mode)}`;
    return {
      bannerRoot,
      executable: WINDOWS_POWERSHELL_CANDIDATE,
      args: ['-NoProfile', '-Command', command],
      displayCommand: command,
    };
  }

  return {
    bannerRoot,
    executable: 'node',
    args: [authScript, mode],
    displayCommand: `node ${JSON.stringify(authScript)} ${JSON.stringify(mode)}`,
  };
}

function extractQueryIdFromOutput(output: string) {
  const match = output.match(/"queryId"\s*:\s*"([^"]+)"/);
  return match?.[1]?.trim() || null;
}

function extractNumericSummaryField(output: string, fieldName: 'processed' | 'total') {
  const match = output.match(new RegExp(`"${fieldName}"\\s*:\\s*(\\d+)`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

async function exportBannerQuery(queryId: string) {
  const command = resolveSpawnCommand({
    command: 'export',
    queryId,
    format: 'csv,json',
  });

  return execFileAsync(command.executable, command.args, {
    cwd: command.bannerRoot,
    env: process.env,
    maxBuffer: 1024 * 1024 * 16,
  });
}

function validateOptions(options: StartBannerOptions) {
  const bannerRoot = getBannerProjectRoot();
  assertBannerProjectAvailable(bannerRoot);

  if (options.command === 'lookup' && !options.nrc.trim()) {
    throw new Error('Debes indicar un NRC para la consulta individual.');
  }

  if (options.command === 'batch') {
    if (!options.input.trim()) {
      throw new Error('Debes indicar un archivo de entrada para el lote.');
    }
    const inputPath = resolveInputPath(options.input, bannerRoot);
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
  const bannerExportsDir = getBannerExportsDir();

  if (!exists(bannerExportsDir)) return null;

  const files = fs
    .readdirSync(bannerExportsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
    .map((entry) => path.join(bannerExportsDir, entry.name))
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
  const persisted = readPersistedState();
  const current = publicRun(currentRun) ?? getPersistedCurrentRun();
  const previous = lastRun ?? persisted.lastRun ?? (!current ? persisted.current : null);
  const statusRun = current ?? previous;
  return {
    running: Boolean(current),
    current,
    lastRun: previous,
    logTail: readLogTail(statusRun?.logPath),
    liveActivity: buildLiveActivity(statusRun?.logPath),
  };
}

export function startBannerRun(options: StartBannerOptions) {
  if (currentRun) {
    throw new Error('Ya existe una ejecucion Banner en curso. Cancela o espera a que termine.');
  }

  validateOptions(options);
  ensureLogDir();

  const command = resolveSpawnCommand(options);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `${stamp}_${options.command}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });

  logStream.write(`[START] ${new Date().toISOString()}\n`);
  logStream.write(`[CWD] ${command.bannerRoot}\n`);
  logStream.write(`[EXECUTABLE] ${command.executable}\n`);
  logStream.write(`[CMD] ${command.displayCommand}\n\n`);

  const child = spawn(command.executable, command.args, {
    cwd: command.bannerRoot,
    env: process.env,
    stdio: 'pipe',
  });
  let combinedOutput = '';

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const startedAt = new Date().toISOString();
  currentRun = {
    id: runId,
    command: options.command,
    args: command.args,
    startedAt,
    status: 'RUNNING',
    pid: child.pid,
    logPath,
    process: child,
    cancelRequested: false,
  };
  writePersistedState({
    current: publicRun(currentRun),
    lastRun: lastRun ?? readPersistedState().lastRun,
  });

  child.stdout.on('data', (chunk) => {
    const text = String(chunk);
    combinedOutput += text;
    logStream.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    combinedOutput += text;
    logStream.write(text);
  });
  child.on('error', (error) => {
    logStream.write(`\n[PROCESS_ERROR] ${error.message}\n`);
  });
  child.on('close', async (code) => {
    const cancelled = currentRun?.cancelRequested ?? false;
    let status: BannerRunnerRun['status'] = cancelled ? 'CANCELLED' : code === 0 ? 'COMPLETED' : 'FAILED';
    let autoExportQueryId: string | null = null;
    const processedCount = extractNumericSummaryField(combinedOutput, 'processed');
    const totalCount = extractNumericSummaryField(combinedOutput, 'total');
    const shouldAutoExport =
      status === 'COMPLETED' &&
      options.command !== 'export' &&
      !(options.command === 'retry-errors' && processedCount === 0 && totalCount === 0);
    const shouldAutoImportToSystem = shouldAutoExport && options.autoImportToSystem === true;

    if (shouldAutoExport) {
      autoExportQueryId = extractQueryIdFromOutput(combinedOutput);
      if (autoExportQueryId) {
        try {
          logStream.write(`\n[AUTO_EXPORT] ${autoExportQueryId}\n`);
          const { stdout, stderr } = await exportBannerQuery(autoExportQueryId);
          const exportOutput = String(stdout || stderr || '').trim();
          if (exportOutput) {
            logStream.write(`${exportOutput}\n`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logStream.write(`[AUTO_EXPORT_ERROR] ${message}\n`);
        }
      }
    }

    if (shouldAutoImportToSystem) {
      try {
        logStream.write(`\n[AUTO_IMPORT]\n`);
        const imported = await importBannerResultToSystem();
        logStream.write(`${JSON.stringify(imported, null, 2)}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logStream.write(`[AUTO_IMPORT_ERROR] ${message}\n`);
        status = 'FAILED';
      }
    }

    const endedAt = new Date().toISOString();

    lastRun = {
      id: runId,
      command: options.command,
      args: command.args,
      startedAt,
      endedAt,
      status,
      exitCode: code,
      pid: child.pid,
      logPath,
    };
    currentRun = null;
    writePersistedState({
      current: null,
      lastRun,
    });

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

export async function startBannerAuth() {
  if (currentRun || getPersistedPendingAuthRun()) {
    throw new Error('Ya existe una ejecucion Banner en curso. Cancela o espera a que termine.');
  }

  const bannerRoot = getBannerProjectRoot();
  assertBannerProjectAvailable(bannerRoot);
  ensureLogDir();

  removeAuthSessionFile();

  const command = resolveAuthCommand('start');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `${stamp}_auth.log`);
  appendLog(logPath, `[START] ${new Date().toISOString()}\n`);
  appendLog(logPath, `[CWD] ${bannerRoot}\n`);
  appendLog(logPath, `[EXECUTABLE] ${command.executable}\n`);
  appendLog(logPath, `[CMD] ${command.displayCommand}\n\n`);

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const startedAt = new Date().toISOString();
  try {
    const { stdout, stderr } = await execFileAsync(command.executable, command.args, {
      cwd: bannerRoot,
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
    });

    const output = `${String(stdout ?? '')}${String(stderr ?? '')}`;
    if (output.trim()) appendLog(logPath, output.endsWith('\n') ? output : `${output}\n`);
    appendLog(logPath, `\n[AUTH_PENDING] ${new Date().toISOString()}\n`);

    currentRun = {
      id: runId,
      command: 'auth',
      args: command.args,
      startedAt,
      status: 'RUNNING',
      logPath,
      cancelRequested: false,
      awaitingInput: true,
    };
    writePersistedState({
      current: publicRun(currentRun),
      lastRun: lastRun ?? readPersistedState().lastRun,
    });

    return {
      ok: true,
      run: publicRun(currentRun),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const endedAt = new Date().toISOString();
    lastRun = {
      id: runId,
      command: 'auth',
      args: command.args,
      startedAt,
      endedAt,
      status: 'FAILED',
      exitCode: 1,
      logPath,
      awaitingInput: false,
    };
    currentRun = null;
    writePersistedState({
      current: null,
      lastRun,
    });
    appendLog(logPath, `\n[PROCESS_ERROR] ${message}\n`);
    appendLog(logPath, `\n[END] ${endedAt}\n`);
    appendLog(logPath, `[STATUS] FAILED\n`);
    appendLog(logPath, `[EXIT_CODE] 1\n`);
    throw error;
  }
}

export async function confirmBannerAuth() {
  const pendingAuth = currentRun?.command === 'auth' ? currentRun : getPersistedPendingAuthRun();

  if (!pendingAuth) {
    throw new Error('No hay una autenticacion Banner pendiente por confirmar.');
  }

  const command = resolveAuthCommand('confirm');
  appendLog(pendingAuth.logPath, `\n[CONFIRM_START] ${new Date().toISOString()}\n`);
  appendLog(pendingAuth.logPath, `[CONFIRM_CMD] ${command.displayCommand}\n\n`);

  try {
    const { stdout, stderr } = await execFileAsync(command.executable, command.args, {
      cwd: command.bannerRoot,
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
    });

    const output = `${String(stdout ?? '')}${String(stderr ?? '')}`;
    if (output.trim()) appendLog(pendingAuth.logPath, output.endsWith('\n') ? output : `${output}\n`);

    const endedAt = new Date().toISOString();
    lastRun = {
      ...pendingAuth,
      endedAt,
      status: 'COMPLETED',
      exitCode: 0,
      awaitingInput: false,
    };
    currentRun = null;
    writePersistedState({
      current: null,
      lastRun,
    });
    appendLog(pendingAuth.logPath, `\n[END] ${endedAt}\n`);
    appendLog(pendingAuth.logPath, `[STATUS] COMPLETED\n`);
    appendLog(pendingAuth.logPath, `[EXIT_CODE] 0\n`);

    return {
      ok: true,
      confirmed: true,
      run: lastRun,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog(pendingAuth.logPath, `\n[CONFIRM_ERROR] ${message}\n`);
    writePersistedState({
      current: pendingAuth,
      lastRun: lastRun ?? readPersistedState().lastRun,
    });
    throw error;
  }
}

export async function startBannerRunFromSystem(
  options: StartBannerBatchFromSystemOptions & { autoImportToSystem?: boolean },
) {
  const prepared = await prepareBannerBatchFromSystem(options);
  const started = startBannerRun({
    command: 'batch',
    input: prepared.inputPath,
    queryName: options.queryName,
    queryId: options.queryId,
    workers: options.workers,
    resume: options.resume,
    autoImportToSystem: options.autoImportToSystem,
  });

  return {
    ...started,
    batch: prepared,
  };
}

export async function startBannerRunFromCourseIds(
  options: StartBannerBatchFromCourseIdsOptions & { autoImportToSystem?: boolean },
) {
  const prepared = await prepareBannerBatchFromCourseIds(options);
  const started = startBannerRun({
    command: 'batch',
    input: prepared.inputPath,
    queryName: options.queryName,
    queryId: options.queryId,
    workers: options.workers,
    resume: options.resume,
    autoImportToSystem: options.autoImportToSystem,
  });

  return {
    ...started,
    batch: prepared,
  };
}

export function cancelBannerRun() {
  const persistedRun = !currentRun ? getPersistedCurrentRun() : null;
  const activeRun = currentRun ?? (persistedRun ? { ...persistedRun, cancelRequested: false } : null);

  if (!activeRun) {
    throw new Error('No hay una ejecucion Banner activa para cancelar.');
  }

  if (!activeRun.process) {
    let killed = false;
    if (activeRun.pid) {
      try {
        process.kill(activeRun.pid);
        killed = true;
      } catch {
        killed = false;
      }
    }
    const endedAt = new Date().toISOString();
    lastRun = {
      ...activeRun,
      endedAt,
      status: 'CANCELLED',
      exitCode: null,
      awaitingInput: false,
    };
    currentRun = null;
    writePersistedState({
      current: null,
      lastRun,
    });
    removeAuthSessionFile();
    return {
      ok: true,
      killed,
      run: lastRun,
    };
  }

  activeRun.cancelRequested = true;
  const killed = activeRun.process.kill();
  return {
    ok: true,
    killed,
    run: publicRun(activeRun),
  };
}

export async function importBannerResultToSystem(inputPath?: string) {
  const summary = getBannerExportSummary();
  const targetPath = inputPath?.trim() ? resolveInputPath(inputPath, getBannerProjectRoot()) : summary.latestFile;

  if (!targetPath || !exists(targetPath)) {
    throw new Error('No existe un archivo Banner disponible para importar.');
  }

  const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl();
  const apiRunDir =
    exists(path.join(API_SHADOW_RUN_DIR, 'scripts', 'import-banner-review.ts')) && exists(path.join(API_SHADOW_RUN_DIR, 'package.json'))
      ? API_SHADOW_RUN_DIR
      : path.join(SYSTEM_ROOT, 'apps', 'api');

  const { stdout, stderr } = await execFileAsync('pnpm', ['exec', 'tsx', 'scripts/import-banner-review.ts', targetPath], {
    cwd: apiRunDir,
    env: {
      ...process.env,
      DATABASE_URL: runtimeDatabaseUrl,
    },
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
  return resolveBannerRoot();
}

function readRuntimePort(name: string) {
  try {
    const lines = fs.readFileSync(DEV_STACK_ENV_FILE, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      if (key?.trim() === name) {
        const value = rest.join('=').trim();
        if (value) return value;
      }
    }
  } catch {
    // Usa el fallback si no hay stack env.
  }
  return null;
}

function resolveRuntimeDatabaseUrl() {
  const explicit = String(process.env.DATABASE_URL ?? '').trim();
  if (explicit) return explicit;

  const postgresPort = readRuntimePort('POSTGRES_HOST_PORT') ?? '5433';
  return `postgresql://seguimiento:seguimiento@127.0.0.1:${postgresPort}/seguimiento?schema=public`;
}

export function setBannerProjectRoot(projectRoot: string) {
  const normalized = projectRoot.trim();
  if (!normalized) {
    throw new Error('Debes indicar una ruta para el proyecto Banner.');
  }

  writeBannerProjectConfig({ projectRoot: normalized });
  return {
    projectRoot: normalized,
    projectRootExists: exists(normalized),
    configFile: BANNER_CONFIG_FILE,
  };
}

export function getBannerProjectConfig() {
  const configuredRoot = readBannerProjectConfig().projectRoot?.trim() || null;
  const projectRoot = getBannerProjectRoot();
  return {
    configFile: BANNER_CONFIG_FILE,
    configuredProjectRoot: configuredRoot,
    projectRoot,
    projectRootExists: exists(projectRoot),
  };
}
