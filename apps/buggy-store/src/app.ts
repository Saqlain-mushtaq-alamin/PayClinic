import { assertSafePayPalBase } from '@payclinic/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAdminRoutes } from './admin';
import { listProducts } from './catalog';
import { StoreDb } from './db';
import { captureOrder } from './orders/capture';
import { createOrder } from './orders/create';
import { refundOrder } from './orders/refund';
import { createPayPalClient } from './paypal';
import { handleWebhook, type WebhookEvent } from './webhooks';

export interface CreateAppOptions {
  paypalBaseUrl: string;
  paypalClientId: string;
  paypalClientSecret: string;
  dbPath: string;
  admin?: boolean;
  fetchImpl?: typeof fetch;
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Builds the buggy checkout app without listening. */
export async function createApp(opts: CreateAppOptions): Promise<FastifyInstance> {
  assertSafePayPalBase(opts.paypalBaseUrl);

  const app = Fastify({ logger: false });
  const db = new StoreDb(opts.dbPath);
  const paypal = createPayPalClient({
    baseUrl: opts.paypalBaseUrl,
    clientId: opts.paypalClientId,
    clientSecret: opts.paypalClientSecret,
    fetchImpl: opts.fetchImpl,
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  app.get('/api/products', async () => listProducts());
  app.post('/api/orders', async (req, reply) => createOrder({ db, paypal }, req, reply));
  app.post('/api/orders/:orderId/capture', async (req, reply) =>
    captureOrder({ db, paypal }, req, reply),
  );
  app.post('/api/orders/:orderId/refund', async (req, reply) =>
    refundOrder({ db, paypal }, req, reply),
  );

  app.post('/webhooks/paypal', async (req, reply) => {
    const event = req.body as WebhookEvent | undefined;
    if (!event || typeof event.id !== 'string' || typeof event.event_type !== 'string') {
      return reply.code(400).send({ error: 'invalid event' });
    }
    const deliveryId = readHeader(req.headers, 'x-payclinic-delivery-id') ?? `delivery-${event.id}`;
    const result = handleWebhook({ db, paypal }, deliveryId, req.headers, event);
    return reply.code(result.status).send(result.body);
  });

  if (opts.admin) registerAdminRoutes(app, { db });

  return app;
}
