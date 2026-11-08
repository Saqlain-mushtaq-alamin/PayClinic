import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../test-setup';
import { PrescribeButton } from './PrescribeButton';

describe('PrescribeButton', () => {
  it('starts the flow from idle (P2-C03)', () => {
    const onStart = vi.fn();
    render(<PrescribeButton stage="idle" message={null} onStart={onStart} />);

    fireEvent.click(screen.getByRole('button', { name: /prescribe/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('clicking Prescribe once disables the button immediately', () => {
    const onStart = vi.fn();
    render(<PrescribeButton stage="idle" message={null} onStart={onStart} />);

    const button = screen.getByRole('button', { name: /prescribe/i });
    expect(button).toBeEnabled();

    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a stage is running (P2-C03)', () => {
    render(<PrescribeButton stage="verifying" message={null} onStart={vi.fn()} />);

    expect(screen.getByRole('button', { name: /prescribing/i })).toBeDisabled();
  });

  it('shows the failure message and retries (P2-C03)', () => {
    const onStart = vi.fn();
    render(<PrescribeButton stage="failed" message="no patch verified" onStart={onStart} />);

    expect(screen.getByText('no patch verified')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
