import { useCallback, useEffect, useRef, useState } from 'react';
import { RunEvent as RunEventSchema, type FirewallDecision } from '@payclinic/contracts';
import { API_BASE_URL, api } from './client';
import type { ApiClient } from './client';
import type { RunEventSourceCtor } from './useRunEvents';

export type ProtectStage = 'idle' | 'generating' | 'rerunning' | 'verifying' | 'done' | 'failed';

const RUNNING_STAGES: readonly ProtectStage[] = ['generating', 'rerunning', 'verifying'];

export interface UseProtectOptions {
  client?: Pick<ApiClient, 'protect'>;
  eventSourceCtor?: RunEventSourceCtor;
}

export interface UseProtectResult {
  stage: ProtectStage;
  message: string | null;
  /** Decisions recorded live during this protect flow (from `decision.recorded` events). */
  decisions: FirewallDecision[];
  start: () => void;
}

/**
 * Drives one protect flow: posts `POST /api/runs/:id/protect` and subscribes
 * to the run event stream. The stepper stage advances on events: the first
 * `decision.recorded` moves to `rerunning`, the first `finding.updated` or
 * `score.updated` moves to `verifying`, and a protected finding or the end of
 * the run completes the flow. A rejected request (e.g. 409) surfaces the
 * server message.
 */
export function useProtect(
  runId: string,
  { client = api, eventSourceCtor }: UseProtectOptions = {},
): UseProtectResult {
  const [stage, setStage] = useState<ProtectStage>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<FirewallDecision[]>([]);
  const stageRef = useRef<ProtectStage>('idle');
  stageRef.current = stage;
  const clientRef = useRef(client);
  clientRef.current = client;
  const sourceRef = useRef<{ close(): void } | null>(null);

  useEffect(
    () => () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    },
    [],
  );

  const start = useCallback(() => {
    if (!runId) return;
    if (RUNNING_STAGES.includes(stage)) return;

    sourceRef.current?.close();
    const Ctor = eventSourceCtor ?? (typeof EventSource !== 'undefined' ? EventSource : undefined);
    if (!Ctor) {
      setStage('failed');
      setMessage('Live updates are not supported in this browser');
      return;
    }
    const source = new Ctor(`${API_BASE_URL}/api/runs/${runId}/events`);
    sourceRef.current = source;
    source.onmessage = (event: { data?: unknown }) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const parsed = RunEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const next = parsed.data;
      if (next.type === 'decision.recorded') {
        setDecisions((prev) =>
          prev.some((item) => item.id === next.decision.id) ? prev : [...prev, next.decision],
        );
        if (stageRef.current === 'generating') setStage('rerunning');
        return;
      }
      if (next.type === 'finding.updated') {
        if (next.finding.state === 'protected') {
          setStage('done');
          source.close();
          sourceRef.current = null;
          return;
        }
        if (stageRef.current === 'generating' || stageRef.current === 'rerunning') {
          setStage('verifying');
        }
        return;
      }
      if (next.type === 'score.updated') {
        if (stageRef.current === 'generating' || stageRef.current === 'rerunning') {
          setStage('verifying');
        }
        return;
      }
      if (next.type === 'run.completed' || next.type === 'run.failed') {
        setStage('done');
        source.close();
        sourceRef.current = null;
      }
    };

    setStage('generating');
    setMessage(null);
    clientRef.current.protect(runId).catch((reason: unknown) => {
      source.close();
      sourceRef.current = null;
      setStage('failed');
      setMessage(reason instanceof Error ? reason.message : String(reason));
    });
  }, [eventSourceCtor, runId, stage]);

  return { stage, message, decisions, start };
}
