import type { Cart } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';

export const b5: ScenarioFn = async (ctx) => {
  const cart: Cart = {
    id: 'cart-b5',
    items: [{ sku: 'jp-pen-01', qty: 2 }],
    currency: 'JPY',
    expectedTotal: '2400',
  };
  ctx.declareCart(cart);
  const co = await ctx.checkout({ cartId: cart.id, items: cart.items });
  if (co.orderId) {
    await ctx.approve(co.orderId);
    await ctx.capture(co.orderId);
  }
};
