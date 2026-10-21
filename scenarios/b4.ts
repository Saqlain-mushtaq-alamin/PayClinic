import type { Cart } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';

export const b4: ScenarioFn = async (ctx) => {
  const cart: Cart = {
    id: 'cart-b4',
    items: [{ sku: 'tee-001', qty: 1 }],
    currency: 'USD',
    expectedTotal: '25.00',
  };
  ctx.declareCart(cart);
  ctx.chaos.mockNext({
    method: 'POST',
    pathRegex: '/capture$',
    mockCode: 'INSTRUMENT_DECLINED',
  });
  const created = await ctx.checkout({ cartId: cart.id, items: cart.items });
  if (!created.orderId) return;
  await ctx.approve(created.orderId);
  await ctx.capture(created.orderId);
};
