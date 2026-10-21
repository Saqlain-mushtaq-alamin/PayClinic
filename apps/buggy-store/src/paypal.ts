export interface PayPalResult {
  ok: boolean;
  status: number;
  // PayPal response shapes are external and inspected dynamically by the store.
  body: any;
}

export interface PayPalClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export interface PayPalClient {
  createOrder(body: unknown, opts?: { requestId?: string }): Promise<PayPalResult>;
  captureOrder(orderId: string): Promise<PayPalResult>;
  refund(captureId: string, amount?: unknown): Promise<PayPalResult>;
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    event: unknown,
  ): Promise<PayPalResult>;
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Creates a PayPal client whose token is fetched once and cached. */
export function createPayPalClient(opts: PayPalClientOptions): PayPalClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  let tokenPromise: Promise<string> | null = null;

  const parseResponse = async (response: Response): Promise<any> => {
    const text = await response.text();
    if (text === '') return undefined;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  };

  const fetchToken = async (): Promise<string> => {
    const credentials = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64');
    const response = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = await parseResponse(response);
    if (!response.ok) throw new Error(`PayPal token request failed with ${response.status}`);
    const token = body?.access_token;
    if (typeof token !== 'string') throw new Error('PayPal token response had no access_token');
    return token;
  };

  const getToken = async (): Promise<string> => {
    if (!tokenPromise) {
      tokenPromise = fetchToken().catch((error: unknown) => {
        tokenPromise = null;
        throw error;
      });
    }
    return tokenPromise;
  };

  const request = async (
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<PayPalResult> => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        ...extraHeaders,
      };
      if (body !== undefined) headers['content-type'] = 'application/json';

      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await parseResponse(response),
      };
    } catch (error) {
      return {
        ok: false,
        status: 599,
        body: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  };

  return {
    createOrder(body: unknown, options?: { requestId?: string }): Promise<PayPalResult> {
      const headers: Record<string, string> = {};
      if (options?.requestId !== undefined) headers['paypal-request-id'] = options.requestId;
      return request('POST', '/v2/checkout/orders', body, headers);
    },

    captureOrder(orderId: string): Promise<PayPalResult> {
      return request('POST', `/v2/checkout/orders/${orderId}/capture`, {});
    },

    refund(captureId: string, amount?: unknown): Promise<PayPalResult> {
      return request(
        'POST',
        `/v2/payments/captures/${captureId}/refund`,
        amount === undefined ? {} : { amount },
      );
    },

    verifyWebhook(
      headers: Record<string, string | string[] | undefined>,
      event: unknown,
    ): Promise<PayPalResult> {
      const eventBody =
        typeof event === 'object' && event !== null ? (event as Record<string, unknown>) : {};
      return request('POST', '/v1/notifications/verify-webhook-signature', {
        ...eventBody,
        transmission_sig: readHeader(headers, 'paypal-transmission-sig') ?? '',
      });
    },
  };
}
