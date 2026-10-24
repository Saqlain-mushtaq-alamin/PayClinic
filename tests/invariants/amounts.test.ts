import { describe, expect, it } from 'vitest';
import {
  buildCart,
  buildMerchantOrder,
  buildState,
  paypalCreateStep,
  buildStep,
} from '@payclinic/contracts/testing';
import { INVARIANTS } from '@payclinic/core';

const i06 = (trace: any[]) => INVARIANTS['I-06']!({ trace, state: buildState() });
const i03 = (merchantOrders: any[]) =>
  INVARIANTS['I-03']!({ trace: [], state: buildState({ merchantOrders }) });

describe('I-06', () => {
  it('passes for valid USD and JPY amounts', () => {
    expect(
      i06([
        paypalCreateStep({ orderId: 'O1', cartId: 'c', amount: '25.00' }),
        paypalCreateStep({ orderId: 'O2', cartId: 'c', amount: '2400', currency: 'JPY' }),
      ]).passed,
    ).toBe(true);
  });
  it('fails for JPY with decimals and cites the step', () => {
    const s = paypalCreateStep({
      orderId: 'O1',
      cartId: 'c',
      amount: '2400.00',
      currency: 'JPY',
      status: 422,
      body: {},
    });
    const r = i06([s]);
    expect(r).toMatchObject({ passed: false, severity: 'medium', evidenceStepIds: [s.id] });
    expect(r.message).toBe('Amount "2400.00" is invalid for JPY');
  });
  it('fails for float drift', () => {
    expect(
      i06([paypalCreateStep({ orderId: 'O1', cartId: 'c', amount: '0.30000000000000004' })]).passed,
    ).toBe(false);
  });
  it('checks refund bodies too and ignores runner steps', () => {
    const refund = buildStep({
      actor: 'store',
      method: 'POST',
      url: 'http://x/v2/payments/captures/C1/refund',
      requestBody: { amount: { value: '10.005', currency_code: 'USD' } },
    });
    const runner = buildStep({
      actor: 'runner',
      method: 'POST',
      url: 'http://x/api/orders',
      requestBody: { amount: { value: 'abc', currency_code: 'USD' } },
    });
    expect(i06([refund]).passed).toBe(false);
    expect(i06([runner]).passed).toBe(true);
  });
  it('fails for a malformed currency code', () => {
    expect(
      i06([paypalCreateStep({ orderId: 'O1', cartId: 'c', amount: '1.00', currency: 'usd' })])
        .passed,
    ).toBe(false);
  });
});

describe('I-03', () => {
  it('passes when refunds are within the captured amount', () => {
    expect(
      i03([buildMerchantOrder({ capturedTotal: '25.00', refundedTotal: '25.00' })]).passed,
    ).toBe(true);
  });
  it('fails when refunds exceed the capture', () => {
    const r = i03([buildMerchantOrder({ capturedTotal: '25.00', refundedTotal: '40.00' })]);
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Order mo-1 refunded 40.00 of 25.00');
  });
  it('uses the declared cart currency when there is no capture step', () => {
    const state = buildState({
      carts: [buildCart({ id: 'cart-jp', currency: 'JPY', expectedTotal: '2400' })],
      merchantOrders: [
        buildMerchantOrder({
          cartId: 'cart-jp',
          capturedTotal: '2400',
          refundedTotal: '2400.00',
        }),
      ],
    });
    const r = INVARIANTS['I-03']!({ trace: [], state });
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Order mo-1 has unparseable money');
  });
});
