import { useCallback, useEffect, useRef, useState } from 'react';
import { RunEvent as RunEventSchema } from '@payclinic/contracts';
import { API_BASE_URL, api } from './client';
import type { ApiClient } from './client';
import type { RunEventSourceCtor } from './useRunEvents';

export type PrescribeStage = 'idle' | 'explaining' | 'patching' | 'verifying' | 'done' | 'failed';

const RUNNING_STAGES: readonly PrescribeStage[] = ['explaining', 'patching', 'verifying'];

export interface UsePrescribeOptions {
  client?: Pick<ApiClient, 'prescribe'>;
  eventSourceCtor?: RunEventSourceCtor;
}

export interface UsePrescribeResult {
  stage: PrescribeStage;
  message: string | null;
  start: () => void;
}

/**
 * Drives one prescribe flow: posts `POST /api/findings/:id/prescribe` and
 * subscribes to the finding's run event stream for `prescribe.progress`
 * events. The stream stays open across `run.completed` replays (unlike
 * `useRunEvents`) so progress arrives after the run has finished, and closes
 * on `done`/`failed`, on a restart, or on unmount.
 */
export function usePrescribe(
  findingId: string,
  runId: string,
  { client = api, eventSourceCtor }: UsePrescribeOptions = {},
): UsePrescribeResult {
  const [stage, setStage] = useState<PrescribeStage>('idle');
  const [message, setMessage] = useState<string | null>(null);
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
    if (!findingId || !runId) return;
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
      if (next.type !== 'prescribe.progress' || next.findingId !== findingId) return;
      setStage(next.stage);
      setMessage(next.message);
      if (next.stage === 'done' || next.stage === 'failed') {
        source.close();
        sourceRef.current = null;
      }
    };

    setStage('explaining');
    setMessage(null);
    clientRef.current.prescribe(findingId).catch((reason: unknown) => {
      source.close();
      sourceRef.current = null;
      setStage('failed');
      setMessage(reason instanceof Error ? reason.message : String(reason));
    });
  }, [eventSourceCtor, findingId, runId, stage]);

  return { stage, message, start };
}
