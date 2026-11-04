import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../test-setup';
import { ScoreGauge } from './ScoreGauge';

describe('ScoreGauge animation', () => {
  it('keeps the accessible label on the final score while the number animates (P2-C03)', () => {
    const { rerender } = render(<ScoreGauge score={70} />);

    expect(
      screen.getByRole('img', { name: 'Payment Safety Score 70 out of 100' }),
    ).toBeInTheDocument();

    rerender(<ScoreGauge score={90} />);

    expect(
      screen.getByRole('img', { name: 'Payment Safety Score 90 out of 100' }),
    ).toBeInTheDocument();
  });

  it('reaches the new score after the animation (P2-C03)', async () => {
    const { rerender } = render(<ScoreGauge score={70} />);

    rerender(<ScoreGauge score={90} />);

    await screen.findByText('90');
    expect(screen.getByTestId('score-gauge')).toHaveTextContent('90');
  });

  it('jumps straight to the new score with prefers-reduced-motion (P2-C03)', () => {
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia);
    try {
      const { rerender } = render(<ScoreGauge score={70} />);

      rerender(<ScoreGauge score={90} />);

      expect(screen.getByTestId('score-gauge')).toHaveTextContent('90');
    } finally {
      spy.mockRestore();
    }
  });
});
