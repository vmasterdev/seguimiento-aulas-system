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
const BANNER_AUTH_BRIDGE_DIR = path.join(BANNER_CONFIG_DIR, 'auth-bridge');
const BANNER_AUTH_BRIDGE_SCRIPT = path.join(SYSTEM_ROOT, 'web-v2', 'scripts', 'banner-auth-bridge.cjs');
const DEV_STACK_ENV_FILE = path.join(SYSTEM_ROOT, 'storage', 'runtime', 'dev-stack', 'stack.env');
const HOME_DIR = process.env.HOME ?? '';
const API_SHADOW_RUN_DIR = process.env.API_LINUX_RUN_DIR ?? path.join(HOME_DIR || '/home', 'seguimiento-api-run-20260307');
const BANNER_FALLBACK_ROOT = path.join(SYSTEM_ROOT, 'tools', 'banner-runner');
const WINDOWS_NODE_CANDIDATE = '/mnt/c/Program Files/nodejs/node.exe';
const WINDOWS_POWERSHELL_CANDIDATE = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const INTERNAL_API_BASE_URL = process.env.INTERNAL_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';
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

function uniquePaths(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function getRepoSiblingBannerCandidates() {
  const repoParent = path.resolve(SYSTEM_ROOT, '..');
  return [
    path.join(repoParent, 'banner-docente-runner'),
    path.join(repoParent, 'banner-batch-run-current'),
    path.join(repoParent, 'banner buscador de docente en nrc'),
  ];
}

function getBannerRootCandidates() {
  const configuredRoot = readBannerProjectConfig().projectRoot;
  return uniquePaths([
    configuredRoot,
    process.env.BANNER_PROJECT_ROOT,
    path.join(SYSTEM_ROOT, 'tools', 'banner-runner'),
    ...getRepoSiblingBannerCandidates(),
    HOME_DIR ? path.join(HOME_DIR, 'banner-docente-runner') : null,
    HOME_DIR ? path.join(HOME_DIR, 'banner-batch-run-current') : null,
  ]);
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

function getBannerBridgeStorageStateFile() {
  return path.join(BANNER_AUTH_BRIDGE_DIR, 'banner-storage-state.json');
}

function getBannerBridgeAuthSessionFile() {
  return path.join(BANNER_AUTH_BRIDGE_DIR, 'banner-auth-session.json');
}

type BannerCommand = 'lookup' | 'batch' | 'retry-errors' | 'export';
type BannerInteractiveCommand = BannerCommand | 'auth' | 'enrollment';

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
  phase: 'BOOTSTRAP' | 'LOOKUP' | 'IMPORT' | 'COMPLETE' | 'ERROR';
  found: number;
  empty: number;
  failed: number;
  totalStudents: number;
  currentNrc: string | null;
  currentPeriod: string | null;
  lastEventAt: string | null;
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
  startDate: string | null;
  endDate: string | null;
};

export type BannerExportSummary = {
  latestFile: string | null;
  modifiedAt: string | null;
  rowCount: number;
  statusCounts: Record<string, number>;
  preview: BannerExportRecord[];
};

export type BannerEnrollmentImportResult = {
  ok: boolean;
  export: Record<string, unknown>;
  import: Record<string, unknown>;
  inputPath: string;
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
  const sessionFile = getBannerBridgeAuthSessionFile();
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

function splitInlineLogContext(rawContext: string) {
  const parts: string[] = [];
  let current = '';
  let depthSquare = 0;
  let depthRound = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (const char of rawContext) {
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '[') depthSquare += 1;
      if (char === ']') depthSquare = Math.max(0, depthSquare - 1);
      if (char === '(') depthRound += 1;
      if (char === ')') depthRound = Math.max(0, depthRound - 1);

      if (char === ',' && depthSquare === 0 && depthRound === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
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
    } else {
      const inlineContextMatch = message.match(/^(.*?)\s+\{(.+)\}\s*$/);
      if (inlineContextMatch) {
        message = inlineContextMatch[1].trim();
        for (const entry of splitInlineLogContext(inlineContextMatch[2].trim())) {
          const separatorIndex = entry.indexOf(':');
          if (separatorIndex <= 0) continue;

          const key = entry.slice(0, separatorIndex).trim();
          const value = entry.slice(separatorIndex + 1).trim();
          if (!key) continue;
          context[key] = parseLogContextValue(value);
        }
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

function formatRunnerLogContextValue(value: string | number | boolean | null) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function writeRunnerLogRecord(
  logStream: fs.WriteStream,
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context: Record<string, string | number | boolean | null> = {},
) {
  const stamp = new Date().toISOString();
  const entries = Object.entries(context).filter(([, value]) => value !== undefined);

  if (!entries.length) {
    logStream.write(`[${stamp}] ${level} ${message}\n`);
    return;
  }

  logStream.write(`[${stamp}] ${level} ${message} {\n`);
  for (const [key, value] of entries) {
    logStream.write(`  ${key}: ${formatRunnerLogContextValue(value)}\n`);
  }
  logStream.write('}\n');
}

function countBannerEnrollmentRequests(inputPath: string) {
  try {
    const content = fs.readFileSync(inputPath, 'utf8');
    const records = parseCsvRecords(content);
    const count = records.filter((row) => normalizeBannerNrcValue(String(row.nrc ?? '')).trim()).length;
    return count || null;
  } catch {
    return null;
  }
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
  let phase: BannerLiveActivity['phase'] = 'BOOTSTRAP';
  let found = 0;
  let empty = 0;
  let failed = 0;
  let totalStudents = 0;
  let currentNrc: string | null = null;
  let currentPeriod: string | null = null;
  let lastEventAt: string | null = null;
  const recentEvents: BannerLiveEvent[] = [];
  const workerStates = new Map<number, BannerLiveWorkerState>();

  for (const record of records) {
    if (record.message === 'Iniciando lote Banner') {
      queryId = stringOrNull(record.context.queryId) ?? queryId;
      totalRequested = numberOrNull(record.context.totalRequested) ?? totalRequested;
      workerCount = numberOrNull(record.context.workers) ?? workerCount;
      continue;
    }

    if (record.message === 'Iniciando matricula Banner') {
      totalRequested = numberOrNull(record.context.totalRequested) ?? totalRequested;
      workerCount = numberOrNull(record.context.workers) ?? workerCount ?? 1;
      phase = 'BOOTSTRAP';
      continue;
    }

    if (
      record.message !== 'Sesion restaurada desde storageState' &&
      record.message !== 'Sesion backend Banner reutilizada desde trafico de la pagina' &&
      record.message !== 'Bootstrap backend WORKSPACE_INIT' &&
      record.message !== 'Bootstrap backend respuesta' &&
      record.message !== 'Sesion backend Banner SFAALST inicializada' &&
      record.message !== 'Preparando NRC en Banner' &&
      record.message !== 'Ejecutando lookup NRC' &&
      record.message !== 'Lookup NRC finalizado' &&
      record.message !== 'Fallo lookup backend, reinicializando tarea Banner' &&
      record.message !== 'Consultando matricula oficial Banner' &&
      record.message !== 'Matricula Banner obtenida' &&
      record.message !== 'Fallo consulta de matricula Banner' &&
      record.message !== 'Importando matricula Banner a analitica' &&
      record.message !== 'Matricula Banner importada en analitica' &&
      record.message !== 'Fallo proceso de matricula Banner'
    ) {
      continue;
    }

    const worker =
      numberOrNull(record.context.worker) ??
      (record.message === 'Consultando matricula oficial Banner' ||
      record.message === 'Matricula Banner obtenida' ||
      record.message === 'Fallo consulta de matricula Banner'
        ? 1
        : null);
    const event: BannerLiveEvent = {
      at: record.at,
      stage:
        record.message === 'Sesion restaurada desde storageState'
          ? 'PREPARING'
          : record.message === 'Sesion backend Banner reutilizada desde trafico de la pagina'
            ? 'PREPARING'
            : record.message === 'Bootstrap backend WORKSPACE_INIT'
              ? 'PREPARING'
              : record.message === 'Bootstrap backend respuesta'
                ? 'PREPARING'
                : record.message === 'Sesion backend Banner SFAALST inicializada'
                  ? 'PREPARING'
        : record.message === 'Preparando NRC en Banner'
          ? 'PREPARING'
          : record.message === 'Ejecutando lookup NRC'
            ? 'LOOKUP'
            : record.message === 'Lookup NRC finalizado'
              ? 'DONE'
              : record.message === 'Consultando matricula oficial Banner'
                ? 'LOOKUP'
                : record.message === 'Matricula Banner obtenida'
                  ? 'DONE'
                  : record.message === 'Importando matricula Banner a analitica'
                    ? 'PREPARING'
                    : record.message === 'Matricula Banner importada en analitica'
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
    lastEventAt = event.at;
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

    if (record.message === 'Consultando matricula oficial Banner') {
      phase = 'LOOKUP';
      currentNrc = event.nrc;
      currentPeriod = event.period;
    }

    if (record.message === 'Matricula Banner obtenida') {
      processed += 1;
      const status = (event.status ?? '').toUpperCase();
      if (status === 'FOUND') found += 1;
      if (status === 'EMPTY') empty += 1;
      totalStudents += numberOrNull(record.context.students) ?? 0;
      currentNrc = event.nrc;
      currentPeriod = event.period;
      phase = 'LOOKUP';
    }

    if (record.message === 'Fallo consulta de matricula Banner') {
      processed += 1;
      failed += 1;
      currentNrc = event.nrc;
      currentPeriod = event.period;
      phase = 'LOOKUP';
    }

    if (record.message === 'Importando matricula Banner a analitica') {
      phase = 'IMPORT';
    }

    if (record.message === 'Matricula Banner importada en analitica') {
      phase = 'COMPLETE';
    }

    if (record.message === 'Fallo proceso de matricula Banner') {
      phase = 'ERROR';
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
    phase,
    found,
    empty,
    failed,
    totalStudents,
    currentNrc,
    currentPeriod,
    lastEventAt,
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

function quoteShellArg(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function quotePowerShell(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildBannerCommandEnv(
  options: {
    windowsPaths?: boolean;
    extra?: Record<string, string | undefined>;
  } = {},
) {
  const storageStatePath = getBannerBridgeStorageStateFile();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BANNER_STORAGE_STATE_PATH: options.windowsPaths ? toWindowsPath(storageStatePath) : storageStatePath,
  };

  for (const [key, value] of Object.entries(options.extra ?? {})) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

function findWorkspacePackageRoot(packageName: string) {
  const pnpmRoot = path.join(SYSTEM_ROOT, 'node_modules', '.pnpm');
  try {
    const entry = fs
      .readdirSync(pnpmRoot, { withFileTypes: true })
      .find((item) => item.isDirectory() && item.name.startsWith(`${packageName}@`));
    if (!entry) return null;

    const packageRoot = path.join(pnpmRoot, entry.name, 'node_modules', packageName);
    return exists(packageRoot) ? packageRoot : null;
  } catch {
    return null;
  }
}

export function ensureBannerAuthBridgeRuntime() {
  const runtimeRoot = path.join(BANNER_AUTH_BRIDGE_DIR, 'node-runtime');
  const runtimeNodeModules = path.join(runtimeRoot, 'node_modules');
  const manifestPath = path.join(runtimeRoot, 'manifest.json');
  const requiredPackages = ['playwright', 'playwright-core'] as const;
  const nextManifest: { packages: Record<string, string> } = {
    packages: {},
  };
  const sourceRoots = new Map<string, string>();

  for (const packageName of requiredPackages) {
    const packageRoot = findWorkspacePackageRoot(packageName);
    if (!packageRoot) {
      throw new Error(`No se encontro el paquete ${packageName} en node_modules para el bridge Banner.`);
    }

    const packageJsonPath = path.join(packageRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    nextManifest.packages[packageName] = packageJson.version?.trim() || 'unknown';
    sourceRoots.set(packageName, packageRoot);
  }

  try {
    const currentManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      packages?: Record<string, string>;
    };
    const isFresh = requiredPackages.every(
      (packageName) =>
        currentManifest.packages?.[packageName] === nextManifest.packages[packageName] &&
        exists(path.join(runtimeNodeModules, packageName, 'package.json')),
    );
    if (isFresh) {
      return runtimeNodeModules;
    }
  } catch {
    // Rehidrata el runtime si no existe o quedo incompleto.
  }

  fs.mkdirSync(runtimeNodeModules, { recursive: true });
  for (const packageName of requiredPackages) {
    const targetDir = path.join(runtimeNodeModules, packageName);
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(sourceRoots.get(packageName)!, targetDir, {
      recursive: true,
      dereference: true,
    });
  }
  fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2), 'utf8');

  return runtimeNodeModules;
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
      env: buildBannerCommandEnv({ windowsPaths: true }),
      displayCommand: command,
    };
  }

  const cliArgs = buildCliArgs(options, false, bannerRoot);
  return {
    bannerRoot,
    executable: 'node',
    args: ['--import', 'tsx', ...cliArgs],
    env: buildBannerCommandEnv(),
    displayCommand: `node --import tsx ${cliArgs.map((arg) => JSON.stringify(arg)).join(' ')}`,
  };
}

function resolveAuthCommand(mode: 'start' | 'confirm' = 'start') {
  const bannerRoot = getBannerProjectRoot();
  if (exists(WINDOWS_NODE_CANDIDATE) && exists(BANNER_AUTH_BRIDGE_SCRIPT)) {
    const windowsBridgeScript = toWindowsPath(BANNER_AUTH_BRIDGE_SCRIPT);
    const shellCommand = `${quoteShellArg(WINDOWS_NODE_CANDIDATE)} ${quoteShellArg(windowsBridgeScript)} ${quoteShellArg(mode)}`;
    return {
      bannerRoot,
      cwd: SYSTEM_ROOT,
      executable: 'bash',
      args: ['-lc', shellCommand],
      env: buildBannerCommandEnv({
        windowsPaths: true,
        extra: {
          BANNER_AUTH_SESSION_PATH: toWindowsPath(getBannerBridgeAuthSessionFile()),
          BANNER_REMOTE_DEBUGGING_URL: '',
        },
      }),
      displayCommand: `[win-node] ${JSON.stringify(windowsBridgeScript)} ${JSON.stringify(mode)}`,
    };
  }

  const authScript = getWindowsAuthScript(bannerRoot);

  return {
    bannerRoot,
    cwd: bannerRoot,
    executable: 'node',
    args: [authScript, mode],
    env: buildBannerCommandEnv(),
    displayCommand: `node ${JSON.stringify(authScript)} ${JSON.stringify(mode)}`,
  };
}

function buildBannerEnrollmentInputFile(periodCode: string, nrcs: string[]) {
  ensureBannerConfigDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const inputPath = path.join(BANNER_CONFIG_DIR, `banner-enrollment-${stamp}.csv`);
  const lines = ['nrc,periodo', ...nrcs.map((nrc) => `${nrc},${periodCode}`)];
  fs.writeFileSync(inputPath, `${lines.join('\n')}\n`, 'utf8');
  return inputPath;
}

function resolveBannerEnrollmentCommand(options: {
  inputPath: string;
  periodCode?: string;
  sourceLabel?: string;
}) {
  const bannerRoot = getBannerProjectRoot();
  const cliArgs = ['src/cli.ts', 'roster', '--input', options.inputPath];
  if (options.periodCode?.trim()) {
    cliArgs.push('--period', options.periodCode.trim());
  }
  if (options.sourceLabel?.trim()) {
    cliArgs.push('--source-label', options.sourceLabel.trim());
  }

  return {
    bannerRoot,
    executable: 'node',
    args: ['--import', 'tsx', ...cliArgs],
    env: buildBannerCommandEnv(),
    displayCommand: `node --import tsx ${cliArgs.map((arg) => JSON.stringify(arg)).join(' ')}`,
  };
}

async function finalizeBannerEnrollmentImport(options: {
  inputPath: string;
  periodCode?: string;
  sourceLabel?: string;
}): Promise<BannerEnrollmentImportResult> {
  if (currentRun) {
    throw new Error('Ya existe una ejecucion Banner en curso. Cancela o espera a que termine.');
  }

  const command = resolveBannerEnrollmentCommand({
    inputPath: options.inputPath,
    periodCode: options.periodCode,
    sourceLabel: options.sourceLabel,
  });

  ensureLogDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `${stamp}_enrollment.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
  const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const startedAt = new Date().toISOString();
  const totalRequested = countBannerEnrollmentRequests(options.inputPath);

  logStream.write(`[START] ${startedAt}\n`);
  logStream.write(`[CWD] ${command.bannerRoot}\n`);
  logStream.write(`[EXECUTABLE] ${command.executable}\n`);
  logStream.write(`[CMD] ${command.displayCommand}\n\n`);
  writeRunnerLogRecord(logStream, 'INFO', 'Iniciando matricula Banner', {
    totalRequested,
    workers: 1,
    ...(options.sourceLabel?.trim() ? { sourceLabel: options.sourceLabel.trim() } : {}),
  });

  currentRun = {
    id: runId,
    command: 'enrollment',
    args: command.args,
    startedAt,
    status: 'RUNNING',
    logPath,
    cancelRequested: false,
  };
  writePersistedState({
    current: publicRun(currentRun),
    lastRun: lastRun ?? readPersistedState().lastRun,
  });

  let exportResult: Record<string, unknown>;
  let commandOutput = '';
  let exitCode: number | null = null;
  let finalStatus: BannerRunnerRun['status'] = 'RUNNING';
  try {
  const child = spawn(command.executable, command.args, {
    cwd: command.bannerRoot,
    env: {
      ...(command.env ?? buildBannerCommandEnv()),
      LOG_LEVEL: 'info',
    },
    stdio: 'pipe',
  });

    if (!currentRun) {
      throw new Error('No fue posible inicializar la corrida de matricula Banner.');
    }

    currentRun.pid = child.pid;
    currentRun.process = child;
    writePersistedState({
      current: publicRun(currentRun),
      lastRun: lastRun ?? readPersistedState().lastRun,
    });

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      commandOutput += text;
      logStream.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      commandOutput += text;
      logStream.write(text);
    });

    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    exitCode = code;

    if (currentRun?.cancelRequested) {
      finalStatus = 'CANCELLED';
      throw new Error('La consulta de matricula Banner fue cancelada.');
    }

    if (code !== 0) {
      throw new Error(`No fue posible exportar la matricula Banner: ${commandOutput.trim() || `exit ${String(code)}`}`);
    }

    try {
      exportResult = parseJsonFromCommandOutput<Record<string, unknown>>(commandOutput);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`No fue posible exportar la matricula Banner: ${detail}`);
    }

    const exportedPath = typeof exportResult.outputPath === 'string' ? exportResult.outputPath.trim() : '';
    if (!exportedPath || !exists(exportedPath)) {
      throw new Error('La exportacion de matricula Banner no devolvio un archivo CSV valido.');
    }

    writeRunnerLogRecord(logStream, 'INFO', 'Importando matricula Banner a analitica', {
      outputPath: exportedPath,
    });

    const response = await fetch(`${INTERNAL_API_BASE_URL}/integrations/moodle-analytics/import/banner-enrollment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        inputPath: exportedPath,
        sourceLabel: options.sourceLabel?.trim() || undefined,
      }),
    });

    const rawText = await response.text();
    let importResult: Record<string, unknown>;
    try {
      importResult = rawText.trim() ? (JSON.parse(rawText) as Record<string, unknown>) : { ok: response.ok };
    } catch {
      throw new Error(rawText.trim() || `La API de analitica respondio HTTP ${response.status}.`);
    }

    if (!response.ok) {
      const message =
        (typeof importResult.message === 'string' && importResult.message) ||
        (typeof importResult.error === 'string' && importResult.error) ||
        rawText.trim() ||
        `La API de analitica respondio HTTP ${response.status}.`;
      throw new Error(message);
    }

    writeRunnerLogRecord(logStream, 'INFO', 'Matricula Banner importada en analitica', {
      importedReports: typeof importResult.importedReports === 'number' ? importResult.importedReports : null,
      importedStudents: typeof importResult.importedStudents === 'number' ? importResult.importedStudents : null,
    });

    finalStatus = 'COMPLETED';
    return {
      ok: true,
      export: exportResult,
      import: importResult,
      inputPath: options.inputPath,
    };
  } catch (error) {
    if (finalStatus !== 'CANCELLED') {
      finalStatus = 'FAILED';
    }
    writeRunnerLogRecord(logStream, 'ERROR', 'Fallo proceso de matricula Banner', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    const endedAt = new Date().toISOString();
    const activeRun = currentRun;
    lastRun = {
      id: runId,
      command: 'enrollment',
      args: command.args,
      startedAt,
      endedAt,
      status: finalStatus,
      exitCode,
      pid: activeRun?.pid,
      logPath,
    };
    currentRun = null;
    writePersistedState({
      current: null,
      lastRun,
    });
    logStream.write(`\n[END] ${endedAt}\n`);
    logStream.write(`[STATUS] ${finalStatus}\n`);
    if (typeof exitCode === 'number') {
      logStream.write(`[EXIT_CODE] ${exitCode}\n`);
    }
    logStream.end();
  }
}

function parseCommandOutput(error: unknown) {
  if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
    const stdout = String((error as { stdout?: string }).stdout ?? '');
    const stderr = String((error as { stderr?: string }).stderr ?? '');
    return `${stdout}${stderr}`.trim();
  }

  return error instanceof Error ? error.message : String(error);
}

function parseJsonFromCommandOutput<T>(output: string): T {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error('El comando no devolvio salida JSON.');
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const lastObjectStart = trimmed.lastIndexOf('\n{');
    if (lastObjectStart >= 0) {
      const candidate = trimmed.slice(lastObjectStart + 1).trim();
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Sigue con otros intentos.
      }
    }

    const lastArrayStart = trimmed.lastIndexOf('\n[');
    if (lastArrayStart >= 0) {
      const candidate = trimmed.slice(lastArrayStart + 1).trim();
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Sigue con otros intentos.
      }
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate) as T;
    }

    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      const candidate = trimmed.slice(firstBracket, lastBracket + 1);
      return JSON.parse(candidate) as T;
    }

    throw new Error(trimmed);
  }
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
    env: command.env ?? buildBannerCommandEnv(),
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

function normalizeBannerNrcValue(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.length > 5 ? digits.slice(-5) : digits;
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
      startDate: String(row.start_date ?? '').trim() || null,
      endDate: String(row.end_date ?? '').trim() || null,
    };

    const nrcKey = normalizeNrcKey(item.nrc);
    if (nrcKey && !previewByNrc[nrcKey]) {
      previewByNrc[nrcKey] = item;
    }
  }

  const preview = records
    .slice(0, 50)
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

export function getAllBannerExportRecords(limit = 500): BannerExportRecord[] {
  const latestFile = pickLatestBannerExportFile();
  if (!latestFile) return [];

  const content = fs.readFileSync(latestFile, 'utf8');
  const records = parseCsvRecords(content);
  const result: BannerExportRecord[] = [];

  for (const row of records.slice(0, limit)) {
    const status = String(row.status ?? '').trim() || null;
    result.push({
      queryId: String(row.query_id ?? '').trim() || null,
      nrc: String(row.nrc ?? '').trim(),
      period: String(row.period ?? '').trim() || null,
      teacherName: String(row.teacher_name ?? '').trim() || null,
      teacherId: String(row.teacher_id ?? '').trim() || null,
      programName: String(row.program_name ?? '').trim() || null,
      status,
      checkedAt: String(row.checked_at ?? '').trim() || null,
      errorMessage: String(row.error_message ?? '').trim() || null,
      startDate: String(row.start_date ?? '').trim() || null,
      endDate: String(row.end_date ?? '').trim() || null,
    });
  }

  return result;
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
    env: command.env ?? buildBannerCommandEnv(),
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
  ensureBannerAuthBridgeRuntime();

  const command = resolveAuthCommand('start');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(LOG_DIR, `${stamp}_auth.log`);
  appendLog(logPath, `[START] ${new Date().toISOString()}\n`);
  appendLog(logPath, `[CWD] ${command.cwd ?? bannerRoot}\n`);
  appendLog(logPath, `[EXECUTABLE] ${command.executable}\n`);
  appendLog(logPath, `[CMD] ${command.displayCommand}\n\n`);

  const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const startedAt = new Date().toISOString();
  try {
    const { stdout, stderr } = await execFileAsync(command.executable, command.args, {
      cwd: command.cwd ?? bannerRoot,
      env: command.env ?? buildBannerCommandEnv(),
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

  ensureBannerAuthBridgeRuntime();
  const command = resolveAuthCommand('confirm');
  appendLog(pendingAuth.logPath, `\n[CONFIRM_START] ${new Date().toISOString()}\n`);
  appendLog(pendingAuth.logPath, `[CONFIRM_CMD] ${command.displayCommand}\n\n`);

  try {
    const { stdout, stderr } = await execFileAsync(command.executable, command.args, {
      cwd: command.cwd ?? command.bannerRoot,
      env: command.env ?? buildBannerCommandEnv(),
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

    // Sync storageState al sitio que espera el runner Banner (SPAIDEN)
    try {
      const bridgeState = getBannerBridgeStorageStateFile();
      const runnerState = path.join(getBannerProjectRoot(), 'storage', 'auth', 'banner-storage-state.json');
      if (fs.existsSync(bridgeState)) {
        fs.mkdirSync(path.dirname(runnerState), { recursive: true });
        fs.copyFileSync(bridgeState, runnerState);
        appendLog(pendingAuth.logPath, `[STORAGE_STATE_SYNCED] ${runnerState}\n`);
      }
    } catch (syncError) {
      appendLog(pendingAuth.logPath, `[STORAGE_STATE_SYNC_ERROR] ${syncError instanceof Error ? syncError.message : String(syncError)}\n`);
    }

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

export async function importBannerEnrollmentFromBanner(options: {
  periodCode: string;
  nrcs: string[];
  sourceLabel?: string;
}): Promise<BannerEnrollmentImportResult> {
  const periodCode = options.periodCode.trim();
  const nrcs = [...new Set(options.nrcs.map((value) => normalizeBannerNrcValue(value)).filter(Boolean))];

  if (!periodCode) {
    throw new Error('Debes indicar un periodo para consultar matricula Banner.');
  }

  if (!nrcs.length) {
    throw new Error('Debes indicar al menos un NRC para consultar matricula Banner.');
  }

  const bannerRoot = getBannerProjectRoot();
  assertBannerProjectAvailable(bannerRoot);

  const inputPath = buildBannerEnrollmentInputFile(periodCode, nrcs);
  return finalizeBannerEnrollmentImport({
    inputPath,
    periodCode,
    sourceLabel: options.sourceLabel,
  });
}

export async function importBannerEnrollmentFromSystem(options: {
  periodCodes: string[];
  sourceLabel?: string;
}): Promise<BannerEnrollmentImportResult> {
  const periodCodes = [...new Set(options.periodCodes.map((value) => String(value).trim()).filter(Boolean))];

  if (!periodCodes.length) {
    throw new Error('Debes seleccionar al menos un periodo para recorrer los NRC cargados por RPACA.');
  }

  const prepared = await prepareBannerBatchFromSystem({
    periodCodes,
    source: 'ALL',
  });

  if (!prepared.total) {
    throw new Error('No se encontraron aulas respaldadas por RPACA para los periodos seleccionados.');
  }

  return finalizeBannerEnrollmentImport({
    inputPath: prepared.inputPath,
    sourceLabel: options.sourceLabel,
  });
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
