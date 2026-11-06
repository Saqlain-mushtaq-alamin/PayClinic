import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FirewallDecision } from '@payclinic/contracts';
import '../test-setup';
import { DecisionLog } from './DecisionLog';

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

describe('DecisionLog', () => {
  it('shows the count summary and the decisions', () => {
    render(
      <DecisionLog
        decisions={[
          decision(),
          decision({ id: 'dec-2', action: 'allow', ruleId: null, reason: 'Allowed by policy' }),
        ]}
      />,
    );

    expect(screen.getByTestId('decision-summary')).toHaveTextContent('1 blocked, 1 allowed');
    expect(screen.getByTestId('decision-grid')).toBeInTheDocument();
  });

  it('says when there are no decisions', () => {
    render(<DecisionLog decisions={[]} />);
    expect(screen.getByTestId('decision-summary')).toHaveTextContent('No decisions');
  });
});
