import type { Cart } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';

export const b6: ScenarioFn = async (ctx) => {
  const cart: Cart = {
    id: 'cart-b6',
    items: [{ sku: 'tee-001', qty: 1 }],
    currency: 'USD',
    expectedTotal: '25.00',
  };
  ctx.declareCart(cart);
  const co = await ctx.checkout({ cartId: cart.id, items: cart.items });
  if (!co.orderId) return;
  const orderId = co.orderId;
  await ctx.approve(orderId);
  await ctx.capture(orderId);

  const refund = (value: string, label: string) =>
    ctx.http.request(
      'POST',
      `/api/orders/${encodeURIComponent(orderId)}/refund`,
      { amount: { value, currency_code: cart.currency } },
      { label },
    );
  await refund('20.00', 'Merchant refunds 20.00');
  await refund('20.00', 'Merchant refunds 20.00 again');
};
