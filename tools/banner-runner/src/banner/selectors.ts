import type { Frame, Locator, Page } from "playwright";

import type { SelectorDefinition } from "../config/bannerProfile.js";

export type RootLocator = Page | Frame;
type RoleName = Parameters<Page["getByRole"]>[0];

function exactOption(exact?: boolean): { exact?: boolean } {
  return exact === undefined ? {} : { exact };
}

function locatorFromSelector(root: RootLocator, selector: SelectorDefinition): Locator {
  switch (selector.type) {
    case "css":
      return root.locator(selector.value);
    case "xpath":
      return root.locator(`xpath=${selector.value}`);
    case "text":
      return root.getByText(selector.value, exactOption(selector.exact));
    case "label":
      return root.getByLabel(selector.value, exactOption(selector.exact));
    case "role":
      return root.getByRole(selector.value as RoleName, {
        ...(selector.name ? { name: selector.name } : {}),
        ...exactOption(selector.exact)
      });
    case "placeholder":
      return root.getByPlaceholder(selector.value, exactOption(selector.exact));
    case "testId":
      return root.getByTestId(selector.value);
    default:
      return root.locator(selector.value);
  }
}

export async function resolveVisibleLocator(
  root: RootLocator,
  selectors: SelectorDefinition[],
  timeoutMs: number
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = locatorFromSelector(root, selector).first();

    try {
      await locator.waitFor({
        state: "visible",
        timeout: timeoutMs
      });
      return locator;
    } catch {
      continue;
    }
  }

  return null;
}

export async function exists(
  root: RootLocator,
  selectors: SelectorDefinition[],
  timeoutMs: number
): Promise<boolean> {
  return (await resolveVisibleLocator(root, selectors, timeoutMs)) !== null;
}

export async function clickFirst(
  root: RootLocator,
  selectors: SelectorDefinition[],
  timeoutMs: number
): Promise<void> {
  const locator = await resolveVisibleLocator(root, selectors, timeoutMs);

  if (!locator) {
    throw new Error("No se encontro un selector clickeable");
  }

  try {
    await locator.click({ timeout: timeoutMs });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes("outside of the viewport")) {
      throw error;
    }
  }

  try {
    await locator.click({
      timeout: timeoutMs,
      force: true
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes("outside of the viewport")) {
      throw error;
    }
  }

  await locator.evaluate((element) => {
    (element as { click: () => void }).click();
  });
}

export async function fillFirst(
  root: RootLocator,
  selectors: SelectorDefinition[],
  value: string,
  timeoutMs: number
): Promise<void> {
  const locator = await resolveVisibleLocator(root, selectors, timeoutMs);

  if (!locator) {
    throw new Error("No se encontro un selector editable");
  }

  try {
    await locator.click({ timeout: timeoutMs });
  } catch {
    // Some Banner widgets still accept fill even if click/focus is flaky.
  }

  try {
    await locator.fill(value, { timeout: timeoutMs });
    return;
  } catch {
    // Fallback for legacy widgets that do not cooperate with Playwright fill().
  }

  await locator.evaluate(
    (element, nextValue) => {
      const input = element as {
        value?: string;
        dispatchEvent: (event: Event) => boolean;
      };

      input.value = nextValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    },
    value
  );
}

export async function textFromFirst(
  root: RootLocator,
  selectors: SelectorDefinition[] | undefined,
  timeoutMs: number
): Promise<string | null> {
  if (!selectors || selectors.length === 0) {
    return null;
  }

  const locator = await resolveVisibleLocator(root, selectors, timeoutMs);
  if (!locator) {
    return null;
  }

  const inputValue = await locator.inputValue().catch(() => null);
  if (inputValue && inputValue.trim()) {
    return inputValue.trim();
  }

  const textContent = await locator.textContent();
  return textContent?.trim() || null;
}
