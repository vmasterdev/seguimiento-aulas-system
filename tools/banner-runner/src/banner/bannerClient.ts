import { access } from "node:fs/promises";

import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from "playwright";

import type { BannerProfile } from "../config/bannerProfile.js";
import type { AppConfig } from "../config/env.js";
import type {
  BannerCredentials,
  BannerEnrollmentCoursePayload,
  BannerPersonPayload,
  LookupRequest,
  LookupResultPayload
} from "../core/types.js";
import type { AppLogger } from "../logging/logger.js";
import { BannerBackendMessageClient } from "./backendMessageClient.js";
import { LoginPage } from "./pages/LoginPage.js";
import { NrcSearchPage } from "./pages/NrcSearchPage.js";

export interface LookupAutomationSession {
  page: Page;
  lookup(request: LookupRequest): Promise<LookupResultPayload>;
  fetchEnrollment?(request: LookupRequest): Promise<BannerEnrollmentCoursePayload>;
  fetchPerson?(personId: string): Promise<BannerPersonPayload>;
}

export class BannerAutomationSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private backendClient: BannerBackendMessageClient | null = null;
  page!: Page;

  constructor(
    private readonly config: AppConfig,
    private readonly profile: BannerProfile,
    private readonly logger: AppLogger
  ) {}

  async open(options: { headless?: boolean; ignoreStorageState?: boolean } = {}): Promise<void> {
    if (this.config.banner.remoteDebuggingUrl) {
      this.browser = await chromium.connectOverCDP(this.config.banner.remoteDebuggingUrl);
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
      const existingPages = this.context.pages();
      this.page =
        existingPages.find((candidate) => candidate.url().startsWith(this.config.banner.baseUrl)) ??
        existingPages.find((candidate) => candidate.url().startsWith(this.config.banner.loginUrl)) ??
        existingPages[0] ??
        (await this.context.newPage());
      this.page.setDefaultNavigationTimeout(this.config.banner.navigationTimeoutMs);
      this.page.setDefaultTimeout(this.config.banner.actionTimeoutMs);
      return;
    }

    const launchOptions: LaunchOptions = {
      headless: options.headless ?? this.config.banner.headless,
      slowMo: this.config.banner.slowMoMs,
      ...(this.config.banner.browserChannel ? { channel: this.config.banner.browserChannel } : {})
    };
    const storageStatePath =
      options.ignoreStorageState === true
        ? null
        : await this.resolveStorageStatePath(this.config.banner.storageStatePath);

    if (storageStatePath) {
      this.browser = await chromium.launch(launchOptions);
      this.context = await this.browser.newContext({
        storageState: storageStatePath
      });
      this.page = await this.context.newPage();
    } else {
      this.context = await chromium.launchPersistentContext(
        this.config.banner.browserProfileDir,
        launchOptions
      );
      this.browser = this.context.browser();
      this.page = this.context.pages()[0] ?? (await this.context.newPage());
    }

    this.page.setDefaultNavigationTimeout(this.config.banner.navigationTimeoutMs);
    this.page.setDefaultTimeout(this.config.banner.actionTimeoutMs);
    if (this.config.banner.lookupEngine === "backend") {
      this.backendClient = new BannerBackendMessageClient(this.page, this.config, this.logger);
    }
  }

  async openLoginPage(): Promise<void> {
    const loginPage = new LoginPage(this.page, this.profile, this.logger, {
      navigationTimeoutMs: this.config.banner.navigationTimeoutMs,
      actionTimeoutMs: this.config.banner.actionTimeoutMs
    });

    await loginPage.open();
  }

  async isAuthenticated(timeoutMs = Math.min(this.config.banner.actionTimeoutMs, 3000)): Promise<boolean> {
    const loginPage = new LoginPage(this.page, this.profile, this.logger, {
      navigationTimeoutMs: this.config.banner.navigationTimeoutMs,
      actionTimeoutMs: this.config.banner.actionTimeoutMs
    });

    return loginPage.isAuthenticated(timeoutMs);
  }

  async saveStorageState(): Promise<string> {
    if (!this.context) {
      throw new Error("No hay contexto de navegador inicializado");
    }

    await this.context.storageState({
      path: this.config.banner.storageStatePath
    });

    return this.config.banner.storageStatePath;
  }

  private async pageBodyText(): Promise<string> {
    return (await this.page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  }

  private pageRequiresMicrosoftLogin(currentUrl: string, pageText: string): boolean {
    return (
      /commonauth|login\.microsoftonline\.com/i.test(currentUrl) ||
      /Iniciar sesion en la cuenta|Sign in to your account|Use another account|Usar otra cuenta/i.test(
        pageText
      )
    );
  }

  private pageHasRemoteServiceFailure(pageText: string): boolean {
    return /Service Invocation Failed|Couldn't access remote service/i.test(pageText);
  }

  private async ensureApplicationNavigatorReady(expectAuthenticated: boolean): Promise<boolean> {
    await this.page.goto(this.config.banner.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.config.banner.navigationTimeoutMs
    });
    await this.page.waitForLoadState("networkidle").catch(() => undefined);

    const currentUrl = this.page.url();
    const pageText = await this.pageBodyText();

    if (this.pageRequiresMicrosoftLogin(currentUrl, pageText)) {
      if (expectAuthenticated) {
        throw new Error(
          `La sesion Banner sigue pidiendo autenticacion Microsoft. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`
        );
      }

      return false;
    }

    if (this.pageHasRemoteServiceFailure(pageText)) {
      throw new Error(
        `Banner cargo 'Service Invocation Failed' en applicationNavigator. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`
      );
    }

    return true;
  }

  private async warmBannerWorkspace(): Promise<void> {
    await this.page.goto(this.config.banner.searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.config.banner.navigationTimeoutMs
    });
    await this.page.waitForLoadState("networkidle").catch(() => undefined);

    const currentUrl = this.page.url();
    const pageText = await this.pageBodyText();

    if (this.pageRequiresMicrosoftLogin(currentUrl, pageText)) {
      throw new Error(
        `La sesion Banner expiro o regreso a Microsoft al abrir SSASECT. URL actual: ${currentUrl}. Vista: ${pageText.slice(0, 180)}`
      );
    }

    if (this.pageHasRemoteServiceFailure(pageText)) {
      this.logger.warn(
        "Banner cargo SSASECT con 'Service Invocation Failed'; se intentara bootstrap backend por REST"
      );
      return;
    }
  }

  async login(credentials: BannerCredentials): Promise<void> {
    const loginPage = new LoginPage(this.page, this.profile, this.logger, {
      navigationTimeoutMs: this.config.banner.navigationTimeoutMs,
      actionTimeoutMs: this.config.banner.actionTimeoutMs
    });

    if (this.config.banner.lookupEngine === "backend") {
      const restoredFromStorageState = await this.ensureApplicationNavigatorReady(false);

      if (restoredFromStorageState) {
        await this.warmBannerWorkspace();
        this.logger.info("Sesion restaurada desde storageState");
        return;
      }

      await loginPage.open();
      await loginPage.login(credentials);
      await this.ensureApplicationNavigatorReady(true);
      await this.warmBannerWorkspace();
      this.logger.info("Sesion autenticada y applicationNavigator disponible");
      return;
    }

    await this.page.goto(this.config.banner.searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.config.banner.navigationTimeoutMs
    });

    const alreadyAuthenticated = await loginPage.isAuthenticated(
      Math.min(this.config.banner.navigationTimeoutMs, 10000)
    );

    if (alreadyAuthenticated) {
      this.logger.info("Sesion restaurada desde storageState");
      return;
    }

    await loginPage.open();
    await loginPage.login(credentials);

    await this.page.goto(this.config.banner.searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.config.banner.navigationTimeoutMs
    });

    const authenticatedAfterLogin = await loginPage.isAuthenticated(
      Math.min(this.config.banner.navigationTimeoutMs, 10000)
    );

    if (!authenticatedAfterLogin) {
      const pageText = await this.page.locator("body").innerText().catch(() => "");
      throw new Error(
        `El login de Banner termino, pero SSASECT no quedo disponible. URL actual: ${
          this.page.url()
        }. Vista: ${pageText.slice(0, 180).replace(/\s+/g, " ").trim()}`
      );
    }

    this.logger.info("Sesion autenticada y SSASECT disponible");
  }

  async prepareLookup(): Promise<void> {
    if (this.config.banner.lookupEngine === "backend") {
      await this.ensureApplicationNavigatorReady(true);
      await this.warmBannerWorkspace();
      await this.backendClient?.initialize();
      return;
    }

    const searchPage = new NrcSearchPage(this.page, this.profile, this.logger, {
      navigationTimeoutMs: this.config.banner.navigationTimeoutMs,
      actionTimeoutMs: this.config.banner.actionTimeoutMs
    });

    await searchPage.open();
  }

  async lookup(request: LookupRequest): Promise<LookupResultPayload> {
    if (this.config.banner.lookupEngine === "backend") {
      if (!this.backendClient) {
        this.backendClient = new BannerBackendMessageClient(this.page, this.config, this.logger);
      }

      return this.backendClient.lookup(request);
    }

    const searchPage = new NrcSearchPage(this.page, this.profile, this.logger, {
      navigationTimeoutMs: this.config.banner.navigationTimeoutMs,
      actionTimeoutMs: this.config.banner.actionTimeoutMs
    });

    return searchPage.lookup(request);
  }

  async fetchEnrollment(request: LookupRequest): Promise<BannerEnrollmentCoursePayload> {
    if (this.config.banner.lookupEngine !== "backend") {
      throw new Error("La exportacion de matricula Banner solo esta soportada con lookupEngine=backend.");
    }

    if (!this.backendClient) {
      this.backendClient = new BannerBackendMessageClient(this.page, this.config, this.logger);
    }

    return this.backendClient.fetchEnrollment(request);
  }

  async fetchPerson(personId: string): Promise<BannerPersonPayload> {
    if (this.config.banner.lookupEngine !== "backend") {
      throw new Error("La consulta SPAIDEN solo esta soportada con lookupEngine=backend.");
    }

    if (!this.backendClient) {
      this.backendClient = new BannerBackendMessageClient(this.page, this.config, this.logger);
    }

    return this.backendClient.fetchPerson(personId);
  }

  async createParallelLookupSessions(workerCount: number): Promise<LookupAutomationSession[]> {
    if (this.config.banner.lookupEngine !== "backend") {
      return [this];
    }

    if (!this.backendClient) {
      this.backendClient = new BannerBackendMessageClient(this.page, this.config, this.logger);
      await this.backendClient.initialize();
    }

    const sessions: LookupAutomationSession[] = [
      {
        page: this.page,
        lookup: (request: LookupRequest) => this.lookup(request)
      }
    ];

    for (let index = 1; index < workerCount; index += 1) {
      const taskClient = this.backendClient.fork();
      await taskClient.initialize();
      sessions.push({
        page: this.page,
        lookup: (request: LookupRequest) => taskClient.lookup(request)
      });
    }

    return sessions;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }

  private async resolveStorageStatePath(storageStatePath: string): Promise<string | null> {
    try {
      await access(storageStatePath);
      return storageStatePath;
    } catch {
      return null;
    }
  }
}

export class BannerClient {
  constructor(
    private readonly config: AppConfig,
    private readonly profile: BannerProfile,
    private readonly logger: AppLogger
  ) {}

  async createSession(options: { headless?: boolean; ignoreStorageState?: boolean } = {}): Promise<BannerAutomationSession> {
    const session = new BannerAutomationSession(this.config, this.profile, this.logger);
    await session.open(options);
    return session;
  }
}
