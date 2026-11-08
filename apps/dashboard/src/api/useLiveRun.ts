import { useEffect, useRef, useState } from 'react';
import { RunEvent as RunEventSchema, type RunEvent } from '@payclinic/contracts';
import { API_BASE_URL } from './client';
import type { RunEventSourceCtor, RunEventSourceLike } from './useRunEvents';

export type LiveConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface UseLiveRunOptions {
  eventSourceCtor?: RunEventSourceCtor;
  enabled?: boolean;
  onEvent?: (event: RunEvent) => void;
}

export interface UseLiveRunResult {
  events: RunEvent[];
  connection: LiveConnectionStatus;
  lastEventAt: number | null;
}

/** Generates a stable unique key for each event to cheaply deduplicate without JSON.stringify on arrays. */
export function getEventKey(event: RunEvent): string {
  switch (event.type) {
    case 'run.started':
      return `run.started:${event.run.id}:${event.run.status}`;
    case 'scenario.started':
      return `scenario.started:${event.scenario.key}:${event.scenario.startedAt ?? ''}`;
    case 'step.recorded':
      return `step.recorded:${event.step.id}`;
    case 'scenario.finished':
      return `scenario.finished:${event.scenario.key}:${event.scenario.finishedAt ?? ''}`;
    case 'finding.created':
      return `finding.created:${event.finding.id}`;
    case 'finding.updated':
      return `finding.updated:${event.finding.id}:${event.finding.state}`;
    case 'prescribe.progress':
      return `prescribe.progress:${event.findingId}:${event.stage}:${event.message}`;
    case 'decision.recorded':
      return `decision.recorded:${event.decision.id}`;
    case 'score.updated':
      return `score.updated:${event.score.score}:${event.score.unresolvedCount}:${event.score.resolvedCount}`;
    case 'run.completed':
      return `run.completed:${event.run.id}:${event.run.status}:${event.run.scoreAfter ?? ''}`;
    case 'run.failed':
      return `run.failed:${event.runId}:${event.error}`;
  }
}

/**
 * Keeps ONE EventSource open for the lifetime of the mounted component.
 * Unlike `useRunEvents`, it does NOT close when `run.completed` arrives so subsequent
 * `prescribe.progress`, `decision.recorded`, and `finding.updated` events are seen.
 * Reconnects with exponential backoff (1s, 2s, 4s, max 10s) on error.
 */
export function useLiveRun(
  runId: string,
  { eventSourceCtor, enabled = true, onEvent }: UseLiveRunOptions = {},
): UseLiveRunResult {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<LiveConnectionStatus>('offline');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const seenKeysRef = useRef<Set<string>>(new Set());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!runId || !enabled) {
      setConnection('offline');
      return;
    }

    const Ctor: RunEventSourceCtor | undefined =
      eventSourceCtor ??
      (typeof EventSource !== 'undefined'
        ? (EventSource as unknown as RunEventSourceCtor)
        : undefined);
    if (!Ctor) {
      setConnection('offline');
      return;
    }

    let active = true;
    let source: RunEventSourceLike | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;

    const connect = () => {
      if (!active) return;
      if (source) {
        source.close();
        source = null;
      }

      setConnection((prev) => (prev === 'live' ? 'reconnecting' : 'connecting'));

      try {
        const s = new Ctor(`${API_BASE_URL}/api/runs/${runId}/events`);
        source = s;

        s.onopen = () => {
          if (!active) return;
          backoffMs = 1000;
          setConnection('live');
        };

        s.onerror = () => {
          if (!active) return;
          s.close();
          source = null;
          setConnection('reconnecting');

          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            if (!active) return;
            connect();
          }, backoffMs);

          backoffMs = Math.min(backoffMs * 2, 10000);
        };

        s.onmessage = (event: { data?: unknown }) => {
          if (!active) return;
          let raw: unknown;
          try {
            raw = JSON.parse(String(event.data));
          } catch {
            return;
          }

          const parsed = RunEventSchema.safeParse(raw);
          if (!parsed.success) return;

          const next = parsed.data;
          const key = getEventKey(next);

          if (seenKeysRef.current.has(key)) return;
          seenKeysRef.current.add(key);

          const now = Date.now();
          setLastEventAt(now);
          setEvents((prev) => [...prev, next]);
          onEventRef.current?.(next);
        };
      } catch {
        if (!active) return;
        setConnection('reconnecting');
        reconnectTimer = setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 10000);
      }
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (source) {
        source.close();
        source = null;
      }
      setConnection('offline');
    };
  }, [runId, enabled, eventSourceCtor]);

  return { events, connection, lastEventAt };
}
