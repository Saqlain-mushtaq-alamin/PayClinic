import { useEffect, useState } from 'react';
import { RunEvent as RunEventSchema, type RunEvent } from '@payclinic/contracts';
import { API_BASE_URL } from './client';

export type RunEventsStatus = 'connecting' | 'open' | 'closed';

/** Minimal structural subset of `EventSource` so tests can inject a fake. */
export interface RunEventSourceLike {
  onopen: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
  close(): void;
}

export type RunEventSourceCtor = new (url: string) => RunEventSourceLike;

export interface RunEventsResult {
  events: RunEvent[];
  status: RunEventsStatus;
  /** Count of messages that failed to parse as a `RunEvent`. */
  invalid: number;
}

/**
 * Subscribes to the SSE stream of `GET /api/runs/:id/events`. Every message is
 * parsed with the `RunEvent` contract; invalid messages are ignored and counted.
 * The stream closes on unmount and when `run.completed`/`run.failed` arrives.
 */
export function useRunEvents(
  runId: string,
  { eventSourceCtor }: { eventSourceCtor?: RunEventSourceCtor } = {},
): RunEventsResult {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<RunEventsStatus>('closed');
  const [invalid, setInvalid] = useState(0);

  useEffect(() => {
    const Ctor = eventSourceCtor ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
    if (!runId || !Ctor) {
      setStatus('closed');
      return;
    }

    setEvents([]);
    setInvalid(0);
    setStatus('connecting');
    const source = new Ctor(`${API_BASE_URL}/api/runs/${runId}/events`);
    source.onopen = () => setStatus('open');
    source.onerror = () => setStatus('closed');
    source.onmessage = (event: { data?: unknown }) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        setInvalid((count) => count + 1);
        return;
      }
      const parsed = RunEventSchema.safeParse(raw);
      if (!parsed.success) {
        setInvalid((count) => count + 1);
        return;
      }
      const next = parsed.data;
      setEvents((previous) => [...previous, next]);
      if (next.type === 'run.completed' || next.type === 'run.failed') {
        source.close();
        setStatus('closed');
      }
    };

    return () => {
      source.close();
    };
  }, [runId, eventSourceCtor]);

  return { events, status, invalid };
}
