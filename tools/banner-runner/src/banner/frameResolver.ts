import type { Frame, Page } from "playwright";

import type { FrameRef } from "../config/bannerProfile.js";
import { BannerAutomationError } from "../core/errors.js";

function frameMatches(frame: Frame, frameRef: FrameRef): boolean {
  const nameMatches = frameRef.name ? frame.name() === frameRef.name : true;
  const urlMatches = frameRef.urlIncludes ? frame.url().includes(frameRef.urlIncludes) : true;
  return nameMatches && urlMatches;
}

function childFramesOf(root: Page | Frame): Frame[] {
  if ("childFrames" in root) {
    return root.childFrames();
  }

  return root.frames().filter((frame) => frame !== root.mainFrame());
}

export async function resolveFrameRoot(
  page: Page,
  framePath: FrameRef[],
  timeoutMs: number
): Promise<Page | Frame> {
  if (framePath.length === 0) {
    return page;
  }

  let current: Page | Frame = page;
  const deadline = Date.now() + timeoutMs;

  for (const frameRef of framePath) {
    let resolved: Frame | undefined;

    while (!resolved && Date.now() < deadline) {
      resolved = childFramesOf(current).find((frame) => frameMatches(frame, frameRef));
      if (!resolved) {
        await page.waitForTimeout(250);
      }
    }

    if (!resolved) {
      throw new BannerAutomationError(
        `No fue posible resolver el frame solicitado: ${JSON.stringify(frameRef)}`
      );
    }

    current = resolved;
  }

  return current;
}
