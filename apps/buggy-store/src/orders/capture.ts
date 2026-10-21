import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StoreDb } from '../db';
import type { PayPalClient } from '../paypal';
import { finalizeCapture } from './finalize';

export interface CaptureOrderDeps {
  db: StoreDb;
  paypal: PayPalClient;
}

export async function captureOrder(
  deps: CaptureOrderDeps,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const { orderId } = req.params as { orderId: string };
  const merchantOrder = deps.db.getByPaypalOrderId(orderId);
  if (!merchantOrder) return reply.code(404).send({ error: 'order not found' });

  const result = await deps.paypal.captureOrder(orderId);
  const finalized = finalizeCapture(deps.db, merchantOrder.id, result);

  if (finalized.ok) {
    return reply.code(200).send({ merchantOrderId: merchantOrder.id, status: 'paid' });
  }

  deps.db.markFailedIfUnpaid(merchantOrder.id);
  return reply.code(402).send({ status: 'failed', paypal: result.body });
}
