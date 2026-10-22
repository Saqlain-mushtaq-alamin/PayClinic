import { describe, expect, it } from 'vitest';
import { firewallEngine as fw } from '@payclinic/firewall';
import type { GuardHistory, GuardRequest, Policy } from '@payclinic/contracts';

const policy: Policy = {
  version: 1,
  currency: 'USD',
  perTransactionCap: '30.00',
  sessionBudget: '40.00',
  merchantAllowlist: ['demo-store'],
  approvalThreshold: '25.00',
  duplicateWindowSec: 600,
};
const req = (o: Partial<GuardRequest> = {}): GuardRequest => ({
  tool: 'create_order',
  merchantId: 'demo-store',
  sku: 'tee-001',
  qty: 1,
  amount: '20.00',
  currency: 'USD',
  ...o,
});
const hist = (o: Partial<GuardHistory> = {}): GuardHistory => ({
  sessionSpent: '0.00',
  recentPurchases: [],
  nowMs: 1_000_000,
  ...o,
});

describe('firewall engine', () => {
  it('allows a normal purchase', () =>
    expect(fw.evaluate(req(), policy, hist())).toMatchObject({ action: 'allow', ruleId: null }));
  it('R3 blocks a merchant that is not allowlisted', () => {
    const d = fw.evaluate(req({ merchantId: 'sketchy-deals' }), policy, hist());
    expect(d).toMatchObject({
      action: 'block',
      ruleId: 'R3',
      reason: 'Merchant sketchy-deals is not on the allowlist',
    });
  });
  it('R1 blocks an amount over the per-transaction cap', () =>
    expect(
      fw.evaluate(req({ amount: '99.00' }), { ...policy, approvalThreshold: undefined }, hist()),
    ).toMatchObject({ action: 'block', ruleId: 'R1' }));
  it('R2 blocks when the session budget would be exceeded', () =>
    expect(
      fw.evaluate(req({ amount: '20.00' }), policy, hist({ sessionSpent: '25.00' })),
    ).toMatchObject({ action: 'block', ruleId: 'R2' }));
  it('R2 allows exactly the budget', () =>
    expect(
      fw.evaluate(
        req({ amount: '15.00' }),
        { ...policy, approvalThreshold: undefined },
        hist({ sessionSpent: '25.00' }),
      ).action,
    ).toBe('allow'));
  it('R5 blocks a duplicate inside the window but not outside it', () => {
    const recent = [
      { merchantId: 'demo-store', sku: 'tee-001', qty: 1, atMs: 1_000_000 - 100_000 },
    ];
    expect(fw.evaluate(req(), policy, hist({ recentPurchases: recent }))).toMatchObject({
      action: 'block',
      ruleId: 'R5',
    });
    const old = [{ merchantId: 'demo-store', sku: 'tee-001', qty: 1, atMs: 1_000_000 - 700_000 }];
    expect(fw.evaluate(req(), policy, hist({ recentPurchases: old })).action).not.toBe('block');
  });
  it('R4 escalates (does not block) above the approval threshold', () =>
    expect(fw.evaluate(req({ amount: '28.00' }), policy, hist())).toMatchObject({
      action: 'escalate',
      ruleId: 'R4',
    }));
  it('block rules win over escalation (R3 before R4)', () =>
    expect(fw.evaluate(req({ merchantId: 'x', amount: '28.00' }), policy, hist()).ruleId).toBe(
      'R3',
    ));
  it('skips rules whose policy fields are absent', () =>
    expect(
      fw.evaluate(
        req({ merchantId: 'anything', amount: '999.00' }),
        { version: 1, currency: 'USD' },
        hist(),
      ).action,
    ).toBe('allow'));
  it('compares money exactly (no float error)', () =>
    expect(
      fw.evaluate(
        req({ amount: '0.30' }),
        { version: 1, currency: 'USD', perTransactionCap: '0.30' },
        hist(),
      ).action,
    ).toBe('allow'));
});
