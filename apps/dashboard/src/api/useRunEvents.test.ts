import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RunEvent as RunEventSchema,
  type Run,
  type RunEvent,
  type Score,
} from '@payclinic/contracts';
import { API_BASE_URL } from './client';
import { useRunEvents, type RunEventSourceLike } from './useRunEvents';
import '../test-setup';

const T = '2026-10-18T10:00:00.000Z';

const run: Run = {
  id: 'run-1',
  target: 'store',
  mode: 'offline',
  scenarioKeys: ['B1'],
  status: 'running',
  startedAt: T,
};

const score: Score = { score: 70, penalties: [], unresolvedCount: 2, resolvedCount: 0 };

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

  open(): void {
    this.onopen?.({});
  }

  emit(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  close(): void {
    this.closed = true;
  }
}

const started: RunEvent = { type: 'run.started', run };
const scored: RunEvent = { type: 'score.updated', score };
const completed: RunEvent = { type: 'run.completed', run: { ...run, status: 'completed' } };
const failed: RunEvent = { type: 'run.failed', runId: 'run-1', error: 'cart crashed' };

describe('useRunEvents', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('connects, reports connecting then open, and collects valid events (P2-C01)', async () => {
    const { result } = renderHook(() =>
      useRunEvents('run-1', { eventSourceCtor: FakeEventSource }),
    );

    expect(result.current.status).toBe('connecting');
    expect(instances).toHaveLength(1);
    const source = instances[0]!;
    expect(source.url).toBe(`${API_BASE_URL}/api/runs/run-1/events`);

    source.open();
    await waitFor(() => expect(result.current.status).toBe('open'));

    source.emit(JSON.stringify(started));
    await waitFor(() => expect(result.current.events).toEqual([started]));
    expect(result.current.status).toBe('open');
  });

  it('ignores invalid messages and counts them (P2-C01)', async () => {
    const { result } = renderHook(() =>
      useRunEvents('run-1', { eventSourceCtor: FakeEventSource }),
    );

    const source = instances[0]!;
    source.emit('not json');
    source.emit(JSON.stringify({ type: 'nope' }));

    await waitFor(() => expect(result.current.invalid).toBe(2));
    expect(result.current.events).toEqual([]);
    expect(RunEventSchema.safeParse(JSON.parse(JSON.stringify(started))).success).toBe(true);
  });

  it('closes the source when it receives run.completed (P2-C01)', async () => {
    const { result } = renderHook(() =>
      useRunEvents('run-1', { eventSourceCtor: FakeEventSource }),
    );

    const source = instances[0]!;
    source.emit(JSON.stringify(started));
    source.emit(JSON.stringify(scored));
    source.emit(JSON.stringify(completed));

    await waitFor(() => expect(result.current.status).toBe('closed'));
    expect(source.closed).toBe(true);
    expect(result.current.events).toHaveLength(3);
  });

  it('closes the source when it receives run.failed (P2-C01)', async () => {
    const { result } = renderHook(() =>
      useRunEvents('run-1', { eventSourceCtor: FakeEventSource }),
    );

    const source = instances[0]!;
    source.emit(JSON.stringify(failed));

    await waitFor(() => expect(result.current.status).toBe('closed'));
    expect(source.closed).toBe(true);
    expect(result.current.events).toEqual([failed]);
  });

  it('closes the source on unmount (P2-C01)', () => {
    const { unmount } = renderHook(() =>
      useRunEvents('run-1', { eventSourceCtor: FakeEventSource }),
    );

    unmount();
    expect(instances[0]!.closed).toBe(true);
  });

  it('does not connect without a run id (P2-C01)', () => {
    const { result } = renderHook(() => useRunEvents('', { eventSourceCtor: FakeEventSource }));

    expect(result.current.status).toBe('closed');
    expect(instances).toHaveLength(0);
  });
});
