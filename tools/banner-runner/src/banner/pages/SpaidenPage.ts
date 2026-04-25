import type { Frame, Locator, Page } from "playwright";

import type { AppConfig } from "../../config/env.js";
import type { SelectorDefinition } from "../../config/bannerProfile.js";
import type { AppLogger } from "../../logging/logger.js";
import { clickFirst, resolveVisibleLocator, type RootLocator } from "../selectors.js";

const SEARCH_ID_SELECTORS: SelectorDefinition[] = [
  { type: "css", value: "#inp\\:id" },
  { type: "css", value: "input[name='id']" },
  { type: "css", value: "[data-member='ID'] input" },
  { type: "label", value: "ID" }
];

const GO_BUTTON_SELECTORS: SelectorDefinition[] = [
  { type: "css", value: "#frames8" },
  { type: "css", value: "button[data-member='EXECUTE_BTN'][data-block='KEY_BLOCK']" },
  { type: "role", value: "button", name: "Go" },
  { type: "role", value: "button", name: "Ir" }
];

const PERSON_RESULT_ID_SELECTORS: SelectorDefinition[] = [
  { type: "css", value: "#inp\\:spridenId" },
  { type: "css", value: "input[name='spridenId']" },
  { type: "css", value: "input[id*='spridenId' i]" },
  { type: "css", value: "input[name*='spridenId' i]" },
  { type: "css", value: "input[aria-labelledby*='spridenId' i]" },
  { type: "css", value: "[data-member='SPRIDEN_ID'] input" },
  { type: "label", value: "Id" }
];

const EMAIL_TAB_SELECTORS: SelectorDefinition[] = [
  { type: "css", value: "#tabGIdenTabCanvas_tab5" },
  { type: "css", value: "a[href='#tabGIdenTabCanvas-page_emailTab']" },
  { type: "css", value: "[data-member='GOREMAL_EMAIL_ADDRESS']" },
  { type: "role", value: "tab", name: "Correo electrónico" },
  { type: "role", value: "tab", name: "Correo-e" },
  { type: "role", value: "tab", name: "E-mail" },
  { type: "text", value: "E-mail Information", exact: true },
  { type: "text", value: "Correo electrónico", exact: true },
  { type: "text", value: "Correo-e", exact: true },
  { type: "text", value: "E-mail", exact: true }
];

export interface SpaidenLookupResult {
  rawPersonId: string;
  normalizedPersonId: string;
  currentUrl: string;
  pageTitle: string;
  selectorMatched: string | null;
  searchSelectorMatched: string | null;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  email: string | null;
  emailTabOpened: boolean;
  bodySnippet: string;
  visibleInputs: Array<{
    frameUrl: string;
    id: string | null;
    name: string | null;
    type: string | null;
  }>;
}

function normalizeBodyText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function rootCandidates(page: Page): RootLocator[] {
  const frames = page
    .frames()
    .filter((frame) => frame !== page.mainFrame() && frame.url() !== "about:blank");
  return [page, ...frames];
}

function selectorLabel(selector: SelectorDefinition): string {
  return `${selector.type}:${selector.value}`;
}

function isMicrosoftLogin(url: string, bodyText: string): boolean {
  return (
    /commonauth|login\.microsoftonline\.com/i.test(url) ||
    /Sign in to your account|Iniciar sesi[oó]n en la cuenta|Choose an account|Usar otra cuenta/i.test(
      bodyText
    )
  );
}

export function normalizePersonId(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (!/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.length >= 8) return trimmed;
  return trimmed.padStart(9, "0");
}

export class SpaidenPage {
  private readonly spaidenUrl: string;

  constructor(
    private readonly page: Page,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly timeouts: {
      navigationTimeoutMs: number;
      actionTimeoutMs: number;
    }
  ) {
    this.spaidenUrl = new URL("/BannerAdmin/?form=SPAIDEN&ban_args=&ban_mode=xe", this.config.banner.baseUrl).toString();
  }

  async open(): Promise<void> {
    await this.page.goto(this.spaidenUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.timeouts.navigationTimeoutMs
    });
    await this.page.waitForLoadState("networkidle").catch(() => undefined);
    await this.page.waitForTimeout(1500);
    await this.assertPageReady();
  }

  async submitPersonId(rawPersonId: string): Promise<SpaidenLookupResult> {
    const normalizedPersonId = normalizePersonId(rawPersonId);

    await this.open();

    const located = await this.waitForSearchIdInput();
    if (!located) {
      throw new Error(await this.buildDebugError("No se detecto el campo de ID en SPAIDEN"));
    }

    try {
      await located.locator.click({ timeout: this.timeouts.actionTimeoutMs });
    } catch {
      // Algunos widgets legacy aceptan fill aunque el click/focus sea inestable.
    }

    try {
      await located.locator.fill(normalizedPersonId, {
        timeout: this.timeouts.actionTimeoutMs
      });
    } catch {
      await located.locator.evaluate((element, value) => {
        const input = element as {
          value?: string;
          dispatchEvent: (event: Event) => boolean;
        };
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, normalizedPersonId);
    }

    await located.locator.press("Enter").catch(() => this.page.keyboard.press("Enter"));
    await this.page.waitForTimeout(250);
    await located.locator.press("Enter").catch(() => this.page.keyboard.press("Enter"));
    await clickFirst(this.page, GO_BUTTON_SELECTORS, Math.min(this.timeouts.actionTimeoutMs, 1500)).catch(
      () => undefined
    );

    await this.waitForRecordResolution();
    const details = await this.extractPersonDetails();

    const debug = await this.collectDebugState();
    this.logger.info("SPAIDEN inicializado", {
      rawPersonId,
      normalizedPersonId,
      currentUrl: debug.currentUrl,
      selectorMatched: details.resultSelectorMatched,
      searchSelectorMatched: located.selectorLabel
    });

    return {
      rawPersonId,
      normalizedPersonId,
      currentUrl: debug.currentUrl,
      pageTitle: debug.pageTitle,
      selectorMatched: details.resultSelectorMatched,
      searchSelectorMatched: located.selectorLabel,
      lastName: details.lastName,
      firstName: details.firstName,
      middleName: details.middleName,
      email: details.email,
      emailTabOpened: details.emailTabOpened,
      bodySnippet: debug.bodySnippet,
      visibleInputs: debug.visibleInputs
    };
  }

  private async assertPageReady(): Promise<void> {
    const bodyText = normalizeBodyText(
      await this.page.locator("body").innerText().catch(() => "")
    );
    const currentUrl = this.page.url();

    if (/Service Invocation Failed|Couldn't access remote service/i.test(bodyText)) {
      throw new Error(
        "Banner devolvio 'Service Invocation Failed' al abrir SPAIDEN. Reautentica la sesion y vuelve a intentar."
      );
    }

    if (isMicrosoftLogin(currentUrl, bodyText)) {
      throw new Error(
        "La sesion Banner requiere autenticacion Microsoft antes de usar SPAIDEN."
      );
    }
  }

  private async waitForSearchIdInput(): Promise<{
    locator: Locator;
    selectorLabel: string | null;
    root: RootLocator;
  } | null> {
    const deadline = Date.now() + this.timeouts.navigationTimeoutMs;

    while (Date.now() < deadline) {
      const currentRoots = rootCandidates(this.page);

      for (const root of currentRoots) {
        for (const selector of SEARCH_ID_SELECTORS) {
          const locator = await resolveVisibleLocator(
            root,
            [selector],
            Math.min(this.timeouts.actionTimeoutMs, 500)
          );

          if (locator) {
            return {
              locator,
              selectorLabel: selectorLabel(selector),
              root
            };
          }
        }
      }

      await this.page.waitForTimeout(300);
    }

    return null;
  }

  private async waitForRecordResolution(): Promise<void> {
    const deadline = Date.now() + Math.min(this.timeouts.navigationTimeoutMs, 10000);

    while (Date.now() < deadline) {
      const resultId = await this.readFieldValue(["#inp\\:spridenId", "input[name='spridenId']"]);
      const lastName = await this.readFieldValue(["#inp\\:persLastName", "input[name='persLastName']"]);

      if (resultId || lastName) {
        return;
      }

      await this.page.waitForTimeout(300);
    }
  }

  private async extractPersonDetails(): Promise<{
    resultSelectorMatched: string | null;
    lastName: string | null;
    firstName: string | null;
    middleName: string | null;
    email: string | null;
    emailTabOpened: boolean;
  }> {
    const resultField = await this.waitForResultIdInput();

    const lastName = await this.readFieldValue([
      "#inp\\:persLastName",
      "input[name='persLastName']"
    ]);
    const firstName = await this.readFieldValue([
      "#inp\\:persFirstName",
      "input[name='persFirstName']"
    ]);
    const middleName = await this.readFieldValue([
      "#inp\\:persMi",
      "input[name='persMi']"
    ]);

    const emailSelectors = [
      "#inp\\:goremalEmailAddress_0",
      "input[name='goremalEmailAddress_0']",
      "#page_emailTab_goremalEmailAddress_0 input",
      "#inp\\:goremalEmailAddress",
      "input[name='goremalEmailAddress']",
      "#page_emailTab_goremalEmailAddress input",
      "[data-member='GOREMAL_EMAIL_ADDRESS'] input"
    ];
    const emailTabOpened = await this.openEmailTab();
    const email = emailTabOpened ? await this.readFieldValue(emailSelectors) : null;

    return {
      resultSelectorMatched: resultField?.selectorLabel ?? null,
      lastName,
      firstName,
      middleName,
      email,
      emailTabOpened
    };
  }

  private async waitForResultIdInput(): Promise<{
    locator: Locator;
    selectorLabel: string | null;
  } | null> {
    const deadline = Date.now() + Math.min(this.timeouts.navigationTimeoutMs, 6000);

    while (Date.now() < deadline) {
      for (const root of rootCandidates(this.page)) {
        for (const selector of PERSON_RESULT_ID_SELECTORS) {
          const locator = await resolveVisibleLocator(
            root,
            [selector],
            Math.min(this.timeouts.actionTimeoutMs, 400)
          );
          if (locator) {
            return {
              locator,
              selectorLabel: selectorLabel(selector)
            };
          }
        }
      }

      await this.page.waitForTimeout(250);
    }

    return null;
  }

  private async openEmailTab(): Promise<boolean> {
    const emailSelectors = [
      "#inp\\:goremalEmailAddress_0",
      "input[name='goremalEmailAddress_0']",
      "#page_emailTab_goremalEmailAddress_0 input",
      "#inp\\:goremalEmailAddress",
      "input[name='goremalEmailAddress']",
      "#page_emailTab_goremalEmailAddress input",
      "[data-member='GOREMAL_EMAIL_ADDRESS'] input"
    ];

    try {
      await clickFirst(this.page, EMAIL_TAB_SELECTORS, Math.min(this.timeouts.actionTimeoutMs, 2000));
    } catch {
      // Intentamos una activacion mas agresiva del tab legacy.
    }

    await this.page
      .evaluate(() => {
        const dom = globalThis as {
          document?: {
            querySelector: (selector: string) => {
              click?: () => void;
              dispatchEvent?: (event: unknown) => boolean;
            } | null;
          };
          MouseEvent?: new (type: string, init?: Record<string, unknown>) => unknown;
        };

        const tab =
          dom.document?.querySelector("#tabGIdenTabCanvas_tab5") ??
          dom.document?.querySelector("a[href='#tabGIdenTabCanvas-page_emailTab']") ??
          dom.document?.querySelector("[data-member='GOREMAL_EMAIL_ADDRESS']");

        if (tab?.click) {
          tab.click();
        }

        if (tab?.dispatchEvent && dom.MouseEvent) {
          tab.dispatchEvent(new dom.MouseEvent("click", { bubbles: true, cancelable: true }));
        }
      })
      .catch(() => undefined);

    const deadline = Date.now() + Math.min(this.timeouts.navigationTimeoutMs, 6000);
    while (Date.now() < deadline) {
      const emailValue = await this.readFieldValue(emailSelectors);
      if (emailValue) {
        return true;
      }

      await this.page.waitForTimeout(350);
    }

    return false;
  }

  private async readFieldValue(selectors: string[]): Promise<string | null> {
    for (const root of rootCandidates(this.page)) {
      for (const selector of selectors) {
        const locator = root.locator(selector).first();
        const count = await locator.count().catch(() => 0);
        if (count === 0) {
          continue;
        }

        const value = await locator
          .evaluate((element) => {
            const candidate = element as {
              value?: string;
              getAttribute: (name: string) => string | null;
              textContent?: string | null;
            };

            const inputValue = candidate.value?.trim();
            if (inputValue) {
              return inputValue;
            }

            const title = candidate.getAttribute("title")?.trim();
            if (title) {
              return title;
            }

            const text = candidate.textContent?.trim();
            return text || null;
          })
          .catch(() => null);

        if (value) {
          return value;
        }
      }
    }

    return null;
  }

  private async collectDebugState(): Promise<{
    currentUrl: string;
    pageTitle: string;
    bodySnippet: string;
    visibleInputs: Array<{
      frameUrl: string;
      id: string | null;
      name: string | null;
      type: string | null;
    }>;
  }> {
    const visibleInputs: Array<{
      frameUrl: string;
      id: string | null;
      name: string | null;
      type: string | null;
    }> = [];

    for (const root of rootCandidates(this.page)) {
      const frameUrl = "url" in root ? root.url() : this.page.url();
      const inputs = await root
        .locator("input")
        .evaluateAll((elements) =>
          elements.slice(0, 20).map((element) => {
            const input = element as {
              getAttribute: (name: string) => string | null;
            };
            return {
              id: input.getAttribute("id"),
              name: input.getAttribute("name"),
              type: input.getAttribute("type")
            };
          })
        )
        .catch(() => []);

      for (const input of inputs) {
        visibleInputs.push({
          frameUrl,
          id: input.id,
          name: input.name,
          type: input.type
        });
      }
    }

    return {
      currentUrl: this.page.url(),
      pageTitle: await this.page.title(),
      bodySnippet: normalizeBodyText(
        await this.page.locator("body").innerText().catch(() => "")
      ).slice(0, 240),
      visibleInputs
    };
  }

  private async buildDebugError(prefix: string): Promise<string> {
    const debug = await this.collectDebugState();
    return `${prefix}. URL actual: ${debug.currentUrl}. Titulo: ${debug.pageTitle}. Vista: ${debug.bodySnippet}. Inputs detectados: ${JSON.stringify(debug.visibleInputs.slice(0, 10))}`;
  }
}
