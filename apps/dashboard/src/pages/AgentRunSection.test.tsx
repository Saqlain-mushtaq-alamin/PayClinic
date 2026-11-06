import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Finding, FirewallDecision, PolicyResponse, RunDetail } from '@payclinic/contracts';
import mockData from '../../../../fixtures/mock/mock-data.json';
import type { ApiClient } from '../api/client';
import type { RunEventSourceCtor, RunEventSourceLike } from '../api/useRunEvents';
import '../test-setup';
import { AgentRunSection } from './AgentRunSection';

const policyResponse = mockData.policies['run-3'] as unknown as PolicyResponse;
const decisions = mockData.decisions['run-3'] as unknown as FirewallDecision[];
const agentRun = mockData.details['run-3'] as unknown as RunDetail;

const mockFinding = agentRun.findings[0]!;
const openFinding: Finding = { ...mockFinding, id: 'fnd-open', state: 'open' };

const instances: FakeEventSource[] = [];

class FakeEventSource implements RunEventSourceLike {
  readonly url: string;
  onopen: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data?: unknown }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }

  emit(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  close(): void {
    this.closed = true;
  }
}

interface SectionClient {
  protect: (id: string) => Promise<{ accepted: true }>;
  getPolicy: (id: string) => Promise<PolicyResponse>;
  getDecisions: (id: string) => Promise<FirewallDecision[]>;
}

function renderSection(
  client: SectionClient,
  options: { findings?: Finding[]; eventSourceCtor?: RunEventSourceCtor; reload?: () => void } = {},
) {
  return render(
    <AgentRunSection
      runId="run-3"
      findings={options.findings ?? [openFinding]}
      reload={options.reload}
      client={client as Partial<Pick<ApiClient, 'protect' | 'getPolicy' | 'getDecisions'>>}
      eventSourceCtor={options.eventSourceCtor}
    />,
  );
}

beforeEach(() => {
  instances.length = 0;
});

describe('AgentRunSection', () => {
  it('shows the policy, the decision log and the Protect button for an agent run', async () => {
    renderSection({
      protect: async () => ({ accepted: true }),
      getPolicy: async () => policyResponse,
      getDecisions: async () => decisions,
    });

    expect(await screen.findByTestId('policy-yaml')).toBeInTheDocument();
    expect(screen.getByTestId('decision-summary')).toHaveTextContent('1 blocked');
    expect(screen.getByRole('button', { name: /protect/i })).toBeInTheDocument();
  });

  it('posts protect once and disables the button while running', async () => {
    const protect = vi.fn<(id: string) => Promise<{ accepted: true }>>(
      () => new Promise(() => undefined),
    );
    renderSection(
      { protect, getPolicy: async () => policyResponse, getDecisions: async () => decisions },
      { eventSourceCtor: FakeEventSource },
    );

    const button = await screen.findByRole('button', { name: /protect/i });
    fireEvent.click(button);

    await waitFor(() => expect(protect).toHaveBeenCalledTimes(1));
    expect(protect).toHaveBeenCalledWith('run-3');
    expect(screen.getByRole('button', { name: /protecting/i })).toBeDisabled();
  });

  it('hides the Protect button and completes the stepper when all findings are protected', () => {
    renderSection(
      {
        protect: async () => ({ accepted: true }),
        getPolicy: async () => policyResponse,
        getDecisions: async () => decisions,
      },
      { findings: agentRun.findings },
    );

    expect(screen.queryByRole('button', { name: /protect/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('stage-generating')).toHaveAttribute('data-complete', 'true');
    expect(screen.getByTestId('stage-verifying')).toHaveAttribute('data-complete', 'true');
  });

  it('shows the server message when protect is rejected with 409', async () => {
    const failure = Object.assign(new Error('run is already protected'), { status: 409 });
    renderSection(
      {
        protect: vi.fn(async () => {
          throw failure;
        }),
        getPolicy: async () => policyResponse,
        getDecisions: async () => decisions,
      },
      { eventSourceCtor: FakeEventSource },
    );

    fireEvent.click(await screen.findByRole('button', { name: /protect/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('run is already protected');
  });

  it('advances the stepper from decision.recorded and score.updated events', async () => {
    renderSection(
      {
        protect: async () => ({ accepted: true }),
        getPolicy: async () => policyResponse,
        getDecisions: async () => decisions,
      },
      { eventSourceCtor: FakeEventSource },
    );

    fireEvent.click(await screen.findByRole('button', { name: /protect/i }));
    const source = instances[0]!;

    act(() => source.emit(JSON.stringify({ type: 'decision.recorded', decision: decisions[0] })));
    expect(screen.getByTestId('stage-generating')).toHaveAttribute('data-active', 'false');
    expect(screen.getByTestId('stage-rerunning')).toHaveAttribute('data-active', 'true');

    act(() => source.emit(JSON.stringify({ type: 'score.updated', score: agentRun.score })));
    expect(screen.getByTestId('stage-verifying')).toHaveAttribute('data-active', 'true');
  });

  it('appends live decisions from events to the log', async () => {
    renderSection(
      {
        protect: async () => ({ accepted: true }),
        getPolicy: async () => policyResponse,
        getDecisions: async () => [],
      },
      { eventSourceCtor: FakeEventSource },
    );

    await screen.findByTestId('decision-summary');
    expect(screen.getByTestId('decision-summary')).toHaveTextContent('No decisions');

    fireEvent.click(screen.getByRole('button', { name: /protect/i }));
    const source = instances[0]!;
    act(() => source.emit(JSON.stringify({ type: 'decision.recorded', decision: decisions[0] })));

    expect(screen.getByTestId('decision-summary')).toHaveTextContent('1 blocked');
  });
});
