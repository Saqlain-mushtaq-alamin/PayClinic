import { fromMinor, toMinor } from '@payclinic/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StoreDb } from '../db';
import type { PayPalClient } from '../paypal';

export interface RefundOrderDeps {
  db: StoreDb;
  paypal: PayPalClient;
}

interface RefundAmount {
  value: string;
  currency_code: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseAmount(value: unknown): RefundAmount | null {
  const amount = asRecord(value);
  if (!amount) return null;
  if (typeof amount.value !== 'string' || typeof amount.currency_code !== 'string') return null;
  return { value: amount.value, currency_code: amount.currency_code };
}

export async function refundOrder(deps: RefundOrderDeps, req: FastifyRequest, reply: FastifyReply) {
  const { orderId } = req.params as { orderId: string };
  const merchantOrder = deps.db.getByPaypalOrderId(orderId);
  if (!merchantOrder) return reply.code(404).send({ error: 'order not found' });

  const captureId = deps.db.getCaptureId(orderId);
  if (!captureId) return reply.code(409).send({ error: 'order has no capture' });

  const body = (req.body ?? {}) as { amount?: unknown };
  const requested = parseAmount(body.amount);
  const result = await deps.paypal.refund(captureId, body.amount);

  const applied = requested ?? parseAmount(asRecord(result.body)?.amount);
  if (applied) {
    const currency = applied.currency_code;
    const refundedTotal = fromMinor(
      toMinor(merchantOrder.refundedTotal, currency) + toMinor(applied.value, currency),
      currency,
    );
    // BUG B6: refunded total is increased without checking the PayPal result
    deps.db.recordRefund(merchantOrder.id, refundedTotal);
  }

  if (!result.ok) {
    return reply.code(402).send({ status: 'failed', paypal: result.body });
  }

  return reply.code(200).send({ status: 'refunded', refund: result.body });
}
