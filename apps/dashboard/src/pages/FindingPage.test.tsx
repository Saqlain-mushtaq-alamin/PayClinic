import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FindingDetail, RunDetail, RunEvent } from '@payclinic/contracts';
import mockData from '../../../../fixtures/mock/mock-data.json';
import { API_BASE_URL } from '../api/client';
import type { RunEventSourceCtor, RunEventSourceLike } from '../api/useRunEvents';
import '../test-setup';
import { FindingPage } from './FindingPage';

const open = mockData.findingDetails['fnd-run-1-1'] as unknown as FindingDetail;
const verified = mockData.findingDetails['fnd-run-2-1'] as unknown as FindingDetail;
const run1 = mockData.details['run-1'] as unknown as RunDetail;
const run2 = mockData.details['run-2'] as unknown as RunDetail;

interface PageClient {
  getFinding: (id: string) => Promise<FindingDetail>;
  getRun: (id: string) => Promise<RunDetail>;
  prescribe: (id: string) => Promise<{ accepted: true }>;
}

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

type ProgressStage = Extract<RunEvent, { type: 'prescribe.progress' }>['stage'];

const progress = (stage: ProgressStage, message: string): RunEvent => ({
  type: 'prescribe.progress',
  findingId: 'fnd-run-1-1',
  stage,
  message,
});

function renderPage(client: PageClient, eventSourceCtor?: RunEventSourceCtor) {
  return render(
    <MemoryRouter initialEntries={['/runs/run-1/findings/fnd-run-1-1']}>
      <Routes>
        <Route
          path="/runs/:id/findings/:fid"
          element={<FindingPage client={client} eventSourceCtor={eventSourceCtor} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FindingPage', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('shows the explanation, the diff and Verified for a verified finding (P2-C02)', async () => {
    renderPage({
      getFinding: async () => verified,
      getRun: async () => run2,
      prescribe: async () => ({ accepted: true }),
    });

    expect(
      await screen.findByRole('heading', { name: verified.finding.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(verified.finding.summary)).toBeInTheDocument();
    expect(screen.getByText(/root cause/i)).toBeInTheDocument();
    expect(screen.getByText(/Verified/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prescribe/i })).not.toBeInTheDocument();
  });

  it('shows no diff and a dash for an open finding (P2-C02)', async () => {
    const { container } = renderPage({
      getFinding: async () => open,
      getRun: async () => run1,
      prescribe: async () => ({ accepted: true }),
    });

    expect(await screen.findByRole('heading', { name: open.finding.title })).toBeInTheDocument();
    expect(screen.queryByTestId('diff')).not.toBeInTheDocument();
    expect(container.querySelector('.diff')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/root cause/i)).not.toBeInTheDocument();
  });

  it('posts once and shows the explaining stage when Prescribe is clicked (P2-C03)', async () => {
    const client: PageClient = {
      getFinding: vi.fn(async () => open),
      getRun: vi.fn(async () => run1),
      prescribe: vi.fn(async () => ({ accepted: true as const })),
    };
    renderPage(client, FakeEventSource);

    fireEvent.click(await screen.findByRole('button', { name: /prescribe/i }));

    expect(client.prescribe).toHaveBeenCalledTimes(1);
    expect(client.prescribe).toHaveBeenCalledWith('fnd-run-1-1');
    expect(screen.getByTestId('stage-explaining')).toHaveAttribute('data-active', 'true');
    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toBe(`${API_BASE_URL}/api/runs/run-1/events`);
  });

  it('clicking Prescribe once disables the button immediately', async () => {
    const prescribePromise = new Promise<{ accepted: true }>(() => {});
    const client: PageClient = {
      getFinding: vi.fn(async () => open),
      getRun: vi.fn(async () => run1),
      prescribe: vi.fn(() => prescribePromise),
    };
    renderPage(client, FakeEventSource);

    const btn = await screen.findByRole('button', { name: /prescribe/i });
    expect(btn).toBeEnabled();

    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(client.prescribe).toHaveBeenCalledTimes(1);
  });

  it('advances the stepper as stage events arrive (P2-C03)', async () => {
    renderPage(
      {
        getFinding: async () => open,
        getRun: async () => run1,
        prescribe: async () => ({ accepted: true }),
      },
      FakeEventSource,
    );

    fireEvent.click(await screen.findByRole('button', { name: /prescribe/i }));
    const source = instances[0]!;

    act(() => source.emit(JSON.stringify(progress('patching', 'patching fnd-run-1-1'))));
    expect(screen.getByTestId('stage-patching')).toHaveAttribute('data-active', 'true');

    act(() => source.emit(JSON.stringify(progress('verifying', 'verifying fnd-run-1-1'))));
    expect(screen.getByTestId('stage-verifying')).toHaveAttribute('data-active', 'true');
  });

  it('reloads the finding and the run score when the flow is done (P2-C03)', async () => {
    const verifiedLater: FindingDetail = {
      ...open,
      finding: { ...open.finding, state: 'verified' },
    };
    let findingCall = 0;
    const client: PageClient = {
      getFinding: vi.fn(async () => (findingCall++ === 0 ? open : verifiedLater)),
      getRun: vi.fn(async () => run1),
      prescribe: vi.fn(async () => ({ accepted: true as const })),
    };
    renderPage(client, FakeEventSource);

    fireEvent.click(await screen.findByRole('button', { name: /prescribe/i }));
    const source = instances[0]!;
    act(() => source.emit(JSON.stringify(progress('done', 'done fnd-run-1-1'))));

    await waitFor(() => expect(client.getFinding).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.getRun).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prescribe/i })).not.toBeInTheDocument();
  });

  it('shows the failure message and retries (P2-C03)', async () => {
    const client: PageClient = {
      getFinding: vi.fn(async () => open),
      getRun: vi.fn(async () => run1),
      prescribe: vi.fn(async () => ({ accepted: true as const })),
    };
    renderPage(client, FakeEventSource);

    fireEvent.click(await screen.findByRole('button', { name: /prescribe/i }));
    const source = instances[0]!;
    act(() => source.emit(JSON.stringify(progress('failed', 'no patch verified'))));

    expect(await screen.findByText('no patch verified')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(client.prescribe).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('stage-explaining')).toHaveAttribute('data-active', 'true');
    expect(instances).toHaveLength(2);
  });

  it('renders a back link to the run page and Open PR button for verified findings', async () => {
    renderPage({
      getFinding: async () => verified,
      getRun: async () => run2,
      prescribe: async () => ({ accepted: true }),
    });

    const backLink = await screen.findByRole('link', { name: /Back to run/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', `/runs/${verified.finding.runId}`);
    expect(screen.getByTestId('open-pr-button')).toBeInTheDocument();
  });

  it('hides the Prescribe button for protected findings', async () => {
    const protectedFinding: FindingDetail = {
      ...open,
      finding: { ...open.finding, state: 'protected' },
    };
    renderPage({
      getFinding: async () => protectedFinding,
      getRun: async () => run1,
      prescribe: async () => ({ accepted: true }),
    });

    await screen.findByRole('heading', { name: protectedFinding.finding.title });
    expect(screen.queryByRole('button', { name: /prescribe/i })).not.toBeInTheDocument();
  });
});
