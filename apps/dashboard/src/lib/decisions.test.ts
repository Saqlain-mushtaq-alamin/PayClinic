import { describe, expect, it } from 'vitest';
import type { FirewallDecision } from '@payclinic/contracts';
import { summarizeDecisions, toDecisionRows } from './decisions';

const decision = (over: Partial<FirewallDecision> = {}): FirewallDecision => ({
  id: 'dec-1',
  runId: 'run-3',
  action: 'block',
  ruleId: 'R3',
  reason: 'Merchant sketchy-deals is not on the allowlist',
  request: {
    tool: 'create_order',
    merchantId: 'sketchy-deals',
    sku: 'promo-099',
    qty: 10,
    amount: '99.00',
    currency: 'USD',
  },
  ts: '2026-10-18T10:00:00.000Z',
  ...over,
});

describe('toDecisionRows', () => {
  it('maps a decision to the grid row fields', () => {
    expect(toDecisionRows([decision()])).toEqual([
      {
        id: 'dec-1',
        time: '2026-10-18T10:00:00.000Z',
        action: 'block',
        rule: 'R3',
        reason: 'Merchant sketchy-deals is not on the allowlist',
        merchant: 'sketchy-deals',
        sku: 'promo-099',
        qty: 10,
        amount: '99.00',
      },
    ]);
  });

  it('shows a dash for the rule of an allow decision', () => {
    const rows = toDecisionRows([decision({ action: 'allow', ruleId: null })]);
    expect(rows[0]?.rule).toBe('—');
    expect(rows[0]?.action).toBe('allow');
  });
});

describe('summarizeDecisions', () => {
  it('counts blocked and allowed decisions', () => {
    const decisions = [
      decision({ id: 'a' }),
      decision({ id: 'b', action: 'allow', ruleId: null }),
      decision({ id: 'c' }),
      decision({ id: 'd' }),
      decision({ id: 'e', action: 'allow', ruleId: null }),
    ];
    expect(summarizeDecisions(decisions)).toBe('3 blocked, 2 allowed');
  });

  it('mentions escalated decisions too', () => {
    const decisions = [
      decision({ id: 'a', action: 'escalate', ruleId: 'R4' }),
      decision({ id: 'b' }),
    ];
    expect(summarizeDecisions(decisions)).toBe('1 blocked, 1 escalated');
  });

  it('says when there are no decisions', () => {
    expect(summarizeDecisions([])).toBe('No decisions');
  });
});
