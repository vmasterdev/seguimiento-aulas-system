export class BannerAutomationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "BannerAutomationError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
