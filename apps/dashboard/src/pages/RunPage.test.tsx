import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunDetail } from '@payclinic/contracts';
import mockData from '../../../../fixtures/mock/mock-data.json';
import type { RunEventSourceCtor, RunEventSourceLike } from '../api/useRunEvents';
import '../test-setup';
import { RunPage } from './RunPage';

const detail = mockData.details['run-1'] as unknown as RunDetail;

interface PageClient {
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

function renderPage(client: PageClient, eventSourceCtor?: RunEventSourceCtor) {
  return render(
    <MemoryRouter initialEntries={['/runs/run-1']}>
      <Routes>
        <Route
          path="/runs/:id"
          element={<RunPage client={client} eventSourceCtor={eventSourceCtor} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function deferred() {
  let resolve!: (value: { accepted: true }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ accepted: true }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RunPage', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('shows the score and mounts the findings grid', async () => {
    renderPage({ getRun: async () => detail, prescribe: async () => ({ accepted: true }) });
    expect(await screen.findByTestId('score-gauge')).toHaveTextContent('70');
    expect(screen.getByTestId('findings-grid')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /run-1/i })).toBeInTheDocument();
  });

  it('updates the score live from score.updated events (P2-C03)', async () => {
    renderPage(
      { getRun: async () => detail, prescribe: async () => ({ accepted: true }) },
      FakeEventSource,
    );
    await screen.findByTestId('score-gauge');
    const source = instances[0]!;

    act(() =>
      source.emit(
        JSON.stringify({
          type: 'score.updated',
          score: { score: 85, penalties: [], unresolvedCount: 1, resolvedCount: 0 },
        }),
      ),
    );

    expect(
      await screen.findByRole('img', { name: 'Payment Safety Score 85 out of 100' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('score-gauge')).toHaveTextContent('70 → 85');
  });

  it('reloads the run when a live run completes so findings appear (P2-C03)', async () => {
    const running = { ...detail, run: { ...detail.run, status: 'running' as const } };
    let call = 0;
    const getRun = vi.fn(async () => (call++ === 0 ? running : detail));
    renderPage({ getRun, prescribe: async () => ({ accepted: true }) }, FakeEventSource);
    await screen.findByTestId('findings-grid');
    const source = instances[0]!;

    act(() =>
      source.emit(
        JSON.stringify({ type: 'run.completed', run: { ...detail.run, status: 'completed' } }),
      ),
    );

    await waitFor(() => expect(getRun).toHaveBeenCalledTimes(2));
  });

  it('posts one prescribe at a time, in order, for Fix all (P2-C03)', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const prescribe = vi.fn((id: string) => gates[Number(id.slice(-1)) - 1]!.promise);
    const getRun = vi.fn(async () => detail);
    renderPage({ getRun, prescribe });

    fireEvent.click(await screen.findByRole('button', { name: /fix all/i }));

    expect(prescribe).toHaveBeenCalledTimes(1);
    expect(prescribe).toHaveBeenNthCalledWith(1, 'fnd-run-1-1');

    await act(async () => {
      gates[0]!.resolve({ accepted: true });
    });
    expect(prescribe).toHaveBeenCalledTimes(2);
    expect(prescribe).toHaveBeenNthCalledWith(2, 'fnd-run-1-2');

    await act(async () => {
      gates[1]!.resolve({ accepted: true });
    });
    expect(prescribe).toHaveBeenCalledTimes(3);
    expect(prescribe).toHaveBeenNthCalledWith(3, 'fnd-run-1-3');

    await act(async () => {
      gates[2]!.resolve({ accepted: true });
    });
    await waitFor(() => expect(getRun).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /fix all/i })).toBeEnabled();
  });

  it('stops fixing and shows an error when a prescribe fails (P2-C03)', async () => {
    const first = deferred();
    const prescribe = vi.fn((id: string) =>
      id === 'fnd-run-1-1' ? first.promise : Promise.resolve({ accepted: true as const }),
    );
    renderPage({ getRun: vi.fn(async () => detail), prescribe });

    fireEvent.click(await screen.findByRole('button', { name: /fix all/i }));

    await act(async () => {
      first.reject(new Error('prescribe blew up'));
    });

    expect(await screen.findByText(/prescribe blew up/)).toBeInTheDocument();
    expect(prescribe).toHaveBeenCalledTimes(1);
  });
});
