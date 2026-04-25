#!/usr/bin/env node

const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

function requireProjectPackage(packageName) {
  const directPath = path.join(__dirname, "..", "node_modules", packageName);
  try {
    return require(directPath);
  } catch {
    // Intenta resolver via pnpm store real en lugar del symlink Linux.
  }

  const pnpmRoot = path.join(__dirname, "..", "node_modules", ".pnpm");
  try {
    const entry = fsSync
      .readdirSync(pnpmRoot, { withFileTypes: true })
      .find((item) => item.isDirectory() && item.name.startsWith(`${packageName}@`));
    if (entry) {
      return require(path.join(pnpmRoot, entry.name, "node_modules", packageName));
    }
  } catch {
    // Continua al fallback final.
  }

  return require(packageName);
}

requireProjectPackage("dotenv").config();

const { chromium } = requireProjectPackage("playwright");

const execFileAsync = promisify(execFile);
const EDGE_REMOTE_DEBUGGING_TIMEOUT_MS = 120000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function resolveEnvPath(filePath, fallbackPath) {
  const candidate = filePath && String(filePath).trim() ? String(filePath).trim() : fallbackPath;
  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(process.cwd(), candidate);
}

async function waitForRemoteDebugging(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Edge todavia no expone el endpoint.
    }

    await sleep(500);
  }

  throw new Error(`No fue posible conectar con Edge en ${url} dentro de ${timeoutMs}ms`);
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findRemoteDebuggingPort() {
  for (let port = 9222; port <= 9299; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error("No fue posible encontrar un puerto libre para remote debugging de Edge.");
}

async function launchEdgeForManualLogin({ edgeExecutable, userDataDir, loginUrl, remoteDebuggingPort }) {
  const command =
    `$edge = ${quotePowerShell(edgeExecutable)}; ` +
    `$dir = ${quotePowerShell(userDataDir)}; ` +
    `Start-Process -FilePath $edge -ArgumentList @(` +
    `'--remote-debugging-port=${remoteDebuggingPort}',` +
    `'--remote-debugging-address=0.0.0.0',` +
    `'--remote-allow-origins=*',` +
    `'--no-first-run',` +
    `'--no-default-browser-check',` +
    `('--user-data-dir=' + $dir),` +
    `'--new-window',` +
    `${quotePowerShell(loginUrl)}` +
    `)`;

  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: process.cwd()
  });
}

async function resolveWindowsTempDir() {
  if (process.platform === "win32") {
    return process.env.TEMP || process.env.TMP || "C:\\Windows\\Temp";
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", "[System.IO.Path]::GetTempPath()"],
    { cwd: process.cwd() }
  );
  const value = String(stdout ?? "").trim();
  return value || "C:\\Windows\\Temp";
}

async function toWindowsWslPath(filePath) {
  if (process.platform === "win32") {
    return filePath;
  }

  const { stdout } = await execFileAsync("wslpath", ["-w", filePath], {
    cwd: process.cwd()
  });
  return String(stdout ?? "").trim() || filePath;
}

async function ensureWindowsProxy({ listenPort, targetPort }) {
  if (process.platform === "win32") {
    return;
  }

  const proxyScriptPath = await toWindowsWslPath(path.join(__dirname, "cdp-port-proxy.cjs"));
  const windowsNodePath =
    process.env.BANNER_WINDOWS_NODE_PATH ?? "C:\\Program Files\\nodejs\\node.exe";
  const command =
    `$node = ${quotePowerShell(windowsNodePath)}; ` +
    `$script = ${quotePowerShell(proxyScriptPath)}; ` +
    `Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList @(` +
    `${quotePowerShell(proxyScriptPath)},` +
    `'0.0.0.0',` +
    `${quotePowerShell(String(listenPort))},` +
    `'127.0.0.1',` +
    `${quotePowerShell(String(targetPort))}` +
    `)`;

  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: process.cwd()
  });
}

async function resolveRemoteDebuggingConfig() {
  const explicit = String(process.env.BANNER_REMOTE_DEBUGGING_URL ?? "").trim();
  if (explicit) {
    return {
      remoteDebuggingPort: Number.parseInt(new URL(explicit).port || "9222", 10),
      remoteDebuggingUrl: explicit,
      proxyPort: Number.parseInt(process.env.BANNER_REMOTE_DEBUGGING_PROXY_PORT ?? "9223", 10)
    };
  }

  const explicitPort = process.env.BANNER_REMOTE_DEBUGGING_PORT
    ? Number.parseInt(process.env.BANNER_REMOTE_DEBUGGING_PORT, 10)
    : null;
  const remoteDebuggingPort = Number.isFinite(explicitPort) ? explicitPort : 9222;
  const proxyPort = Number.parseInt(process.env.BANNER_REMOTE_DEBUGGING_PROXY_PORT ?? "9223", 10);

  if (process.platform === "win32") {
    return {
      remoteDebuggingPort,
      remoteDebuggingUrl: `http://127.0.0.1:${remoteDebuggingPort}`,
      proxyPort
    };
  }

  try {
    const { stdout } = await execFileAsync(
      "sh",
      ["-lc", "ip route show default | awk '{print $3; exit}'"],
      { cwd: process.cwd() }
    );
    const hostIp = String(stdout ?? "").trim();
    if (hostIp) {
      return {
        remoteDebuggingPort,
        remoteDebuggingUrl: `http://${hostIp}:${proxyPort}`,
        proxyPort
      };
    }
  } catch {
    // Usa fallback localhost si no se pudo detectar la IP del host de Windows.
  }

  return {
    remoteDebuggingPort,
    remoteDebuggingUrl: `http://127.0.0.1:${remoteDebuggingPort}`,
    proxyPort
  };
}

async function getBodyText(page) {
  try {
    return await page.locator("body").innerText();
  } catch {
    return "";
  }
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function pageRequiresMicrosoftLogin(currentUrl, pageText) {
  return (
    /commonauth|login\.microsoftonline\.com/i.test(currentUrl) ||
    /sign in|inicia sesi[oó]n|microsoft|autenticaci[oó]n|approve sign in request|aprobar la solicitud/i.test(
      pageText
    )
  );
}

function pageHasRemoteServiceError(pageText) {
  return /service invocation failed|couldn't access remote service/i.test(pageText);
}

async function ensureApplicationNavigatorReady(page, loginUrl, navigationTimeoutMs) {
  await page.goto(loginUrl, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const currentUrl = page.url();
  const pageText = normalizeText(await getBodyText(page));

  if (pageRequiresMicrosoftLogin(currentUrl, pageText)) {
    throw new Error(
      `La sesion Banner sigue pidiendo autenticacion Microsoft. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`
    );
  }

  if (pageHasRemoteServiceError(pageText)) {
    throw new Error(
      `Banner cargo 'Service Invocation Failed' en applicationNavigator. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`
    );
  }
}

async function warmBannerWorkspace(page, searchUrl, navigationTimeoutMs) {
  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const currentUrl = page.url();
  const pageText = normalizeText(await getBodyText(page));

  if (pageRequiresMicrosoftLogin(currentUrl, pageText)) {
    throw new Error(
      `La sesion Banner expiro o regreso a Microsoft al abrir SSASECT. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`
    );
  }

  if (pageHasRemoteServiceError(pageText)) {
    console.log(
      "[warn] SSASECT devolvio 'Service Invocation Failed'; se guardara la sesion y el backend hara bootstrap por REST."
    );
    return;
  }
}

async function loadSessionInfo(authSessionPath) {
  const raw = await fs.readFile(authSessionPath, "utf8");
  return JSON.parse(raw);
}

async function saveSessionInfo(authSessionPath, payload) {
  await fs.mkdir(path.dirname(authSessionPath), { recursive: true });
  await fs.writeFile(authSessionPath, JSON.stringify(payload, null, 2), "utf8");
}

async function connectToBanner(metadata) {
  await waitForRemoteDebugging(metadata.remoteDebuggingUrl, EDGE_REMOTE_DEBUGGING_TIMEOUT_MS);

  const browser = await chromium.connectOverCDP(metadata.remoteDebuggingUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const existingPages = context.pages();
  const page =
    existingPages.find((candidate) => candidate.url().startsWith(metadata.baseUrl)) ??
    existingPages.find((candidate) => candidate.url().startsWith(metadata.loginUrl)) ??
    existingPages[0] ??
    (await context.newPage());

  page.setDefaultNavigationTimeout(metadata.navigationTimeoutMs);
  page.setDefaultTimeout(metadata.actionTimeoutMs);

  return { browser, context, page };
}

async function startManualAuth(options) {
  const {
    authSessionPath,
    edgeExecutable,
    loginUrl,
    remoteDebuggingPort,
    remoteDebuggingUrl,
    storageStatePath,
    userDataDir,
    baseUrl,
    searchUrl,
    navigationTimeoutMs,
    actionTimeoutMs
  } = options;

  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  await launchEdgeForManualLogin({
    edgeExecutable,
    userDataDir,
    loginUrl,
    remoteDebuggingPort
  });
  await ensureWindowsProxy({
    listenPort: options.proxyPort,
    targetPort: remoteDebuggingPort
  });

  await saveSessionInfo(authSessionPath, {
    startedAt: new Date().toISOString(),
    remoteDebuggingPort,
    remoteDebuggingUrl,
    userDataDir,
    loginUrl,
    searchUrl,
    baseUrl,
    storageStatePath,
    navigationTimeoutMs,
    actionTimeoutMs
  });

  try {
    await waitForRemoteDebugging(remoteDebuggingUrl, 15000);
  } catch (error) {
    console.warn(
      `[warn] Edge abrio la ventana de login, pero el endpoint CDP aun no responde en ${remoteDebuggingUrl}. ` +
        `Podras usar 'Guardar sesion Banner' cuando termines el login.`
    );
  }

  console.log(
    "Completa el login y el 2FA en Edge para Banner/Microsoft. Cuando termines, vuelve al sistema y pulsa Guardar sesion Banner."
  );
  console.log(
    JSON.stringify(
      {
        authSessionPath,
        remoteDebuggingUrl,
        userDataDir,
        storageStatePath
      },
      null,
      2
    )
  );
}

async function confirmManualAuth(authSessionPath) {
  const metadata = await loadSessionInfo(authSessionPath);
  const { browser, context, page } = await connectToBanner(metadata);

  try {
    await ensureApplicationNavigatorReady(page, metadata.loginUrl, metadata.navigationTimeoutMs);
    await warmBannerWorkspace(page, metadata.searchUrl, metadata.navigationTimeoutMs);
    await context.storageState({ path: metadata.storageStatePath });
    await fs.unlink(authSessionPath).catch(() => undefined);

    console.log(
      JSON.stringify(
        {
          storageStatePath: metadata.storageStatePath,
          remoteDebuggingUrl: metadata.remoteDebuggingUrl
        },
        null,
        2
      )
    );
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function interactiveManualAuth(options) {
  const { authSessionPath, loginUrl, baseUrl, navigationTimeoutMs, actionTimeoutMs } = options;
  await startManualAuth(options);

  const rl = readline.createInterface({ input, output });

  try {
    await rl.question("");
  } finally {
    rl.close();
  }

  const metadata = await loadSessionInfo(authSessionPath).catch(() => ({
    remoteDebuggingUrl: options.remoteDebuggingUrl,
    loginUrl,
    baseUrl,
    storageStatePath: options.storageStatePath,
    searchUrl: options.searchUrl,
    navigationTimeoutMs,
    actionTimeoutMs
  }));

  const { browser, context, page } = await connectToBanner(metadata);
  try {
    await ensureApplicationNavigatorReady(page, metadata.loginUrl, metadata.navigationTimeoutMs);
    await warmBannerWorkspace(page, metadata.searchUrl, metadata.navigationTimeoutMs);
    await context.storageState({ path: metadata.storageStatePath });
    await fs.unlink(authSessionPath).catch(() => undefined);

    console.log(JSON.stringify({ storageStatePath: metadata.storageStatePath, rootDir: process.cwd() }, null, 2));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function main() {
  const rootDir = process.cwd();
  const mode = String(process.argv[2] ?? "interactive").trim().toLowerCase();
  const loginUrl =
    process.env.BANNER_LOGIN_URL ??
    "https://genesisadmin.uniminuto.edu/applicationNavigator/seamless";
  const searchUrl =
    process.env.BANNER_SEARCH_URL ??
    "https://genesisadmin.uniminuto.edu/BannerAdmin/?form=SSASECT&ban_args=&ban_mode=xe";
  const baseUrl = process.env.BANNER_BASE_URL ?? "https://genesisadmin.uniminuto.edu";
  const storageStatePath = resolveEnvPath(
    process.env.BANNER_STORAGE_STATE_PATH,
    "storage/auth/banner-storage-state.json"
  );
  const authSessionPath = resolveEnvPath(
    process.env.BANNER_AUTH_SESSION_PATH,
    "storage/auth/banner-auth-session.json"
  );
  const navigationTimeoutMs = Number.parseInt(
    process.env.BANNER_NAVIGATION_TIMEOUT_MS ?? "30000",
    10
  );
  const actionTimeoutMs = Number.parseInt(process.env.BANNER_ACTION_TIMEOUT_MS ?? "10000", 10);
  const edgeExecutable =
    process.env.BANNER_EDGE_EXECUTABLE ??
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const { remoteDebuggingUrl, remoteDebuggingPort, proxyPort } = await resolveRemoteDebuggingConfig();
  const windowsTempDir = await resolveWindowsTempDir();
  const userDataDir = path.win32.join(
    windowsTempDir,
    `banner-docente-edge-profile-${Date.now()}`
  );
  const options = {
    rootDir,
    authSessionPath,
    loginUrl,
    searchUrl,
    baseUrl,
    storageStatePath,
    navigationTimeoutMs,
    actionTimeoutMs,
    edgeExecutable,
    remoteDebuggingPort,
    remoteDebuggingUrl,
    proxyPort,
    userDataDir
  };

  if (mode === "start") {
    await startManualAuth(options);
    return;
  }

  if (mode === "confirm") {
    await confirmManualAuth(authSessionPath);
    return;
  }

  await interactiveManualAuth(options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
