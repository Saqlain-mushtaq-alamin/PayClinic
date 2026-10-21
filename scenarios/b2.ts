import type { Cart } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';

export const b2: ScenarioFn = async (ctx) => {
  const cart: Cart = {
    id: 'cart-b2',
    items: [{ sku: 'tee-001', qty: 1 }],
    currency: 'USD',
    expectedTotal: '25.00',
  };
  ctx.declareCart(cart);
  const created = await ctx.checkout({
    cartId: cart.id,
    items: cart.items,
    clientTotal: '1.00',
  });
  if (!created.orderId) return;
  await ctx.approve(created.orderId);
  await ctx.capture(created.orderId);
};
