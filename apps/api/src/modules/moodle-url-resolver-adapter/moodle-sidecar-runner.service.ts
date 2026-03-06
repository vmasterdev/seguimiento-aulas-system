import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { loadSidecarConfig, resolveAdapterInputPath, resolveProjectRoot } from './adapter.logic';

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
    const python = options.python?.trim() || (config as any)?.runtime?.pythonCommand || 'python3';
    const script = path.join(root, 'tools', 'moodle-sidecar', 'sidecar_runner.py');

    const args = [script, options.command];
    if (options.command === 'classify') {
      if (options.inputDir?.trim()) args.push('--input-dir', this.resolvePath(root, options.inputDir));
      if (options.output?.trim()) args.push('--output', this.resolvePath(root, options.output));
      if (options.workers) args.push('--workers', String(options.workers));
      if (options.browser) args.push('--browser', options.browser);
      if (options.headless) args.push('--headless');
      if (options.noResume) args.push('--no-resume');
    }

    if (options.command === 'revalidate') {
      if (options.mode) args.push('--mode', options.mode);
      if (options.workers) args.push('--workers', String(options.workers));
      if (options.browser) args.push('--browser', options.browser);
      if (options.headless) args.push('--headless');
    }

    if (options.command === 'backup') {
      if (options.nrcCsv?.trim()) args.push('--nrc-csv', this.resolvePath(root, options.nrcCsv));
      if (options.loginWaitSeconds) args.push('--login-wait-seconds', String(options.loginWaitSeconds));
      if (options.backupTimeout) args.push('--backup-timeout', String(options.backupTimeout));
      if (options.keepOpen) args.push('--keep-open');
    }

    if (options.python?.trim()) {
      args.push('--python', options.python.trim());
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
