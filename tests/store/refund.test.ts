import { afterEach, describe, expect, it } from 'vitest';
import { startStack } from '../helpers/stack';

let stack: Awaited<ReturnType<typeof startStack>>;
afterEach(async () => {
  await stack?.close();
});

const tee = { cartId: 'c6', items: [{ sku: 'tee-001', qty: 1 }] };

describe('B6 refunds', () => {
  it('refunds against the stored capture and tracks the refunded total', async () => {
    stack = await startStack();
    const { orderId } = (await stack.create(tee)).json();
    await stack.approve(orderId);
    expect((await stack.capture(orderId)).statusCode).toBe(200);

    const refund = (value: string) =>
      stack.store.inject({
        method: 'POST',
        url: `/api/orders/${orderId}/refund`,
        payload: { amount: { value, currency_code: 'USD' } },
      });

    const first = await refund('20.00');
    expect(first.statusCode).toBe(200);
    expect((await stack.state()).merchantOrders[0].refundedTotal).toBe('20.00');
    expect((await stack.simState()).refunds).toHaveLength(1);

    const second = await refund('20.00');
    expect(second.statusCode).toBe(402);
    expect((await stack.state()).merchantOrders[0].refundedTotal).toBe('40.00');
    expect((await stack.simState()).refunds).toHaveLength(1);
  });
});
