import type { FastifyReply, FastifyRequest } from 'fastify';
import type { StoreDb } from '../db';
import type { PayPalClient } from '../paypal';

export interface RefundOrderDeps {
  db: StoreDb;
  paypal: PayPalClient;
}

// BUG B6: refunds whatever is requested, without tracking the refunded total.
export async function refundOrder(deps: RefundOrderDeps, req: FastifyRequest, reply: FastifyReply) {
  const { orderId } = req.params as { orderId: string };
  const merchantOrder = deps.db.getByPaypalOrderId(orderId);
  if (!merchantOrder) return reply.code(404).send({ error: 'order not found' });

  const body = (req.body ?? {}) as { amount?: unknown };
  const result = await deps.paypal.refund(orderId, body.amount);
  if (!result.ok) {
    return reply.code(402).send({ status: 'failed', paypal: result.body });
  }

  return reply.code(200).send({ status: 'refunded', refund: result.body });
}
