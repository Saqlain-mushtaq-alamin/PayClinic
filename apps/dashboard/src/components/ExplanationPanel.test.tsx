import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Explanation } from '@payclinic/contracts';
import '../test-setup';
import { ExplanationPanel } from './ExplanationPanel';

const base: Explanation = {
  findingId: 'fnd-2',
  rootCause: 'stale cart lookup',
  impact: 'customer charged twice',
  whereInCode: { file: 'apps/buggy-store/src/orders/create.ts', hint: 'createOrder call' },
  fixSummary: 'reuse the PayPal order id',
  model: 'gemini-2.5-flash',
  createdAt: '2026-10-18T10:00:00.000Z',
};

describe('ExplanationPanel', () => {
  it('shows the explanation sections and the model tag (P2-C02)', () => {
    render(<ExplanationPanel explanation={base} />);

    expect(screen.getByText(/stale cart lookup/)).toBeInTheDocument();
    expect(screen.getByText(/customer charged twice/)).toBeInTheDocument();
    expect(screen.getByText(/reuse the PayPal order id/)).toBeInTheDocument();
    expect(screen.queryByText('Reference fix')).not.toBeInTheDocument();
    expect(screen.getByText('gemini-2.5-flash')).toBeInTheDocument();
  });

  it('labels a template explanation as Reference fix (P2-C02)', () => {
    render(<ExplanationPanel explanation={{ ...base, model: 'template' }} />);

    expect(screen.getByText('Reference fix')).toBeInTheDocument();
  });
});
