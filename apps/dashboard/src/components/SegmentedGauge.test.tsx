import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SegmentedGauge, getScoreColor, getScoreTone } from './SegmentedGauge';
import '../test-setup';

describe('SegmentedGauge', () => {
  it('renders score value and caption', () => {
    render(
      <SegmentedGauge
        score={85}
        caption="Latest run"
        findingCounts={{ critical: 0, high: 1, medium: 2, low: 3 }}
      />,
    );

    expect(screen.getByRole('img', { name: 'Payment safety score 85 out of 100' })).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('Latest run')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('determines the correct score tone and color', () => {
    expect(getScoreTone(90)).toBe('ok');
    expect(getScoreTone(65)).toBe('warn');
    expect(getScoreTone(40)).toBe('bad');

    expect(getScoreColor(90)).toBe('#22c37a');
    expect(getScoreColor(65)).toBe('#f2b04a');
    expect(getScoreColor(40)).toBe('#ef5b52');
  });

  it('renders filled segments based on score ratio', () => {
    const { container } = render(<SegmentedGauge score={50} totalSegments={12} />);
    const filledSegments = container.querySelectorAll('.segmented-gauge__segment--filled');
    expect(filledSegments).toHaveLength(6);
  });
});
