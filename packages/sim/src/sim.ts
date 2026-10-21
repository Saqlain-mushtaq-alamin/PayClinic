import { fromMinor, toMinor } from '@payclinic/core';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validateAmount } from './validate';

const DEFAULT_PUBLIC_URL = 'http://127.0.0.1:4010';

interface Money {
  currency_code: string;
  value: string;
}

interface PurchaseUnit {
  reference_id?: string;
  custom_id?: string | null;
  amount: Money;
  [key: string]: unknown;
}

interface OrderRecord {
  id: string;
  status: 'CREATED' | 'APPROVED' | 'COMPLETED';
  purchaseUnits: PurchaseUnit[];
  links: Array<{ href: string; rel: string; method: string }>;
  captured: boolean;
}

interface CaptureRecord {
  id: string;
  orderId: string;
  amount: Money;
  custom_id: string | null;
  refunded: string;
}

interface RefundRecord {
  id: string;
  captureId: string;
  amount: Money;
}

interface Counters {
  order: number;
  capture: number;
  refund: number;
  debug: number;
}

export interface Sim {
  app: FastifyInstance;
  reset(): void;
}

interface Store {
  orders: Map<string, OrderRecord>;
  captures: Map<string, CaptureRecord>;
  refunds: Map<string, RefundRecord>;
  idempotency: Map<string, unknown>;
  nextOrderId(): string;
  nextCaptureId(): string;
  nextRefundId(): string;
  nextDebugId(): string;
  reset(): void;
}

function createStore(): Store {
  const orders = new Map<string, OrderRecord>();
  const captures = new Map<string, CaptureRecord>();
  const refunds = new Map<string, RefundRecord>();
  const idempotency = new Map<string, unknown>();
  let counters: Counters = { order: 0, capture: 0, refund: 0, debug: 0 };

  const nextId = (prefix: string, key: keyof Counters): string => {
    counters[key] += 1;
    return `${prefix}${String(counters[key]).padStart(4, '0')}`;
  };

  return {
    orders,
    captures,
    refunds,
    idempotency,
    nextOrderId: () => nextId('ORD', 'order'),
    nextCaptureId: () => nextId('CAP', 'capture'),
    nextRefundId: () => nextId('REF', 'refund'),
    nextDebugId: () => nextId('SIM-', 'debug'),
    reset() {
      orders.clear();
      captures.clear();
      refunds.clear();
      idempotency.clear();
      counters = { order: 0, capture: 0, refund: 0, debug: 0 };
    },
  };
}

function header(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function debugIdOf(reply: FastifyReply): string {
  const value = reply.getHeader('paypal-debug-id');
  return typeof value === 'string' ? value : 'SIM-0000';
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  issue: string,
  description: string,
  field?: string,
) {
  return reply.code(statusCode).send({
    name: statusCode === 404 ? 'RESOURCE_NOT_FOUND' : 'UNPROCESSABLE_ENTITY',
    message: description,
    debug_id: debugIdOf(reply),
    details: [{ issue, description, ...(field ? { field } : {}) }],
  });
}

function parseOrder(
  body: unknown,
): { units: PurchaseUnit[] } | { issue: string; description: string; field?: string } {
  if (typeof body !== 'object' || body === null) {
    return { issue: 'INVALID_VALUE', description: 'body must be an object' };
  }

  const units = (body as { purchase_units?: unknown }).purchase_units;
  if (!Array.isArray(units) || units.length === 0) {
    return {
      issue: 'INVALID_VALUE',
      description: 'purchase_units must be a non-empty array',
      field: 'purchase_units',
    };
  }

  const parsed: PurchaseUnit[] = [];
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (typeof unit !== 'object' || unit === null) {
      return {
        issue: 'INVALID_VALUE',
        description: 'purchase unit must be an object',
        field: `purchase_units[${index}]`,
      };
    }

    const amount = (unit as { amount?: unknown }).amount;
    if (typeof amount !== 'object' || amount === null) {
      return {
        issue: 'INVALID_VALUE',
        description: 'amount is required',
        field: `purchase_units[${index}].amount`,
      };
    }

    const value = (amount as { value?: unknown }).value;
    const currency = (amount as { currency_code?: unknown }).currency_code;
    const problem = validateAmount(value, currency);
    if (problem) {
      return {
        issue: problem.issue,
        description: `Amount "${String(value)}" is invalid for ${String(currency)}`,
        field: `purchase_units[${index}].amount.${problem.field}`,
      };
    }

    parsed.push(unit as PurchaseUnit);
  }

  return { units: parsed };
}

function mockCode(req: FastifyRequest): string | null {
  const raw = header(req, 'paypal-mock-response');
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const code = (parsed as { mock_application_codes?: unknown }).mock_application_codes;
      return typeof code === 'string' ? code : null;
    }
  } catch {
    return null;
  }
  return null;
}

function idempotencyKey(req: FastifyRequest): string | null {
  const requestId = header(req, 'paypal-request-id');
  return requestId ? `${req.method} ${req.url} ${requestId}` : null;
}

function orderResponse(order: OrderRecord) {
  return {
    id: order.id,
    status: order.status,
    links: order.links,
    purchase_units: order.purchaseUnits,
  };
}

function createSimInternal(initialPublicUrl: string) {
  const store = createStore();
  let publicUrl = initialPublicUrl;
  const app = Fastify({ logger: false });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      done(null, Object.fromEntries(new URLSearchParams(text)));
    },
  );

  app.addHook('onRequest', async (_req, reply) => {
    reply.header('paypal-debug-id', store.nextDebugId());
  });

  app.post('/v1/oauth2/token', async (_req, reply) =>
    reply.code(200).send({
      access_token: 'SIM-TOKEN',
      token_type: 'Bearer',
      expires_in: 32400,
    }),
  );

  app.post('/v2/checkout/orders', async (req, reply) => {
    const key = idempotencyKey(req);
    if (key) {
      const cached = store.idempotency.get(key);
      if (cached !== undefined) {
        return reply.header('x-sim-idempotent-replay', 'true').code(200).send(cached);
      }
    }

    const parsed = parseOrder(req.body);
    if ('issue' in parsed) {
      return sendError(reply, 422, parsed.issue, parsed.description, parsed.field);
    }

    const id = store.nextOrderId();
    const order: OrderRecord = {
      id,
      status: 'CREATED',
      purchaseUnits: parsed.units,
      links: [{ href: `${publicUrl}/__sim/orders/${id}/approve`, rel: 'approve', method: 'POST' }],
      captured: false,
    };
    store.orders.set(id, order);

    const body = orderResponse(order);
    if (key) store.idempotency.set(key, body);
    return reply.code(201).send(body);
  });

  app.get('/v2/checkout/orders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = store.orders.get(id);
    if (!order) return sendError(reply, 404, 'RESOURCE_NOT_FOUND', `Order ${id} not found`);
    return reply.code(200).send(orderResponse(order));
  });

  app.post('/__sim/orders/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = store.orders.get(id);
    if (!order) return sendError(reply, 404, 'RESOURCE_NOT_FOUND', `Order ${id} not found`);

    if (!order.captured) order.status = 'APPROVED';
    return reply.code(200).send({ id: order.id, status: order.status });
  });

  app.post('/v2/checkout/orders/:id/capture', async (req, reply) => {
    const key = idempotencyKey(req);
    if (key) {
      const cached = store.idempotency.get(key);
      if (cached !== undefined) {
        return reply.header('x-sim-idempotent-replay', 'true').code(200).send(cached);
      }
    }

    const { id } = req.params as { id: string };
    const order = store.orders.get(id);
    if (!order) return sendError(reply, 404, 'RESOURCE_NOT_FOUND', `Order ${id} not found`);
    if (order.captured) {
      return sendError(reply, 422, 'ORDER_ALREADY_CAPTURED', `Order ${id} was already captured`);
    }
    if (order.status !== 'APPROVED') {
      return sendError(reply, 422, 'ORDER_NOT_APPROVED', `Order ${id} is not approved`);
    }
    if (mockCode(req) === 'INSTRUMENT_DECLINED') {
      return sendError(reply, 422, 'INSTRUMENT_DECLINED', 'The instrument was declined');
    }

    const unit = order.purchaseUnits[0];
    if (!unit) {
      return sendError(reply, 422, 'INVALID_VALUE', 'Order has no purchase unit');
    }

    const capture: CaptureRecord = {
      id: store.nextCaptureId(),
      orderId: order.id,
      amount: { currency_code: unit.amount.currency_code, value: unit.amount.value },
      custom_id: unit.custom_id ?? null,
      refunded: fromMinor(0n, unit.amount.currency_code),
    };
    store.captures.set(capture.id, capture);
    order.captured = true;
    order.status = 'COMPLETED';

    const body = {
      id: order.id,
      status: 'COMPLETED',
      purchase_units: [
        {
          reference_id: unit.reference_id,
          custom_id: capture.custom_id,
          payments: {
            captures: [
              {
                id: capture.id,
                status: 'COMPLETED',
                amount: capture.amount,
                custom_id: capture.custom_id,
                final_capture: true,
              },
            ],
          },
        },
      ],
    };
    if (key) store.idempotency.set(key, body);
    return reply.code(201).send(body);
  });

  app.post('/v2/payments/captures/:id/refund', async (req, reply) => {
    const { id } = req.params as { id: string };
    const capture = store.captures.get(id);
    if (!capture) return sendError(reply, 404, 'RESOURCE_NOT_FOUND', `Capture ${id} not found`);

    const currency = capture.amount.currency_code;
    const body = (req.body ?? {}) as { amount?: unknown };
    let requestedValue: string;

    if (body.amount !== undefined) {
      if (typeof body.amount !== 'object' || body.amount === null) {
        return sendError(reply, 422, 'INVALID_VALUE', 'amount must be an object', 'amount');
      }
      const amount = body.amount as { value?: unknown; currency_code?: unknown };
      const problem = validateAmount(amount.value, amount.currency_code);
      if (problem) {
        return sendError(
          reply,
          422,
          problem.issue,
          `Amount "${String(amount.value)}" is invalid for ${String(amount.currency_code)}`,
          `amount.${problem.field}`,
        );
      }
      if (amount.currency_code !== currency) {
        return sendError(
          reply,
          422,
          'INVALID_VALUE',
          'refund currency must match the capture currency',
          'amount.currency_code',
        );
      }
      requestedValue = amount.value as string;
    } else {
      const remaining =
        toMinor(capture.amount.value, currency) - toMinor(capture.refunded, currency);
      if (remaining <= 0n) {
        return sendError(reply, 422, 'REFUND_AMOUNT_EXCEEDED', 'Capture is fully refunded');
      }
      requestedValue = fromMinor(remaining, currency);
    }

    const remaining = toMinor(capture.amount.value, currency) - toMinor(capture.refunded, currency);
    const requested = toMinor(requestedValue, currency);
    if (requested > remaining) {
      return sendError(
        reply,
        422,
        'REFUND_AMOUNT_EXCEEDED',
        `Refund of ${requestedValue} exceeds the remaining ${fromMinor(remaining, currency)}`,
      );
    }

    const refund: RefundRecord = {
      id: store.nextRefundId(),
      captureId: capture.id,
      amount: { currency_code: currency, value: requestedValue },
    };
    store.refunds.set(refund.id, refund);
    capture.refunded = fromMinor(toMinor(capture.refunded, currency) + requested, currency);

    return reply.code(201).send({
      id: refund.id,
      status: 'COMPLETED',
      amount: refund.amount,
    });
  });

  app.post('/v1/notifications/verify-webhook-signature', async (req, reply) => {
    const body = (req.body ?? {}) as { transmission_sig?: unknown };
    const valid = body.transmission_sig === 'SIM-VALID-SIGNATURE';
    return reply.code(200).send({ verification_status: valid ? 'SUCCESS' : 'FAILURE' });
  });

  app.get('/__sim/state', async (_req, reply) => {
    const orders = [...store.orders.values()].map((order) => {
      const unit = order.purchaseUnits[0];
      return {
        id: order.id,
        status: order.status,
        amount: unit
          ? { currency_code: unit.amount.currency_code, value: unit.amount.value }
          : { currency_code: 'USD', value: '0.00' },
        custom_id: unit?.custom_id ?? null,
      };
    });
    const captures = [...store.captures.values()].map((capture) => ({
      id: capture.id,
      orderId: capture.orderId,
      amount: { ...capture.amount },
      refunded: capture.refunded,
    }));
    const refunds = [...store.refunds.values()].map((refund) => ({
      id: refund.id,
      captureId: refund.captureId,
      amount: { ...refund.amount },
    }));

    return reply.code(200).send({ orders, captures, refunds });
  });

  app.post('/__sim/reset', async (_req, reply) => {
    store.reset();
    return reply.code(200).send({ ok: true });
  });

  const sim: Sim = {
    app,
    reset: () => store.reset(),
  };

  return { sim, setPublicUrl: (url: string) => (publicUrl = url) };
}

/** Creates an unlistened deterministic PayPal simulator. */
export function createSim(opts: { publicUrl?: string } = {}): Sim {
  return createSimInternal(opts.publicUrl ?? DEFAULT_PUBLIC_URL).sim;
}

/** Starts a simulator on a local port and returns its URL and close function. */
export async function startSim(
  opts: { host?: string; port?: number } = {},
): Promise<{ url: string; close(): Promise<void>; sim: Sim }> {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 0;
  const built = createSimInternal(DEFAULT_PUBLIC_URL);

  let url: string;
  try {
    url = await built.sim.app.listen({ host, port });
  } catch (error) {
    await built.sim.app.close().catch(() => undefined);
    throw error;
  }
  built.setPublicUrl(url);

  return {
    url,
    close: () => built.sim.app.close(),
    sim: built.sim,
  };
}
