/** Backoff before each rate-limit retry: 1 s, 2 s, 4 s (three retries max). */
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** Real sleep used when a provider is not given an injected one. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  if (typeof status === 'string' && /^\d+$/.test(status)) return Number(status);
  return undefined;
}

/** HTTP 429 and 5xx are retryable; every other error is surfaced immediately. */
export function isRetryableError(error: unknown): boolean {
  const status = statusOf(error);
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

/** Reads a Retry-After header from an HTTP-ish error, in milliseconds. */
export function retryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const headers = (error as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null) return undefined;

  const record = headers as Record<string, unknown>;
  const value = record['retry-after'] ?? record['Retry-After'];
  const seconds =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : undefined;
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}
