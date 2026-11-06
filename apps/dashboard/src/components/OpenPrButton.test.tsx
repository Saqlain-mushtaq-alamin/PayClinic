import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OpenPrResponse } from '@payclinic/contracts';
import '../test-setup';
import { OpenPrButton } from './OpenPrButton';

describe('OpenPrButton', () => {
  it('posts once and shows the PR link', async () => {
    const openPr = vi.fn<(id: string) => Promise<OpenPrResponse>>(async () => ({
      prUrl: 'https://github.com/demo/payclinic-demo/pull/7',
    }));
    render(<OpenPrButton findingId="fnd-1" client={{ openPr }} />);

    fireEvent.click(screen.getByRole('button', { name: /open pr/i }));

    await waitFor(() => expect(openPr).toHaveBeenCalledTimes(1));
    expect(openPr).toHaveBeenCalledWith('fnd-1');
    const link = await screen.findByTestId('open-pr-link');
    expect(link).toHaveAttribute('href', 'https://github.com/demo/payclinic-demo/pull/7');
  });

  it('shows the reason and disables the button when no PR was opened', async () => {
    const openPr = vi.fn<(id: string) => Promise<OpenPrResponse>>(async () => ({
      prUrl: null,
      reason: 'GitHub is not configured',
    }));
    render(<OpenPrButton findingId="fnd-1" client={{ openPr }} />);

    fireEvent.click(screen.getByRole('button', { name: /open pr/i }));

    expect(await screen.findByText('GitHub is not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open pr/i })).toBeDisabled();
  });

  it('shows an error and allows a retry when the request fails', async () => {
    let calls = 0;
    const openPr = vi.fn<(id: string) => Promise<OpenPrResponse>>(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return { prUrl: 'https://github.com/demo/payclinic-demo/pull/8' };
    });
    render(<OpenPrButton findingId="fnd-1" client={{ openPr }} />);

    fireEvent.click(screen.getByRole('button', { name: /open pr/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByTestId('open-pr-link')).toHaveAttribute(
      'href',
      'https://github.com/demo/payclinic-demo/pull/8',
    );
  });
});
