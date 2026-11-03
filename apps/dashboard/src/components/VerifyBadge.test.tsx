import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { VerifyResult } from '@payclinic/contracts';
import '../test-setup';
import { VerifyBadge } from './VerifyBadge';

const verified: VerifyResult = {
  patchId: 'pat-1',
  applied: true,
  started: true,
  invariantPassed: true,
  testsPassed: true,
  verified: true,
  durationMs: 3200,
  log: ['rerun B1: pass'],
  rerunStepIds: [],
};

describe('VerifyBadge', () => {
  it('shows Verified and the duration (P2-C02)', () => {
    render(<VerifyBadge verify={verified} />);

    expect(screen.getByText(/Verified ✓/)).toBeInTheDocument();
    expect(screen.getByText(/3.2 s/)).toBeInTheDocument();
  });

  it('shows Not verified with the last log line (P2-C02)', () => {
    render(
      <VerifyBadge verify={{ ...verified, verified: false, log: ['first', 'rerun failed'] }} />,
    );

    expect(screen.getByText(/Not verified/)).toBeInTheDocument();
    expect(screen.getByText('rerun failed')).toBeInTheDocument();
  });

  it('shows a dash when the verify result is null (P2-C02)', () => {
    render(<VerifyBadge verify={null} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
