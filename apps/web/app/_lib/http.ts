type ErrorPayload = {
  message?: string | string[];
  error?: string;
  detail?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractErrorMessage(data: unknown, status: number, rawText: string): string {
  if (isRecord(data)) {
    const payload = data as ErrorPayload;
    if (Array.isArray(payload.message)) return payload.message.join('; ');
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
    if (typeof payload.detail === 'string' && payload.detail.trim()) return payload.detail;
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  }

  if (rawText.trim()) return rawText.trim();
  return `HTTP ${status}`;
}

async function readJsonBody(response: Response): Promise<{ data: unknown; rawText: string }> {
  const rawText = await response.text();
  if (!rawText.trim()) return { data: null, rawText };

  try {
    return { data: JSON.parse(rawText), rawText };
  } catch {
    return { data: null, rawText };
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
  });
  const { data, rawText } = await readJsonBody(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, response.status, rawText));
  }

  if (data === null) {
    throw new Error(rawText.trim() ? 'Respuesta invalida del servidor.' : 'Respuesta vacia del servidor.');
  }

  return data as T;
}

export async function fetchJsonOrNull<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    return await fetchJson<T>(url, init);
  } catch {
    return null;
  }
}
