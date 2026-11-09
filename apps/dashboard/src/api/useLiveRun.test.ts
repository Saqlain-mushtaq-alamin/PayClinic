import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run, RunEvent } from '@payclinic/contracts';
import { API_BASE_URL } from './client';
import { useLiveRun } from './useLiveRun';
import type { RunEventSourceLike } from './useRunEvents';

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

  triggerOpen(): void {
    this.onopen?.({});
  }

  triggerError(): void {
    this.onerror?.({});
  }

  close(): void {
    this.closed = true;
  }
}

const mockRun: Run = {
  id: 'run-1',
  target: 'store',
  mode: 'offline',
  status: 'completed',
  scenarioKeys: ['B1'],
  startedAt: '2026-10-18T10:00:00.000Z',
  completedAt: '2026-10-18T10:00:05.000Z',
  scoreBefore: 70,
  scoreAfter: 100,
};

describe('useLiveRun', () => {
  beforeEach(() => {
    instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects to the SSE endpoint and transitions to live on open', () => {
    const { result } = renderHook(() => useLiveRun('run-1', { eventSourceCtor: FakeEventSource }));

    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toBe(`${API_BASE_URL}/api/runs/run-1/events`);
    expect(result.current.connection).toBe('connecting');

    act(() => {
      instances[0]!.triggerOpen();
    });

    expect(result.current.connection).toBe('live');
  });

  it('keeps the connection open after run.completed arrives', () => {
    const { result } = renderHook(() => useLiveRun('run-1', { eventSourceCtor: FakeEventSource }));

    act(() => {
      instances[0]!.triggerOpen();
    });

    const completedEvent: RunEvent = { type: 'run.completed', run: mockRun };
    act(() => {
      instances[0]!.emit(JSON.stringify(completedEvent));
    });

    expect(result.current.events).toHaveLength(1);
    expect(instances[0]!.closed).toBe(false);
    expect(result.current.connection).toBe('live');

    // Subsequent prescribe progress still arrives on the same open source
    const prescribeEvent: RunEvent = {
      type: 'prescribe.progress',
      findingId: 'fnd-1',
      stage: 'done',
      message: 'Verified',
    };
    act(() => {
      instances[0]!.emit(JSON.stringify(prescribeEvent));
    });

    expect(result.current.events).toHaveLength(2);
  });

  it('deduplicates identical events using stable key', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() =>
      useLiveRun('run-1', { eventSourceCtor: FakeEventSource, onEvent }),
    );

    act(() => {
      instances[0]!.triggerOpen();
    });

    const stepEvent: RunEvent = {
      type: 'step.recorded',
      step: {
        id: 'step-1',
        runId: 'run-1',
        scenarioId: 'sc-1',
        seq: 1,
        actor: 'runner',
        method: 'POST',
        url: 'http://localhost/api',
        requestHeaders: {},
        requestBody: null,
        responseStatus: 200,
        responseHeaders: {},
        responseBody: null,
        durationMs: 10,
        timestamp: '2026-10-18T10:00:00Z',
      },
    };

    act(() => {
      instances[0]!.emit(JSON.stringify(stepEvent));
      instances[0]!.emit(JSON.stringify(stepEvent));
    });

    expect(result.current.events).toHaveLength(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('resets events and seen keys when runId changes', () => {
    let currentRunId = 'run-1';
    const { result, rerender } = renderHook(() =>
      useLiveRun(currentRunId, { eventSourceCtor: FakeEventSource }),
    );

    act(() => {
      instances[0]!.triggerOpen();
    });

    const event1: RunEvent = {
      type: 'run.started',
      run: { ...mockRun, id: 'run-1' },
    };
    act(() => {
      instances[0]!.emit(JSON.stringify(event1));
    });

    expect(result.current.events).toHaveLength(1);

    // Change runId to run-2
    currentRunId = 'run-2';
    rerender();

    expect(result.current.events).toHaveLength(0);
  });

  it('auto-reconnects with exponential backoff on error', () => {
    const { result } = renderHook(() => useLiveRun('run-1', { eventSourceCtor: FakeEventSource }));

    act(() => {
      instances[0]!.triggerOpen();
    });
    expect(result.current.connection).toBe('live');

    // Trigger error on first connection
    act(() => {
      instances[0]!.triggerError();
    });
    expect(result.current.connection).toBe('reconnecting');
    expect(instances[0]!.closed).toBe(true);

    // Fast-forward 1s
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(instances).toHaveLength(2);

    // Trigger second error -> backoff is 2s
    act(() => {
      instances[1]!.triggerError();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(instances).toHaveLength(2); // Still waiting for 2s

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(instances).toHaveLength(3);
  });
});
