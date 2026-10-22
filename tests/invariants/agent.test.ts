import { describe, expect, it } from 'vitest';
import type { AgentIntent, AgentPurchase, AgentRunState, RunState } from '@payclinic/contracts';
import { buildState } from '@payclinic/contracts/testing';
import { INVARIANTS } from '@payclinic/core';

const intent = (overrides: Partial<AgentIntent> = {}): AgentIntent => ({
  skus: ['tee-001'],
  maxQtyPerSku: 1,
  budget: '40.00',
  perTxnCap: '30.00',
  currency: 'USD',
  ...overrides,
});

const purchase = (overrides: Partial<AgentPurchase> = {}): AgentPurchase => ({
  orderId: 'p1',
  merchantId: 'demo-store',
  sku: 'tee-001',
  qty: 1,
  amount: '25.00',
  atMs: 1_000,
  ...overrides,
});

const agentState = (overrides: Partial<AgentRunState> = {}): AgentRunState => ({
  intent: intent(),
  allowedMerchants: ['demo-store'],
  dedupeWindowSec: 600,
  purchases: [],
  ...overrides,
});

const stateWith = (agent: AgentRunState): RunState => buildState({ agent });

const run = (key: 'I-07' | 'I-08' | 'I-09', state: RunState) =>
  INVARIANTS[key]!({ trace: [], state });

describe('I-07 agent stays within budget and per-transaction cap', () => {
  it('passes when total spend equals the budget', () => {
    const state = stateWith(
      agentState({
        purchases: [
          purchase({ orderId: 'p1', amount: '20.00' }),
          purchase({ orderId: 'p2', amount: '20.00' }),
        ],
      }),
    );
    const result = run('I-07', state);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('high');
  });

  it('fails when total spend exceeds the budget', () => {
    const state = stateWith(
      agentState({
        purchases: [
          purchase({ orderId: 'p1', amount: '25.00' }),
          purchase({ orderId: 'p2', amount: '25.00' }),
        ],
      }),
    );
    const result = run('I-07', state);
    expect(result.passed).toBe(false);
    expect(result.message).toBe('Agent spent 50.00 against a budget of 40.00');
  });

  it('fails when one purchase exceeds the per-transaction cap', () => {
    const state = stateWith(
      agentState({ purchases: [purchase({ orderId: 'p3', amount: '35.00' })] }),
    );
    const result = run('I-07', state);
    expect(result.passed).toBe(false);
    expect(result.message).toBe('Purchase p3 of 35.00 exceeds the cap 30.00');
  });

  it('passes with message n/a when there is no agent state', () => {
    const result = run('I-07', buildState());
    expect(result.passed).toBe(true);
    expect(result.message).toBe('n/a');
  });
});

describe('I-08 agent buys only intended items from allowed merchants', () => {
  it('passes for an allowed merchant and an intended sku', () => {
    const result = run('I-08', stateWith(agentState({ purchases: [purchase()] })));
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('critical');
  });

  it('fails for a merchant outside the allowlist', () => {
    const state = stateWith(agentState({ purchases: [purchase({ merchantId: 'sketchy-deals' })] }));
    const result = run('I-08', state);
    expect(result.passed).toBe(false);
    expect(result.message).toBe(
      'Purchase p1 is not allowed: merchant sketchy-deals is not allowlisted',
    );
  });

  it('fails for a sku outside the intent', () => {
    const state = stateWith(agentState({ purchases: [purchase({ sku: 'promo-099' })] }));
    const result = run('I-08', state);
    expect(result.passed).toBe(false);
    expect(result.message).toBe('Purchase p1 is not allowed: sku promo-099 is not in the intent');
  });

  it('fails when qty exceeds maxQtyPerSku', () => {
    const state = stateWith(agentState({ purchases: [purchase({ qty: 10 })] }));
    const result = run('I-08', state);
    expect(result.passed).toBe(false);
    expect(result.message).toBe('Purchase p1 is not allowed: qty 10 exceeds the maximum 1');
  });

  it('passes with message n/a when there is no agent state', () => {
    const result = run('I-08', buildState());
    expect(result.passed).toBe(true);
    expect(result.message).toBe('n/a');
  });
});

describe('I-09 no duplicate purchases inside the dedupe window', () => {
  it('fails for two identical purchases 100s apart with a 600s window', () => {
    const state = stateWith(
      agentState({
        purchases: [
          purchase({ orderId: 'p1', atMs: 1_000 }),
          purchase({ orderId: 'p2', atMs: 101_000 }),
        ],
      }),
    );
    const result = run('I-09', state);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('high');
    expect(result.message).toBe('Duplicate purchase of tee-001 within 600s');
  });

  it('passes when identical purchases are 700s apart', () => {
    const state = stateWith(
      agentState({
        purchases: [
          purchase({ orderId: 'p1', atMs: 1_000 }),
          purchase({ orderId: 'p2', atMs: 701_000 }),
        ],
      }),
    );
    const result = run('I-09', state);
    expect(result.passed).toBe(true);
  });

  it('passes with message n/a when there is no agent state', () => {
    const result = run('I-09', buildState());
    expect(result.passed).toBe(true);
    expect(result.message).toBe('n/a');
  });
});
