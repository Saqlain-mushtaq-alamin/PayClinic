import type { Cart } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';

export const b1: ScenarioFn = async (ctx) => {
  const cart: Cart = {
    id: 'cart-b1',
    items: [{ sku: 'tee-001', qty: 1 }],
    currency: 'USD',
    expectedTotal: '25.00',
  };
  ctx.declareCart(cart);
  const results = await Promise.all([
    ctx.checkout({ cartId: cart.id, items: cart.items }),
    ctx.checkout({ cartId: cart.id, items: cart.items }),
  ]);
  const orderIds = [...new Set(results.map((r) => r.orderId).filter((x): x is string => !!x))];
  for (const id of orderIds) {
    await ctx.approve(id);
    await ctx.capture(id);
  }
  if (orderIds[0]) await ctx.capture(orderIds[0]);
};
