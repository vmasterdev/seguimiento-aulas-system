import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import { loadSidecarConfig, resolveAdapterInputPath, resolveProjectRoot } from './adapter.logic';
import {
  MoodleSidecarBatchService,
  type PrepareSidecarBatchInput,
  type PrepareRevalidateBatchInput,
} from './moodle-sidecar-batch.service';

type SidecarCommand = 'classify' | 'revalidate' | 'backup' | 'gui';

export type StartSidecarRunOptions = {
  command: SidecarCommand;
  inputDir?: string;
  output?: string;
  workers?: number;
  browser?: 'edge' | 'chrome';
  python?: string;
  headless?: boolean;
  noResume?: boolean;
  mode?: 'sin_matricula' | 'aulas_vacias' | 'ambos';
  nrcCsv?: string;
  loginWaitSeconds?: number;
  backupTimeout?: number;
  keepOpen?: boolean;
  preloginAllModalities?: boolean;
  preloginModalities?: string[];
  modalidadesPermitidas?: string[];
};

type RunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

type RunInfo = {
  id: string;
  command: SidecarCommand;
  args: string[];
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  exitCode?: number | null;
  pid?: number;
  logPath: string;
};

@Injectable()
export class MoodleSidecarRunnerService {
  constructor(private readonly batchService: MoodleSidecarBatchService) {}

  private current: (RunInfo & { process: ChildProcessWithoutNullStreams; cancelRequested: boolean }) | null = null;
  private lastRun: RunInfo | null = null;

  getStatus() {
    return {
      running: Boolean(this.current),
      current: this.current ? this.publicRun(this.current) : null,
      lastRun: this.lastRun,
      logTail: this.readLogTail(this.current?.logPath ?? this.lastRun?.logPath),
    };
  }

  start(options: StartSidecarRunOptions) {
    if (this.current) {
      throw new ConflictException('Ya existe una ejecucion sidecar en curso. Debes esperar o cancelarla.');
    }

    const root = resolveProjectRoot();
    const config = loadSidecarConfig(root);
    const script = path.join(root, 'tools', 'moodle-sidecar', 'sidecar_runner.py');
    const useWindowsHost = this.shouldUseWindowsHost();
    const python = useWindowsHost
      ? this.resolveWindowsCommandLauncher()
      : (options.python?.trim() || (config as any)?.runtime?.pythonCommand || 'python3');
    const args = useWindowsHost
      ? ['/c', 'py', '-3', this.toWindowsPath(script), options.command]
      : [script, options.command];
    const nestedPythonCommand = this.resolveNestedPythonCommand(options.python, useWindowsHost, config);
    if (options.command === 'classify') {
      if (options.inputDir?.trim()) args.push('--input-dir', this.resolveHostPath(root, options.inputDir, useWindowsHost));
      if (options.output?.trim()) args.push('--output', this.resolveHostPath(root, options.output, useWindowsHost));
      if (options.workers) args.push('--workers', String(options.workers));
      if (options.browser) args.push('--browser', options.browser);
      if (options.headless) args.push('--headless');
      if (options.noResume) args.push('--no-resume');
      if (options.preloginAllModalities) args.push('--prelogin-all-modalidades');
      if (options.preloginModalities?.length) args.push('--prelogin-modalidades', options.preloginModalities.join(','));
      if (options.modalidadesPermitidas?.length) {
        args.push('--modalidades-permitidas', options.modalidadesPermitidas.join(','));
      }
    }

    if (options.command === 'revalidate') {
      if (options.inputDir?.trim()) args.push('--input-dir', this.resolveHostPath(root, options.inputDir, useWindowsHost));
      if (options.output?.trim()) args.push('--output', this.resolveHostPath(root, options.output, useWindowsHost));
      if (options.mode) args.push('--mode', options.mode);
      if (options.workers) args.push('--workers', String(options.workers));
      if (options.browser) args.push('--browser', options.browser);
      if (options.headless) args.push('--headless');
    }

    if (options.command === 'backup') {
      if (options.nrcCsv?.trim()) args.push('--nrc-csv', this.resolveHostPath(root, options.nrcCsv, useWindowsHost));
      if (options.loginWaitSeconds) args.push('--login-wait-seconds', String(options.loginWaitSeconds));
      if (options.backupTimeout) args.push('--backup-timeout', String(options.backupTimeout));
      if (options.keepOpen) args.push('--keep-open');
    }

    if (nestedPythonCommand) {
      args.push('--python', nestedPythonCommand);
    }

    const logsDir = path.join(root, 'storage', 'outputs', 'validation', 'sidecar-runs');
    fs.mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logsDir, `${stamp}_${options.command}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });

    logStream.write(`[START] ${new Date().toISOString()}\n`);
    logStream.write(`[CMD] ${python} ${args.map((v) => JSON.stringify(v)).join(' ')}\n\n`);

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(python, args, {
        cwd: root,
        env: process.env,
        stdio: 'pipe',
      });
    } catch (error) {
      logStream.end();
      throw new BadRequestException(
        `No se pudo iniciar sidecar con ${python}. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const runId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const startedAt = new Date().toISOString();
    this.current = {
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
      const current = this.current;
      const cancelled = current?.cancelRequested ?? false;
      const status: RunStatus = cancelled ? 'CANCELLED' : code === 0 ? 'COMPLETED' : 'FAILED';

      const done: RunInfo = {
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
      this.lastRun = done;
      this.current = null;

      logStream.write(`\n[END] ${endedAt}\n`);
      logStream.write(`[STATUS] ${status}\n`);
      logStream.write(`[EXIT_CODE] ${String(code)}\n`);
      logStream.end();
    });

    return {
      ok: true,
      run: this.publicRun(this.current),
    };
  }

  async startFromDatabase(input: PrepareSidecarBatchInput & Omit<StartSidecarRunOptions, 'command' | 'inputDir'>) {
    if (this.current) {
      throw new ConflictException('Ya existe una ejecucion sidecar en curso. Debes esperar o cancelarla.');
    }

    const prepared = await this.batchService.prepareBatch(input);
    if (prepared.total <= 0) {
      throw new BadRequestException(this.buildEmptyBatchMessage(input.source, 'classify'));
    }
    const output =
      input.output?.trim() ||
      path.join(
        'storage',
        'outputs',
        'validation',
        `RESULTADO_TIPOS_AULA_DESDE_MOODLE_${prepared.batchId}.xlsx`,
      );

    const started = this.start({
      command: 'classify',
      inputDir: prepared.inputDir,
      output,
      workers: input.workers,
      browser: input.browser,
      python: input.python,
      headless: input.headless,
      noResume: input.noResume,
      preloginAllModalities: input.preloginAllModalities,
      preloginModalities: input.preloginModalities,
      modalidadesPermitidas: input.modalidadesPermitidas,
    });

    return {
      ...started,
      batch: prepared,
      outputPath: output,
    };
  }

  async startBackupFromDatabase(
    input: PrepareSidecarBatchInput & Pick<StartSidecarRunOptions, 'python' | 'loginWaitSeconds' | 'backupTimeout' | 'keepOpen'>,
  ) {
    if (this.current) {
      throw new ConflictException('Ya existe una ejecucion sidecar en curso. Debes esperar o cancelarla.');
    }

    const prepared = await this.batchService.prepareBackupBatch(input);
    if (prepared.total <= 0) {
      throw new BadRequestException(this.buildEmptyBatchMessage(input.source, 'backup'));
    }
    const started = this.start({
      command: 'backup',
      nrcCsv: prepared.csvPath,
      python: input.python,
      loginWaitSeconds: input.loginWaitSeconds,
      backupTimeout: input.backupTimeout,
      keepOpen: input.keepOpen,
    });

    return {
      ...started,
      batch: prepared,
    };
  }

  async startRevalidateFromDatabase(
    input: PrepareRevalidateBatchInput &
      Pick<StartSidecarRunOptions, 'workers' | 'browser' | 'python' | 'headless' | 'output'>,
  ) {
    if (this.current) {
      throw new ConflictException('Ya existe una ejecucion sidecar en curso. Debes esperar o cancelarla.');
    }

    const prepared = await this.batchService.prepareRevalidateBatch(input);
    if (prepared.total <= 0) {
      throw new BadRequestException(this.buildEmptyRevalidateMessage(input.mode));
    }

    const output =
      input.output?.trim() ||
      path.join('storage', 'outputs', 'validation', `REVALIDACION_PENDIENTES_${prepared.batchId}.xlsx`);

    const started = this.start({
      command: 'revalidate',
      inputDir: prepared.inputDir,
      output,
      mode: input.mode,
      workers: input.workers,
      browser: input.browser,
      python: input.python,
      headless: input.headless,
    });

    return {
      ...started,
      batch: prepared,
      outputPath: output,
    };
  }

  cancel() {
    if (!this.current) {
      throw new BadRequestException('No hay ejecucion sidecar activa para cancelar.');
    }

    this.current.cancelRequested = true;
    const killed = this.current.process.kill();
    return {
      ok: true,
      requested: true,
      killed,
      run: this.publicRun(this.current),
    };
  }

  private resolvePath(projectRoot: string, rawPath: string): string {
    return resolveAdapterInputPath(projectRoot, rawPath.trim());
  }

  private resolveHostPath(projectRoot: string, rawPath: string, useWindowsHost: boolean): string {
    const resolved = this.resolvePath(projectRoot, rawPath);
    return useWindowsHost ? this.toWindowsPath(resolved) : resolved;
  }

  private shouldUseWindowsHost(): boolean {
    const raw = String(process.env.MOODLE_SIDECAR_EXECUTION_HOST ?? '').trim().toLowerCase();
    return raw === 'windows';
  }

  private resolveWindowsCommandLauncher(): string {
    return String(process.env.MOODLE_SIDECAR_WINDOWS_CMD_PATH ?? '').trim() || '/mnt/c/WINDOWS/system32/cmd.exe';
  }

  private resolveNestedPythonCommand(
    requestedPython: string | undefined,
    useWindowsHost: boolean,
    config: ReturnType<typeof loadSidecarConfig>,
  ): string | null {
    if (useWindowsHost) {
      const normalized = requestedPython?.trim();
      if (!normalized || normalized.toLowerCase() === 'python3' || normalized.toLowerCase() === 'python') {
        return 'py';
      }
      return normalized;
    }

    return requestedPython?.trim() || (config as any)?.runtime?.pythonCommand || null;
  }

  private toWindowsPath(rawPath: string): string {
    try {
      return execFileSync('wslpath', ['-w', rawPath], { encoding: 'utf8' }).trim();
    } catch (error) {
      throw new BadRequestException(
        `No fue posible convertir ruta a Windows: ${rawPath}. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private publicRun(run: RunInfo) {
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

  private buildEmptyBatchMessage(source: PrepareSidecarBatchInput['source'], command: 'classify' | 'backup') {
    const action =
      command === 'backup'
        ? 'No hay NRC elegibles para generar el respaldo con los filtros indicados.'
        : 'No hay NRC elegibles para iniciar la revision con los filtros indicados.';
    if (source === 'PENDING') {
      return `${action} En modo PENDING solo entran cursos pendientes/reintento/revision manual que sigan siendo elegibles para revision. Los casos sin acceso, no matriculado o vacio sin estudiantes quedan excluidos.`;
    }
    return action;
  }

  private buildEmptyRevalidateMessage(mode: PrepareRevalidateBatchInput['mode']) {
    if (mode === 'aulas_vacias') {
      return 'No hay cursos con tipo de aula VACIO en los periodos y momentos seleccionados.';
    }
    if (mode === 'sin_matricula') {
      return 'No hay cursos marcados como sin matricula/no registrado en los periodos y momentos seleccionados.';
    }
    return 'No hay cursos para revalidar en los periodos y momentos seleccionados.';
  }

  private readLogTail(logPath?: string, maxChars = 12000) {
    if (!logPath) return '';
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      if (content.length <= maxChars) return content;
      return content.slice(content.length - maxChars);
    } catch {
      return '';
    }
  }
}
