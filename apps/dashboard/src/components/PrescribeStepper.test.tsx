import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../test-setup';
import { PrescribeStepper } from './PrescribeStepper';

describe('PrescribeStepper', () => {
  it('shows the four stages with the current one active (P2-C03)', () => {
    render(<PrescribeStepper stage="patching" />);

    expect(screen.getByTestId('stage-explaining')).toHaveAttribute('data-complete', 'true');
    expect(screen.getByTestId('stage-patching')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('stage-verifying')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('stage-done')).toHaveAttribute('data-active', 'false');
  });

  it('marks every stage complete when done (P2-C03)', () => {
    render(<PrescribeStepper stage="done" />);

    for (const stage of ['explaining', 'patching', 'verifying', 'done']) {
      expect(screen.getByTestId(`stage-${stage}`)).toHaveAttribute('data-complete', 'true');
    }
  });

  it('marks nothing active while failed (P2-C03)', () => {
    render(<PrescribeStepper stage="failed" />);

    for (const stage of ['explaining', 'patching', 'verifying', 'done']) {
      expect(screen.getByTestId(`stage-${stage}`)).toHaveAttribute('data-active', 'false');
    }
  });
});
