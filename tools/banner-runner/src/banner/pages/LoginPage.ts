import type { Page } from "playwright";

import type { BannerProfile } from "../../config/bannerProfile.js";
import type { BannerCredentials } from "../../core/types.js";
import type { AppLogger } from "../../logging/logger.js";
import { resolveFrameRoot } from "../frameResolver.js";
import { clickFirst, exists, fillFirst } from "../selectors.js";

export class LoginPage {
  constructor(
    private readonly page: Page,
    private readonly profile: BannerProfile,
    private readonly logger: AppLogger,
    private readonly timeouts: {
      navigationTimeoutMs: number;
      actionTimeoutMs: number;
    }
  ) {}

  async open(): Promise<void> {
    await this.page.goto(this.profile.login.url, {
      waitUntil: "domcontentloaded",
      timeout: this.timeouts.navigationTimeoutMs
    });
    await this.assertReadyForLogin();
  }

  async isAuthenticated(timeoutMs: number): Promise<boolean> {
    if (this.profile.login.successIndicators.length === 0) {
      return false;
    }

    return exists(this.page, this.profile.login.successIndicators, timeoutMs);
  }

  async login(credentials: BannerCredentials): Promise<void> {
    if (this.profile.login.successIndicators.length > 0) {
      const alreadyLoggedIn = await this.isAuthenticated(Math.min(this.timeouts.actionTimeoutMs, 3000));

      if (alreadyLoggedIn) {
        this.logger.info("Sesion ya autenticada, se omite login");
        return;
      }
    }

    await this.advanceMicrosoftAccountPicker(credentials.username);

    const root = await resolveFrameRoot(
      this.page,
      this.profile.login.framePath,
      this.timeouts.navigationTimeoutMs
    );

    const usernameVisible = await exists(
      root,
      this.profile.login.username,
      Math.min(this.timeouts.actionTimeoutMs, 2000)
    );

    if (usernameVisible) {
      await fillFirst(
        root,
        this.profile.login.username,
        credentials.username,
        this.timeouts.actionTimeoutMs
      );

      if (this.profile.login.usernameSubmit && this.profile.login.usernameSubmit.length > 0) {
        await clickFirst(root, this.profile.login.usernameSubmit, this.timeouts.actionTimeoutMs);
        await this.page.waitForTimeout(500);
      }
    }

    const passwordRoot = await resolveFrameRoot(
      this.page,
      this.profile.login.framePath,
      this.timeouts.navigationTimeoutMs
    );

    await fillFirst(
      passwordRoot,
      this.profile.login.password,
      credentials.password,
      this.timeouts.actionTimeoutMs
    );

    if (this.profile.login.passwordSubmit && this.profile.login.passwordSubmit.length > 0) {
      await clickFirst(passwordRoot, this.profile.login.passwordSubmit, this.timeouts.actionTimeoutMs);
    } else {
      await clickFirst(passwordRoot, this.profile.login.submit, this.timeouts.actionTimeoutMs);
    }

    if (this.profile.login.staySignedInDecline && this.profile.login.staySignedInDecline.length > 0) {
      await clickFirst(
        this.page,
        this.profile.login.staySignedInDecline,
        Math.min(this.timeouts.actionTimeoutMs, 5000)
      ).catch(() => undefined);
    }

    if (this.profile.login.successIndicators.length > 0) {
      const success = await this.isAuthenticated(this.timeouts.navigationTimeoutMs);

      if (!success) {
        this.logger.warn("No se detecto el indicador esperado despues del login");
      }
    }

    this.logger.info("Login completado");
  }

  private async assertReadyForLogin(): Promise<void> {
    const currentUrl = this.page.url();
    const pageText = await this.page.locator("body").innerText().catch(() => "");

    if (/Service Invocation Failed|Couldn't access remote service/i.test(pageText)) {
      throw new Error(
        "Banner cargo 'Service Invocation Failed'. La sesion expiro o SSASECT no esta disponible."
      );
    }

    if (
      /genesisgo\.uniminuto\.edu/i.test(currentUrl) &&
      /PROFESORES|COLABORADOR|ESTUDIANTES/i.test(pageText)
    ) {
      await this.page.goto("https://genesisadmin.uniminuto.edu/applicationNavigator/seamless", {
        waitUntil: "domcontentloaded",
        timeout: this.timeouts.navigationTimeoutMs
      });
    }

    const alreadyAuthenticated = await this.isAuthenticated(
      Math.min(this.timeouts.actionTimeoutMs, 2000)
    );
    if (alreadyAuthenticated) {
      return;
    }

    const loginInputDetected = await exists(
      this.page,
      this.profile.login.username,
      Math.min(this.timeouts.actionTimeoutMs, 5000)
    );

    const passwordInputDetected = await exists(
      this.page,
      this.profile.login.password,
      Math.min(this.timeouts.actionTimeoutMs, 2000)
    );
    const accountPickerDetected = await this.isMicrosoftAccountPickerVisible();

    if (!loginInputDetected && !passwordInputDetected && !accountPickerDetected) {
      const refreshedText = await this.page.locator("body").innerText().catch(() => pageText);
      throw new Error(
        `No se detecto la pantalla de inicio de sesion de Banner/Microsoft. URL actual: ${
          this.page.url()
        }. Vista: ${refreshedText.slice(0, 180).replace(/\s+/g, " ").trim()}`
      );
    }
  }

  private async advanceMicrosoftAccountPicker(username: string): Promise<void> {
    if (!(await this.isMicrosoftAccountPickerVisible())) {
      return;
    }

    const accountChoice = this.page.getByText(username, { exact: false }).first();
    if (await accountChoice.isVisible().catch(() => false)) {
      await accountChoice.click({ timeout: this.timeouts.actionTimeoutMs });
      await this.page.waitForTimeout(500);
      return;
    }

    const useAnotherAccount = this.page
      .getByText(/Usar otra cuenta|Use another account/i)
      .first();

    if (await useAnotherAccount.isVisible().catch(() => false)) {
      await useAnotherAccount.click({ timeout: this.timeouts.actionTimeoutMs });
      await this.page.waitForTimeout(500);
    }
  }

  private async isMicrosoftAccountPickerVisible(): Promise<boolean> {
    const pageText = await this.page.locator("body").innerText().catch(() => "");
    return /Selecci[oó]n de la cuenta|Choose an account|Usar otra cuenta|Use another account/i.test(
      pageText
    );
  }
}
