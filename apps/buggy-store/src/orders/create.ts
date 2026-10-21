import { fromMinor } from '@payclinic/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { findProduct } from '../catalog';
import type { StoreDb } from '../db';
import { computeTotal, formatAmount } from '../money';
import type { PayPalClient } from '../paypal';
import { resolveAmount } from './pricing';

export interface CreateOrderDeps {
  db: StoreDb;
  paypal: PayPalClient;
}

const CreateOrderInput = z.object({
  cartId: z.string().min(1),
  items: z.array(z.object({ sku: z.string().min(1), qty: z.number().int().positive() })).min(1),
  currency: z.string().optional(),
  clientTotal: z.string().optional(),
});

function parseCreateOrderBody(raw: unknown): z.infer<typeof CreateOrderInput> | null {
  const parsed = CreateOrderInput.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function createOrder(deps: CreateOrderDeps, req: FastifyRequest, reply: FastifyReply) {
  const parsed = parseCreateOrderBody(req.body);
  if (!parsed) return reply.code(400).send({ error: 'invalid body' });

  const { cartId, items } = parsed;
  const catalogItems = items.map((item) => ({ item, product: findProduct(item.sku) }));
  const missing = catalogItems.find((entry) => entry.product === undefined);
  if (missing) {
    return reply.code(400).send({ error: 'unknown sku', sku: missing.item.sku });
  }

  const priced = catalogItems.map((entry) => ({
    price: entry.product!.price,
    qty: entry.item.qty,
  }));
  const first = catalogItems[0]!.product!;
  const currency = parsed.currency ?? first.currency;
  const serverTotal = formatAmount(computeTotal(priced), currency);
  const value = resolveAmount(serverTotal, parsed.clientTotal);

  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: first.merchantId,
        custom_id: cartId,
        amount: { currency_code: currency, value },
      },
    ],
  };
  const order = await deps.paypal.createOrder(body); // BUG B1: no requestId, so a double click creates two PayPal orders
  if (!order.ok) {
    return reply.code(502).send({ error: 'paypal create failed', paypal: order.body });
  }

  const orderId = order.body?.id;
  if (typeof orderId !== 'string') {
    return reply.code(502).send({ error: 'paypal create failed', paypal: order.body });
  }

  const links = Array.isArray(order.body?.links)
    ? (order.body.links as Array<{ href?: string; rel?: string }>)
    : [];
  const approveUrl =
    links.find((link) => link.rel === 'approve' || link.rel === 'payer-action')?.href ?? '';

  const zero = fromMinor(0n, currency);
  const merchantOrder = deps.db.upsertMerchantOrderByPaypalId({
    id: `mo-${orderId}`,
    cartId,
    paypalOrderId: orderId,
    status: 'created',
    paid: false,
    capturedTotal: zero,
    refundedTotal: zero,
  });

  return reply.code(201).send({
    merchantOrderId: merchantOrder.id,
    orderId,
    approveUrl,
  });
}
