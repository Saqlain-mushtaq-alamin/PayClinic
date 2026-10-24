import type { Cart } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';

export const b3: ScenarioFn = async (ctx) => {
  const cart: Cart = {
    id: 'cart-b3',
    items: [{ sku: 'mug-003', qty: 1 }],
    currency: 'USD',
    expectedTotal: '12.00',
  };
  ctx.declareCart(cart);
  const co = await ctx.checkout({ cartId: cart.id, items: cart.items });
  if (co.orderId) {
    await ctx.approve(co.orderId);
    await ctx.capture(co.orderId);
  }
  const event = (id: string) => ({
    id,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { id: 'CAP0001', custom_id: cart.id },
  });
  const deliver = (deliveryId: string, eventId: string, sig: string) =>
    ctx.http.request('POST', '/webhooks/paypal', event(eventId), {
      label: `Webhook delivery ${deliveryId}`,
      headers: {
        'x-payclinic-delivery-id': deliveryId,
        'paypal-transmission-sig': sig,
      },
    });
  await deliver('d-1', 'WH-EVT-1', 'SIM-VALID-SIGNATURE');
  await deliver('d-2', 'WH-EVT-1', 'SIM-VALID-SIGNATURE');
  ctx.declareForgedDelivery('d-forged');
  await deliver('d-forged', 'WH-EVT-2', 'FORGED');
};
