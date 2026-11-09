const SECRET_HEADERS = new Set([
  'authorization',
  'paypal-auth-assertion',
  'x-payclinic-admin',
  'x-payclinic-admin-token',
  'proxy-authorization',
  'x-api-key',
  'api-key',
]);

/** Masks authentication and secret-bearing headers, lower-casing header names. */
export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [name, value] of Object.entries(h)) {
    const key = name.toLowerCase();
    const isSensitive =
      SECRET_HEADERS.has(key) ||
      key.includes('secret') ||
      key.includes('token') ||
      key.includes('password') ||
      key.includes('admin');
    redacted[key] = isSensitive ? '***' : value;
  }
  return redacted;
}

/** Masks the access token in OAuth token responses. */
export function redactBody(url: string, body: unknown): unknown {
  const pathname = new URL(url, 'http://placeholder').pathname;
  if (pathname !== '/v1/oauth2/token') return body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;

  const record = body as Record<string, unknown>;
  if (!('access_token' in record)) return body;
  return { ...record, access_token: '***' };
}
