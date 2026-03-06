'use client';

import { useEffect, useMemo, useState } from 'react';

type SidecarRunCommand = 'classify' | 'revalidate' | 'backup' | 'gui';
type RevalidateMode = 'sin_matricula' | 'aulas_vacias' | 'ambos';

type SidecarStatus = {
  running: boolean;
  current: {
    id: string;
    command: SidecarRunCommand;
    status: string;
    startedAt: string;
    endedAt?: string;
    exitCode?: number | null;
    pid?: number;
    logPath: string;
  } | null;
  lastRun: {
    id: string;
    command: SidecarRunCommand;
    status: string;
    startedAt: string;
    endedAt?: string;
    exitCode?: number | null;
    pid?: number;
    logPath: string;
  } | null;
  logTail: string;
};

type SidecarConfigResponse = {
  projectRoot: string;
  configPath: string;
  config: {
    runtime?: {
      workers?: number;
      browser?: string;
      headless?: boolean;
      pythonCommand?: string;
    };
    paths?: Record<string, string>;
  };
};

type SidecarIntegrationPanelProps = {
  apiBase: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) {
    const message =
      typeof data?.message === 'string'
        ? data.message
        : Array.isArray(data?.message)
          ? data.message.join('; ')
          : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function SidecarIntegrationPanel({ apiBase }: SidecarIntegrationPanelProps) {
  const [config, setConfig] = useState<SidecarConfigResponse | null>(null);
  const [status, setStatus] = useState<SidecarStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [command, setCommand] = useState<SidecarRunCommand>('classify');
  const [workers, setWorkers] = useState('3');
  const [browser, setBrowser] = useState<'edge' | 'chrome'>('edge');
  const [headless, setHeadless] = useState(false);
  const [noResume, setNoResume] = useState(false);
  const [mode, setMode] = useState<RevalidateMode>('ambos');
  const [inputDir, setInputDir] = useState('');
  const [output, setOutput] = useState('');
  const [nrcCsv, setNrcCsv] = useState('');
  const [loginWaitSeconds, setLoginWaitSeconds] = useState('300');
  const [backupTimeout, setBackupTimeout] = useState('240');
  const [keepOpen, setKeepOpen] = useState(false);
  const [python, setPython] = useState('');

  const [importPath, setImportPath] = useState('');
  const [importDryRun, setImportDryRun] = useState(true);
  const [importSource, setImportSource] = useState('ui-sidecar');
  const [importResult, setImportResult] = useState<unknown>(null);

  const canStart = useMemo(() => !status?.running && !actionLoading, [status?.running, actionLoading]);

  async function loadAll() {
    try {
      setLoading(true);
      setMessage('');
      const [cfg, st] = await Promise.all([
        fetchJson<SidecarConfigResponse>(`${apiBase}/integrations/moodle-sidecar/config`),
        fetchJson<SidecarStatus>(`${apiBase}/integrations/moodle-sidecar/run/status`),
      ]);
      setConfig(cfg);
      setStatus(st);
      if (!workers && cfg.config?.runtime?.workers) {
        setWorkers(String(cfg.config.runtime.workers));
      }
      if (!python && cfg.config?.runtime?.pythonCommand) {
        setPython(String(cfg.config.runtime.pythonCommand));
      }
    } catch (error) {
      setMessage(`No se pudo cargar sidecar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!status?.running) return;
    const id = setInterval(() => {
      void fetchJson<SidecarStatus>(`${apiBase}/integrations/moodle-sidecar/run/status`)
        .then(setStatus)
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(id);
  }, [status?.running, apiBase]);

  async function startRun() {
    try {
      setActionLoading(true);
      setMessage('');
      const body: Record<string, unknown> = {
        command,
      };
      if (workers.trim()) body.workers = Number(workers);
      if (browser) body.browser = browser;
      if (headless) body.headless = true;
      if (python.trim()) body.python = python.trim();
      if (command === 'classify') {
        if (inputDir.trim()) body.inputDir = inputDir.trim();
        if (output.trim()) body.output = output.trim();
        if (noResume) body.noResume = true;
      }
      if (command === 'revalidate') {
        body.mode = mode;
      }
      if (command === 'backup' && nrcCsv.trim()) {
        body.nrcCsv = nrcCsv.trim();
      }
      if (command === 'backup' && loginWaitSeconds.trim()) {
        body.loginWaitSeconds = Number(loginWaitSeconds);
      }
      if (command === 'backup' && backupTimeout.trim()) {
        body.backupTimeout = Number(backupTimeout);
      }
      if (command === 'backup' && keepOpen) {
        body.keepOpen = true;
      }

      await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setMessage('Ejecucion sidecar iniciada.');
      const st = await fetchJson<SidecarStatus>(`${apiBase}/integrations/moodle-sidecar/run/status`);
      setStatus(st);
    } catch (error) {
      setMessage(`No se pudo iniciar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelRun() {
    try {
      setActionLoading(true);
      setMessage('');
      await fetchJson(`${apiBase}/integrations/moodle-sidecar/run/cancel`, {
        method: 'POST',
      });
      setMessage('Cancelacion enviada.');
      const st = await fetchJson<SidecarStatus>(`${apiBase}/integrations/moodle-sidecar/run/status`);
      setStatus(st);
    } catch (error) {
      setMessage(`No se pudo cancelar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function importToSystem() {
    try {
      setActionLoading(true);
      setMessage('');
      const body: Record<string, unknown> = {
        dryRun: importDryRun,
      };
      if (importPath.trim()) body.inputPath = importPath.trim();
      if (importSource.trim()) body.sourceLabel = importSource.trim();
      const result = await fetchJson(`${apiBase}/integrations/moodle-sidecar/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setImportResult(result);
      setMessage('Importacion sidecar completada.');
    } catch (error) {
      setMessage(`No se pudo importar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <article className="panel">
      <h2>Integracion Sidecar Moodle</h2>
      <div className="actions">
        Ejecuta clasificacion/revalidacion/backups desde la web y luego importa resultados al sistema.
        <br />
        Si el navegador pide autenticacion Microsoft, inicia sesion ahi: el proceso espera automaticamente (sin ENTER en consola).
      </div>

      <div className="controls" style={{ marginTop: 8 }}>
        <button onClick={loadAll} disabled={loading || actionLoading}>
          {loading ? 'Actualizando...' : 'Actualizar estado'}
        </button>
      </div>

      <div className="actions" style={{ marginTop: 6 }}>
        <span className="code">Config: {config?.configPath ?? 'N/A'}</span>
      </div>
      <div className="badges" style={{ marginTop: 8 }}>
        <span className="badge">Running: {status?.running ? 'SI' : 'NO'}</span>
        {status?.current ? <span className="badge">Actual: {status.current.command}</span> : null}
        {status?.lastRun ? <span className="badge">Ultima: {status.lastRun.command}</span> : null}
      </div>

      <div className="subtitle">1) Ejecutar sidecar</div>
      <div className="controls">
        <label>
          Comando
          <select value={command} onChange={(event) => setCommand(event.target.value as SidecarRunCommand)}>
            <option value="classify">classify</option>
            <option value="revalidate">revalidate</option>
            <option value="backup">backup</option>
            <option value="gui">gui</option>
          </select>
        </label>
        <label>
          Workers
          <input value={workers} onChange={(event) => setWorkers(event.target.value)} placeholder="3" />
        </label>
        <label>
          Browser
          <select value={browser} onChange={(event) => setBrowser(event.target.value as 'edge' | 'chrome')}>
            <option value="edge">edge</option>
            <option value="chrome">chrome</option>
          </select>
        </label>
        <label>
          Python
          <input value={python} onChange={(event) => setPython(event.target.value)} placeholder="python3" />
        </label>
      </div>

      {command === 'classify' ? (
        <div className="controls" style={{ marginTop: 8 }}>
          <label style={{ minWidth: 280 }}>
            input-dir
            <input value={inputDir} onChange={(event) => setInputDir(event.target.value)} placeholder="storage/inputs/rpaca_csv" />
          </label>
          <label style={{ minWidth: 340 }}>
            output
            <input
              value={output}
              onChange={(event) => setOutput(event.target.value)}
              placeholder="storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE.xlsx"
            />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} />
            <span>headless</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={noResume} onChange={(event) => setNoResume(event.target.checked)} />
            <span>no-resume</span>
          </label>
        </div>
      ) : null}

      {command === 'revalidate' ? (
        <div className="controls" style={{ marginTop: 8 }}>
          <label>
            mode
            <select value={mode} onChange={(event) => setMode(event.target.value as RevalidateMode)}>
              <option value="ambos">ambos</option>
              <option value="sin_matricula">sin_matricula</option>
              <option value="aulas_vacias">aulas_vacias</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={headless} onChange={(event) => setHeadless(event.target.checked)} />
            <span>headless</span>
          </label>
        </div>
      ) : null}

      {command === 'backup' ? (
        <div className="controls" style={{ marginTop: 8 }}>
          <label style={{ minWidth: 340 }}>
            nrc-csv
            <input value={nrcCsv} onChange={(event) => setNrcCsv(event.target.value)} placeholder="tools/moodle-sidecar/nrcs.csv" />
          </label>
          <label>
            login-wait (s)
            <input value={loginWaitSeconds} onChange={(event) => setLoginWaitSeconds(event.target.value)} placeholder="300" />
          </label>
          <label>
            backup-timeout (s)
            <input value={backupTimeout} onChange={(event) => setBackupTimeout(event.target.value)} placeholder="240" />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={keepOpen} onChange={(event) => setKeepOpen(event.target.checked)} />
            <span>keep-open</span>
          </label>
        </div>
      ) : null}

      <div className="controls" style={{ marginTop: 10 }}>
        <button onClick={startRun} disabled={!canStart}>
          {actionLoading ? 'Procesando...' : 'Iniciar comando'}
        </button>
        <button onClick={cancelRun} disabled={!status?.running || actionLoading}>
          Cancelar ejecucion
        </button>
      </div>

      <div className="subtitle">2) Importar resultado sidecar a BD</div>
      <div className="controls">
        <label style={{ minWidth: 420 }}>
          inputPath (csv/xlsx/json, opcional)
          <input
            value={importPath}
            onChange={(event) => setImportPath(event.target.value)}
            placeholder="storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE.csv"
          />
        </label>
        <label>
          sourceLabel
          <input value={importSource} onChange={(event) => setImportSource(event.target.value)} placeholder="ui-sidecar" />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={importDryRun} onChange={(event) => setImportDryRun(event.target.checked)} />
          <span>dry-run</span>
        </label>
        <button onClick={importToSystem} disabled={actionLoading || status?.running}>
          {actionLoading ? 'Procesando...' : 'Importar'}
        </button>
      </div>

      {message ? <div className="message">{message}</div> : null}

      {status?.logTail ? (
        <>
          <div className="subtitle">Log (tail)</div>
          <pre className="log-box">{status.logTail}</pre>
        </>
      ) : null}

      {importResult ? (
        <>
          <div className="subtitle">Resultado import</div>
          <pre className="log-box">{JSON.stringify(importResult, null, 2)}</pre>
        </>
      ) : null}
    </article>
  );
}
