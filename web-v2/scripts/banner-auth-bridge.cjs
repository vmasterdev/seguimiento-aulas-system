#!/usr/bin/env node

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");
const BRIDGE_RUNTIME_NODE_MODULES = path.join(
  WORKSPACE_ROOT,
  "storage",
  "runtime",
  "banner",
  "auth-bridge",
  "node-runtime",
  "node_modules",
);
const EDGE_REMOTE_DEBUGGING_TIMEOUT_MS = 120000;
const AUTH_STATUS_POLL_INTERVAL_MS = 2000;
const AUTH_WATCH_TIMEOUT_MS = 15 * 60 * 1000;

function requireWorkspacePackage(packageName) {
  const directCandidates = [
    path.join(BRIDGE_RUNTIME_NODE_MODULES, packageName),
    path.join(WORKSPACE_ROOT, "node_modules", packageName),
  ];
  for (const candidate of directCandidates) {
    try {
      return require(candidate);
    } catch {
      // Prueba el siguiente candidato.
    }
  }

  const pnpmRoot = path.join(WORKSPACE_ROOT, "node_modules", ".pnpm");
  try {
    const entry = fsSync
      .readdirSync(pnpmRoot, { withFileTypes: true })
      .find((item) => item.isDirectory() && item.name.startsWith(`${packageName}@`));
    if (entry) {
      return require(path.join(pnpmRoot, entry.name, "node_modules", packageName));
    }
  } catch {
    // Sigue con otros candidatos.
  }

  const appCandidates = [
    path.join(WORKSPACE_ROOT, "apps", "worker", "node_modules", packageName),
    path.join(WORKSPACE_ROOT, "apps", "api", "node_modules", packageName),
  ];
  for (const candidate of appCandidates) {
    try {
      return require(candidate);
    } catch {
      // Prueba el siguiente.
    }
  }

  return require(packageName);
}

const { chromium } = requireWorkspacePackage("playwright");

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

  return path.resolve(WORKSPACE_ROOT, candidate);
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

async function launchEdgeForManualLogin({ edgeExecutable, userDataDir, loginUrl, remoteDebuggingPort }) {
  const command =
    `$edge = ${quotePowerShell(edgeExecutable)}; ` +
    `$dir = ${quotePowerShell(userDataDir)}; ` +
    `Start-Process -FilePath $edge -ArgumentList @(` +
    `'--remote-debugging-port=${remoteDebuggingPort}',` +
    `'--remote-debugging-address=127.0.0.1',` +
    `'--remote-allow-origins=*',` +
    `'--no-first-run',` +
    `'--no-default-browser-check',` +
    `('--user-data-dir=' + $dir),` +
    `'--new-window',` +
    `${quotePowerShell(loginUrl)}` +
    `)`;

  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: WORKSPACE_ROOT,
  });
}

function resolveAuthStatusPath(authSessionPath) {
  return path.join(path.dirname(authSessionPath), "banner-auth-status.json");
}

async function writeAuthStatus(authSessionPath, payload) {
  await saveJson(resolveAuthStatusPath(authSessionPath), payload);
}

async function readAuthStatus(authSessionPath) {
  return loadJson(resolveAuthStatusPath(authSessionPath));
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

async function getBodyText(page) {
  try {
    return await page.locator("body").innerText();
  } catch {
    return "";
  }
}

function pageRequiresMicrosoftLogin(currentUrl, pageText) {
  return (
    /commonauth|login\.microsoftonline\.com/i.test(currentUrl) ||
    /sign in|inicia sesi[oó]n|microsoft|autenticaci[oó]n|approve sign in request|aprobar la solicitud/i.test(
      pageText,
    )
  );
}

function pageHasRemoteServiceError(pageText) {
  return /service invocation failed|couldn't access remote service/i.test(pageText);
}

async function ensureApplicationNavigatorReady(page, loginUrl, navigationTimeoutMs) {
  await page.goto(loginUrl, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const currentUrl = page.url();
  const pageText = normalizeText(await getBodyText(page));

  if (pageRequiresMicrosoftLogin(currentUrl, pageText)) {
    throw new Error(
      `La sesion Banner sigue pidiendo autenticacion Microsoft. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`,
    );
  }

  if (pageHasRemoteServiceError(pageText)) {
    throw new Error(
      `Banner cargo 'Service Invocation Failed' en applicationNavigator. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`,
    );
  }
}

async function warmBannerWorkspace(page, searchUrl, navigationTimeoutMs) {
  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: navigationTimeoutMs,
  });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const currentUrl = page.url();
  const pageText = normalizeText(await getBodyText(page));

  if (pageRequiresMicrosoftLogin(currentUrl, pageText)) {
    throw new Error(
      `La sesion Banner expiro o regreso a Microsoft al abrir SSASECT. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`,
    );
  }

  if (pageHasRemoteServiceError(pageText)) {
    console.log(
      "[warn] SSASECT devolvio 'Service Invocation Failed'; se guardara la sesion y el backend hara bootstrap por REST.",
    );
  }
}

async function saveJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadSessionInfo(authSessionPath) {
  return loadJson(authSessionPath);
}

async function saveSessionInfo(authSessionPath, payload) {
  await saveJson(authSessionPath, payload);
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
    actionTimeoutMs,
  } = options;

  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  await fs.unlink(storageStatePath).catch(() => undefined);
  await fs.unlink(resolveAuthStatusPath(authSessionPath)).catch(() => undefined);

  const metadata = {
    startedAt: new Date().toISOString(),
    remoteDebuggingPort,
    userDataDir,
    loginUrl,
    searchUrl,
    baseUrl,
    storageStatePath,
    navigationTimeoutMs,
    actionTimeoutMs,
    edgeExecutable,
    watchTimeoutMs: AUTH_WATCH_TIMEOUT_MS,
  };
  await saveSessionInfo(authSessionPath, metadata);
  await writeAuthStatus(authSessionPath, {
    state: "PENDING",
    startedAt: metadata.startedAt,
    updatedAt: new Date().toISOString(),
    storageStatePath,
    userDataDir,
    message: "Abriendo Edge para login Banner.",
  });

  const child = spawn(process.execPath, [__filename, "await-login"], {
    cwd: WORKSPACE_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();

  console.log(
    "Completa el login y el 2FA en Edge para Banner/Microsoft. Cuando termines, vuelve al sistema y pulsa Guardar sesion Banner.",
  );
  console.log(
    JSON.stringify(
      {
        authSessionPath,
        userDataDir,
        storageStatePath,
        helperPid: child.pid ?? null,
      },
      null,
      2,
    ),
  );
}

async function confirmManualAuth(authSessionPath) {
  const deadline = Date.now() + EDGE_REMOTE_DEBUGGING_TIMEOUT_MS;
  let lastMessage = "La automatizacion de auth Banner sigue esperando el login.";

  while (Date.now() < deadline) {
    try {
      const status = await readAuthStatus(authSessionPath);
      if (status && typeof status === "object") {
        if (status.state === "READY" && status.storageStatePath) {
          await fs.unlink(authSessionPath).catch(() => undefined);
          await fs.unlink(resolveAuthStatusPath(authSessionPath)).catch(() => undefined);
          console.log(
            JSON.stringify(
              {
                storageStatePath: status.storageStatePath,
                mode: "playwright-persistent",
              },
              null,
              2,
            ),
          );
          return;
        }

        if (status.state === "ERROR") {
          throw new Error(String(status.error || "La automatizacion de auth Banner fallo."));
        }

        if (typeof status.message === "string" && status.message.trim()) {
          lastMessage = status.message.trim();
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/ENOENT|no such file/i.test(message)) {
        throw error;
      }
    }

    await sleep(AUTH_STATUS_POLL_INTERVAL_MS);
  }

  throw new Error(`${lastMessage} No fue posible guardar la sesion Banner dentro de ${EDGE_REMOTE_DEBUGGING_TIMEOUT_MS}ms.`);
}

function pageLooksAuthenticated(currentUrl, pageText, baseUrl) {
  if (!currentUrl || currentUrl === "about:blank") {
    return false;
  }

  if (pageRequiresMicrosoftLogin(currentUrl, pageText)) {
    return false;
  }

  return currentUrl.startsWith(baseUrl) || /applicationnavigator|banneradmin/i.test(currentUrl);
}

async function pickBannerPage(context, metadata) {
  const pages = context.pages();
  return (
    pages.find((candidate) => candidate.url().startsWith(metadata.baseUrl)) ??
    pages.find((candidate) => candidate.url().startsWith(metadata.loginUrl)) ??
    pages[pages.length - 1] ??
    (await context.newPage())
  );
}

async function awaitManualLogin(authSessionPath) {
  const metadata = await loadSessionInfo(authSessionPath);
  const context = await chromium.launchPersistentContext(metadata.userDataDir, {
    headless: false,
    executablePath: metadata.edgeExecutable,
    viewport: null,
    args: ["--no-first-run", "--no-default-browser-check", "--new-window"],
  });

  try {
    let page = await pickBannerPage(context, metadata);
    if (!page.url() || page.url() === "about:blank") {
      await page.goto(metadata.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: metadata.navigationTimeoutMs,
      });
    }

    const deadline = Date.now() + Number(metadata.watchTimeoutMs || AUTH_WATCH_TIMEOUT_MS);
    await writeAuthStatus(authSessionPath, {
      state: "PENDING",
      startedAt: metadata.startedAt,
      updatedAt: new Date().toISOString(),
      storageStatePath: metadata.storageStatePath,
      userDataDir: metadata.userDataDir,
      message: "Completa el login y el MFA en la ventana de Edge abierta por la automatizacion Banner.",
    });

    while (Date.now() < deadline) {
      page = await pickBannerPage(context, metadata);
      const currentUrl = page.url();
      const pageText = normalizeText(await getBodyText(page));

      if (!pageLooksAuthenticated(currentUrl, pageText, metadata.baseUrl)) {
        await writeAuthStatus(authSessionPath, {
          state: "PENDING",
          startedAt: metadata.startedAt,
          updatedAt: new Date().toISOString(),
          storageStatePath: metadata.storageStatePath,
          userDataDir: metadata.userDataDir,
          currentUrl,
          message: "Login Banner aun en progreso en Edge.",
        });
        await sleep(AUTH_STATUS_POLL_INTERVAL_MS);
        continue;
      }

      await warmBannerWorkspace(page, metadata.searchUrl, metadata.navigationTimeoutMs);
      await fs.mkdir(path.dirname(metadata.storageStatePath), { recursive: true });
      await context.storageState({ path: metadata.storageStatePath });
      await writeAuthStatus(authSessionPath, {
        state: "READY",
        startedAt: metadata.startedAt,
        updatedAt: new Date().toISOString(),
        storageStatePath: metadata.storageStatePath,
        userDataDir: metadata.userDataDir,
        currentUrl: page.url(),
        message: "Sesion Banner guardada y lista para reutilizarse.",
      });
      return;
    }

    throw new Error("Tiempo agotado esperando que el login Banner quede autenticado en Edge.");
  } catch (error) {
    await writeAuthStatus(authSessionPath, {
      state: "ERROR",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("banner-auth-bridge.cjs debe ejecutarse con node.exe de Windows.");
  }

  const mode = String(process.argv[2] ?? "start").trim().toLowerCase();
  const loginUrl =
    process.env.BANNER_LOGIN_URL ??
    "https://genesisadmin.uniminuto.edu/applicationNavigator/seamless";
  const searchUrl =
    process.env.BANNER_SEARCH_URL ??
    "https://genesisadmin.uniminuto.edu/BannerAdmin/?form=SSASECT&ban_args=&ban_mode=xe";
  const baseUrl = process.env.BANNER_BASE_URL ?? "https://genesisadmin.uniminuto.edu";
  const storageStatePath = resolveEnvPath(
    process.env.BANNER_STORAGE_STATE_PATH,
    path.join("storage", "runtime", "banner", "auth-bridge", "banner-storage-state.json"),
  );
  const authSessionPath = resolveEnvPath(
    process.env.BANNER_AUTH_SESSION_PATH,
    path.join("storage", "runtime", "banner", "auth-bridge", "banner-auth-session.json"),
  );
  const navigationTimeoutMs = Number.parseInt(process.env.BANNER_NAVIGATION_TIMEOUT_MS ?? "30000", 10);
  const actionTimeoutMs = Number.parseInt(process.env.BANNER_ACTION_TIMEOUT_MS ?? "10000", 10);
  const edgeExecutable =
    process.env.BANNER_EDGE_EXECUTABLE ??
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const remoteDebuggingPort = Number.parseInt(process.env.BANNER_REMOTE_DEBUGGING_PORT ?? "9222", 10);
  const remoteDebuggingUrl = `http://127.0.0.1:${remoteDebuggingPort}`;
  const userDataDir = path.win32.join(
    process.env.TEMP || process.env.TMP || os.tmpdir() || "C:\\Windows\\Temp",
    `banner-docente-edge-profile-${Date.now()}`,
  );
  const options = {
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
    userDataDir,
  };

  if (mode === "probe") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          platform: process.platform,
          workspaceRoot: WORKSPACE_ROOT,
          storageStatePath,
          authSessionPath,
          remoteDebuggingUrl,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === "await-login") {
    await awaitManualLogin(authSessionPath);
    return;
  }

  if (mode === "start") {
    await startManualAuth(options);
    return;
  }

  if (mode === "confirm") {
    await confirmManualAuth(authSessionPath);
    return;
  }

  throw new Error(`Modo de auth Banner no soportado: ${mode}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
