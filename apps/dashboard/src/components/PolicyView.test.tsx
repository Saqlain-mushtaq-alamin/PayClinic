import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Policy } from '@payclinic/contracts';
import '../test-setup';
import { PolicyView } from './PolicyView';

const full: Policy = {
  version: 1,
  currency: 'USD',
  perTransactionCap: '30.00',
  sessionBudget: '40.00',
  merchantAllowlist: ['demo-store', 'other-shop'],
  approvalThreshold: '25.00',
  duplicateWindowSec: 600,
};

const YAML = 'version: 1\ncurrency: USD\nperTransactionCap: "30.00"\n';

describe('PolicyView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each rule with its policy value', () => {
    render(<PolicyView policy={full} yaml={YAML} />);

    expect(screen.getByTestId('rule-R1')).toHaveTextContent('30.00');
    expect(screen.getByTestId('rule-R2')).toHaveTextContent('40.00');
    expect(screen.getByTestId('rule-R3')).toHaveTextContent('demo-store, other-shop');
    expect(screen.getByTestId('rule-R4')).toHaveTextContent('25.00');
    expect(screen.getByTestId('rule-R5')).toHaveTextContent('600s');
  });

  it('shows "not set" for absent rules', () => {
    render(<PolicyView policy={{ version: 1, currency: 'USD' }} yaml={YAML} />);

    for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5']) {
      expect(screen.getByTestId(`rule-${rule}`)).toHaveTextContent('not set');
    }
  });

  it('shows the YAML in a monospace block and copies it to the clipboard', () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    render(<PolicyView policy={full} yaml={YAML} />);
    expect(screen.getByTestId('policy-yaml')).toHaveTextContent('perTransactionCap');

    fireEvent.click(screen.getByRole('button', { name: /copy/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(YAML);
  });

  it('renders nothing when no policy was generated', () => {
    const { container } = render(<PolicyView policy={null} yaml={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
