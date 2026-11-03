import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Finding, Run, RunEvent, Score } from '@payclinic/contracts';
import '../test-setup';
import { RunProgress } from './RunProgress';

const T = '2026-10-18T10:00:00.000Z';

const run: Run = {
  id: 'run-1',
  target: 'store',
  mode: 'offline',
  scenarioKeys: ['B2'],
  status: 'running',
  startedAt: T,
};

const finding: Finding = {
  id: 'fnd-run-1-1',
  runId: 'run-1',
  scenarioKey: 'B2',
  invariantKey: 'I-01',
  severity: 'critical',
  state: 'open',
  title: 'Customer charged twice for one cart',
  summary: 'Cart cart-1 was captured 2 times.',
  evidenceStepIds: [],
  createdAt: T,
};

const score: Score = { score: 70, penalties: [], unresolvedCount: 2, resolvedCount: 0 };

const events: RunEvent[] = [
  { type: 'run.started', run },
  {
    type: 'scenario.started',
    scenario: { id: 'scn-1', runId: 'run-1', key: 'B2', status: 'running' },
  },
  { type: 'finding.created', finding },
  { type: 'score.updated', score },
  { type: 'run.completed', run: { ...run, status: 'completed' } },
];

describe('RunProgress', () => {
  it('renders one line per shown event type (P2-C01)', () => {
    render(<RunProgress events={events} />);

    const lines = screen.getAllByTestId('run-progress-line');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent('Running B2…');
    expect(lines[1]).toHaveTextContent('Customer charged twice for one cart');
    expect(lines[1]).toHaveTextContent('critical');
    expect(lines[2]).toHaveTextContent('Done, score 70');
  });

  it('renders a failed line for run.failed (P2-C01)', () => {
    render(
      <RunProgress events={[{ type: 'run.failed', runId: 'run-1', error: 'cart crashed' }]} />,
    );

    expect(screen.getByTestId('run-progress-line')).toHaveTextContent('Failed: cart crashed');
  });

  it('renders nothing for an empty event list (P2-C01)', () => {
    const { queryByTestId } = render(<RunProgress events={[]} />);

    expect(queryByTestId('run-progress-line')).not.toBeInTheDocument();
  });
});
