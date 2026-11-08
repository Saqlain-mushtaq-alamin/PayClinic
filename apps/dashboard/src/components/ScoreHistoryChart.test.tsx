import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '@payclinic/contracts';
import { ScoreHistoryChart } from './ScoreHistoryChart';
import '../test-setup';

const mockRuns: RunSummary[] = [
  {
    id: 'run-1',
    target: 'store',
    mode: 'offline',
    status: 'completed',
    scenarioKeys: ['B1'],
    startedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    score: { score: 70, penalties: [], unresolvedCount: 1, resolvedCount: 0 },
    findingCount: 1,
  },
  {
    id: 'run-2',
    target: 'store',
    mode: 'offline',
    status: 'completed',
    scenarioKeys: ['B2'],
    startedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    score: { score: 95, penalties: [], unresolvedCount: 0, resolvedCount: 1 },
    findingCount: 0,
  },
];

describe('ScoreHistoryChart', () => {
  it('renders title and time filter dropdown', () => {
    render(<ScoreHistoryChart runs={mockRuns} />);

    expect(screen.getByText('Score history')).toBeInTheDocument();
    expect(screen.getByText('Last 10 evaluations')).toBeInTheDocument();
    const select = screen.getByLabelText('Filter time range');
    expect(select).toBeInTheDocument();
  });

  it('allows switching time range filter', () => {
    render(<ScoreHistoryChart runs={mockRuns} />);

    const select = screen.getByLabelText('Filter time range') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '7d' } });
    expect(select.value).toBe('7d');

    fireEvent.change(select, { target: { value: '30d' } });
    expect(select.value).toBe('30d');
  });

  it('shows empty state when no runs exist', () => {
    render(<ScoreHistoryChart runs={[]} />);
    expect(screen.getByText('No score history available for this range')).toBeInTheDocument();
  });
});

