import type { Cart, CartItem, Product, ScenarioKey } from '@payclinic/contracts';
import type { MockRule } from '../trace/proxy';
import type { StepRecorder } from '../trace/recorder';
import type { BuyerApprover } from './approvers';

export type { BuyerApprover } from './approvers';

export interface RecordedHttpOptions {
  label?: string;
  headers?: Record<string, string>;
  absolute?: boolean;
}

export interface RecordedResponse {
  status: number;
  body: any;
  stepId: string;
}

export interface RecordedHttp {
  request(
    method: string,
    path: string,
    body?: unknown,
    opts?: RecordedHttpOptions,
  ): Promise<RecordedResponse>;
}

export interface ScenarioContext {
  runId: string;
  scenarioKey: ScenarioKey;
  storeUrl: string;
  catalog: Product[];
  http: {
    request(
      method: string,
      path: string,
      body?: unknown,
      opts?: { label?: string; headers?: Record<string, string> },
    ): Promise<{ status: number; body: any; stepId: string }>;
  };
  chaos: {
    mockNext(rule: MockRule): void;
    clear(): void;
  };
  approver: BuyerApprover;
  declareCart(cart: Cart): void;
  declareForgedDelivery(deliveryId: string): void;
  checkout(o: {
    cartId: string;
    items: CartItem[];
    currency?: string;
    clientTotal?: string;
  }): Promise<{ status: number; orderId?: string; merchantOrderId?: string; body: any }>;
  approve(orderId: string): Promise<void>;
  capture(orderId: string): Promise<{ status: number; body: any }>;
  getDeclared(): { carts: Cart[]; forgedDeliveryIds: string[] };
}

export type ScenarioFn = (ctx: ScenarioContext) => Promise<void>;

export interface BuildContextOptions {
  runId: string;
  scenarioKey: ScenarioKey;
  storeUrl: string;
  http: RecordedHttp;
  approver: BuyerApprover;
  chaos: ScenarioContext['chaos'];
  catalog?: Product[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonResponse(contentType: string | null, text: string): unknown {
  if (text === '') return undefined;
  if (contentType?.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function responseHeaders(raw: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  raw.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return headers;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((candidate) => candidate.toLowerCase() === name);
}

/** Creates an HTTP client that records each runner request as a trace step. */
export function createRecordedHttp(o: {
  recorder: StepRecorder;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): RecordedHttp {
  const fetchImpl = o.fetchImpl ?? fetch;
  const baseUrl = o.baseUrl.replace(/\/+$/, '');

  return {
    async request(method, path, body, opts = {}) {
      const url = opts.absolute ? path : joinUrl(baseUrl, path);
      const headers: Record<string, string> = { ...opts.headers };
      if (body !== undefined && !hasHeader(headers, 'content-type')) {
        headers['content-type'] = 'application/json';
      }

      const seq = o.recorder.start('runner', opts.label);
      const started = Date.now();

      try {
        const response = await fetchImpl(url, {
          method,
          headers,
          ...(body === undefined || method === 'GET' || method === 'HEAD'
            ? {}
            : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        const responseBody = jsonResponse(response.headers.get('content-type'), text);
        const step = o.recorder.finish(seq, {
          method,
          url,
          requestHeaders: headers,
          requestBody: body,
          responseStatus: response.status,
          responseHeaders: responseHeaders(response.headers),
          responseBody,
          durationMs: Date.now() - started,
        });
        return { status: response.status, body: responseBody, stepId: step.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const responseBody = { name: 'FETCH_ERROR', message };
        const step = o.recorder.finish(seq, {
          method,
          url,
          requestHeaders: headers,
          requestBody: body,
          responseStatus: 599,
          responseHeaders: { 'content-type': 'application/json' },
          responseBody,
          durationMs: Date.now() - started,
        });
        return { status: 599, body: responseBody, stepId: step.id };
      }
    },
  };
}

/** Builds the typed scenario context used by scenario functions. */
export function buildContext(o: BuildContextOptions): ScenarioContext {
  const carts = new Map<string, Cart>();
  const forgedDeliveryIds = new Set<string>();
  const approveUrls = new Map<string, string>();

  return {
    runId: o.runId,
    scenarioKey: o.scenarioKey,
    storeUrl: o.storeUrl,
    catalog: (o.catalog ?? []).map((product) => ({ ...product })),
    http: o.http,
    chaos: o.chaos,
    approver: o.approver,

    declareCart(cart: Cart): void {
      carts.set(cart.id, {
        ...cart,
        items: cart.items.map((item) => ({ ...item })),
      });
    },

    declareForgedDelivery(deliveryId: string): void {
      forgedDeliveryIds.add(deliveryId);
    },

    async checkout(input) {
      const body: Record<string, unknown> = {
        cartId: input.cartId,
        items: input.items,
      };
      if (input.currency !== undefined) body.currency = input.currency;
      if (input.clientTotal !== undefined) body.clientTotal = input.clientTotal;

      const response = await o.http.request('POST', '/api/orders', body, {
        label: 'Customer clicks Pay',
      });
      const record = asRecord(response.body);
      const orderId = typeof record?.orderId === 'string' ? record.orderId : undefined;
      const merchantOrderId =
        typeof record?.merchantOrderId === 'string' ? record.merchantOrderId : undefined;
      const approveUrl = typeof record?.approveUrl === 'string' ? record.approveUrl : undefined;

      if (orderId !== undefined && approveUrl !== undefined) {
        approveUrls.set(orderId, approveUrl);
      }

      return {
        status: response.status,
        ...(orderId === undefined ? {} : { orderId }),
        ...(merchantOrderId === undefined ? {} : { merchantOrderId }),
        body: response.body,
      };
    },

    async approve(orderId: string): Promise<void> {
      const approveUrl = approveUrls.get(orderId);
      if (approveUrl === undefined) {
        throw new Error(`No approve URL recorded for order ${orderId}`);
      }
      await o.approver.approve(orderId, approveUrl);
    },

    async capture(orderId: string) {
      const response = await o.http.request(
        'POST',
        `/api/orders/${encodeURIComponent(orderId)}/capture`,
        {},
        { label: 'Customer returns; store captures' },
      );
      return { status: response.status, body: response.body };
    },

    getDeclared() {
      return {
        carts: [...carts.values()].map((cart) => ({
          ...cart,
          items: cart.items.map((item) => ({ ...item })),
        })),
        forgedDeliveryIds: [...forgedDeliveryIds],
      };
    },
  };
}
