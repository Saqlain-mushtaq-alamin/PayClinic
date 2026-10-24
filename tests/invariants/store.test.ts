import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GoldenTrace, type InvariantKey } from '@payclinic/contracts';
import {
  buildCart,
  buildMerchantOrder,
  buildState,
  paypalCaptureStep,
  paypalCreateStep,
} from '@payclinic/contracts/testing';
import { findingsFromResults, INVARIANTS, runInvariants } from '@payclinic/core';

const run = (key: 'I-01' | 'I-02' | 'I-04', trace: any[], state = buildState()) =>
  INVARIANTS[key]!({ trace, state });

describe('I-01 one successful capture per cart', () => {
  it('passes with one capture', () => {
    const t = [
      paypalCreateStep({ orderId: 'O1', cartId: 'c1', amount: '25.00' }),
      paypalCaptureStep({ orderId: 'O1', cartId: 'c1', amount: '25.00' }),
    ];
    expect(run('I-01', t).passed).toBe(true);
  });
  it('fails when one cart is captured twice and cites both captures', () => {
    const t = [
      paypalCreateStep({ orderId: 'O1', cartId: 'c1', amount: '25.00' }),
      paypalCreateStep({ orderId: 'O2', cartId: 'c1', amount: '25.00' }),
      paypalCaptureStep({ orderId: 'O1', cartId: 'c1', amount: '25.00' }),
      paypalCaptureStep({ orderId: 'O2', cartId: 'c1', amount: '25.00' }),
    ];
    const r = run('I-01', t);
    expect(r.passed).toBe(false);
    expect(r.severity).toBe('critical');
    expect(r.message).toMatch(/^Cart c1 was captured 2 times/);
    expect(r.evidenceStepIds).toEqual([t[2]!.id, t[3]!.id]);
  });
  it('ignores declined captures and different carts', () => {
    const t = [
      paypalCaptureStep({ orderId: 'O1', cartId: 'c1', amount: '25.00', declined: true }),
      paypalCaptureStep({ orderId: 'O2', cartId: 'c2', amount: '25.00' }),
    ];
    expect(run('I-01', t).passed).toBe(true);
  });
});

describe('I-02 captured amount equals the server-computed total', () => {
  const state = buildState({ carts: [buildCart({ id: 'c1', expectedTotal: '25.00' })] });
  it('passes when equal (25.0 equals 25.00)', () => {
    expect(
      run('I-02', [paypalCaptureStep({ orderId: 'O1', cartId: 'c1', amount: '25.0' })], state)
        .passed,
    ).toBe(true);
  });
  it('fails when the capture is smaller', () => {
    const r = run(
      'I-02',
      [paypalCaptureStep({ orderId: 'O1', cartId: 'c1', amount: '1.00' })],
      state,
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/^Capture O1 charged 1\.00 but cart c1 costs 25\.00/);
  });
  it('skips carts that were not declared', () => {
    expect(
      run('I-02', [paypalCaptureStep({ orderId: 'O1', cartId: 'zzz', amount: '1.00' })], state)
        .passed,
    ).toBe(true);
  });
  it('fails (does not throw) on an unparseable amount', () => {
    expect(
      run('I-02', [paypalCaptureStep({ orderId: 'O1', cartId: 'c1', amount: 'abc' })], state)
        .passed,
    ).toBe(false);
  });
});

describe('I-04 paid if and only if the capture completed', () => {
  it('passes when paid and captured', () => {
    expect(
      run('I-04', [paypalCaptureStep({ orderId: 'ORD0001', cartId: 'cart-1', amount: '25.00' })])
        .passed,
    ).toBe(true);
  });
  it('fails when paid but the capture was declined', () => {
    const r = run('I-04', [
      paypalCaptureStep({ orderId: 'ORD0001', cartId: 'cart-1', amount: '25.00', declined: true }),
    ]);
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Order mo-1 paid=true but capture did not succeed');
  });
  it('fails when captured but not marked paid', () => {
    const state = buildState({
      merchantOrders: [buildMerchantOrder({ paid: false, status: 'failed' })],
    });
    const r = run(
      'I-04',
      [paypalCaptureStep({ orderId: 'ORD0001', cartId: 'cart-1', amount: '25.00' })],
      state,
    );
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Order mo-1 paid=false but capture succeeded');
  });
  it('skips merchant orders without a PayPal order id', () => {
    const state = buildState({
      merchantOrders: [buildMerchantOrder({ paypalOrderId: null, paid: false, status: 'failed' })],
    });
    expect(run('I-04', [], state).passed).toBe(true);
  });
});

describe('golden traces', () => {
  const dir = join(__dirname, '../../packages/contracts/src/samples/traces');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    it(`${f}: failing invariants equal the expectation`, () => {
      const g = GoldenTrace.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      const results = runInvariants(['I-01', 'I-02', 'I-04'], { trace: g.steps, state: g.state });
      expect(
        results
          .filter((r) => !r.passed)
          .map((r) => r.key)
          .sort(),
      ).toEqual([...g.expectedFailingInvariants].sort());
    });
  }
});

describe('findings', () => {
  it('creates one open finding per failed result', () => {
    let i = 0;
    const results = runInvariants(['I-01', 'I-04'], {
      trace: [
        paypalCaptureStep({
          orderId: 'ORD0001',
          cartId: 'cart-1',
          amount: '25.00',
          declined: true,
        }),
      ],
      state: buildState(),
    });
    const f = findingsFromResults({
      runId: 'r',
      scenarioKey: 'B4',
      results,
      newId: () => `f${++i}`,
      now: () => '2026-10-18T10:00:00.000Z',
    });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      id: 'f1',
      invariantKey: 'I-04',
      state: 'open',
      severity: 'critical',
    });
  });
  it('runInvariants throws for an invariant that is not registered yet', () => {
    expect(() =>
      runInvariants(['I-99' as InvariantKey], { trace: [], state: buildState() }),
    ).toThrow();
  });
});
