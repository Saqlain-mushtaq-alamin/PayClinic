import type { Actor, Step } from '@payclinic/contracts';
import { redactBody, redactHeaders } from './redact';

export interface StepFinishData {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  durationMs: number;
}

export interface StepRecorder {
  setScenario(scenarioId: string): void;
  start(actor: Actor, label?: string): number;
  finish(seq: number, data: StepFinishData): Step;
  steps(): Step[];
  drain(): Step[];
  onStep(cb: (s: Step) => void): void;
}

interface PendingStep {
  scenarioId: string;
  actor: Actor;
  label?: string;
  timestamp: string;
}

/** Creates a recorder that owns one sequence counter per scenario. */
export function createRecorder(o: {
  runId: string;
  newId: () => string;
  now: () => Date;
}): StepRecorder {
  const buffers = new Map<string, Step[]>();
  const pending = new Map<number, PendingStep>();
  const listeners: Array<(s: Step) => void> = [];
  let scenarioId: string | null = null;
  let seq = 0;

  const currentSteps = (): Step[] => {
    if (scenarioId === null) return [];
    const steps = buffers.get(scenarioId);
    if (!steps) {
      const created: Step[] = [];
      buffers.set(scenarioId, created);
      return created;
    }
    return steps;
  };

  return {
    setScenario(nextScenarioId: string): void {
      scenarioId = nextScenarioId;
      seq = 0;
      pending.clear();
      buffers.delete(nextScenarioId);
    },

    start(actor: Actor, label?: string): number {
      if (scenarioId === null) {
        throw new Error('StepRecorder.setScenario() must be called before start()');
      }
      const allocated = seq;
      seq += 1;
      pending.set(allocated, {
        scenarioId,
        actor,
        ...(label === undefined ? {} : { label }),
        timestamp: o.now().toISOString(),
      });
      return allocated;
    },

    finish(allocated: number, data: StepFinishData): Step {
      const started = pending.get(allocated);
      if (!started) {
        throw new Error(`No pending step for seq ${allocated}`);
      }
      pending.delete(allocated);

      const paypalDebugId = Object.entries(data.responseHeaders).find(
        ([name]) => name.toLowerCase() === 'paypal-debug-id',
      )?.[1];

      const step: Step = {
        id: o.newId(),
        runId: o.runId,
        scenarioId: started.scenarioId,
        seq: allocated,
        actor: started.actor,
        ...(started.label === undefined ? {} : { label: started.label }),
        method: data.method,
        url: data.url,
        requestHeaders: redactHeaders(data.requestHeaders),
        requestBody: data.requestBody,
        responseStatus: data.responseStatus,
        responseHeaders: redactHeaders(data.responseHeaders),
        responseBody: redactBody(data.url, data.responseBody),
        ...(paypalDebugId === undefined ? {} : { paypalDebugId }),
        durationMs: data.durationMs,
        timestamp: started.timestamp,
      };

      const steps = buffers.get(started.scenarioId);
      if (steps) steps.push(step);
      else buffers.set(started.scenarioId, [step]);

      for (const listener of listeners) listener(step);
      return step;
    },

    steps(): Step[] {
      return [...currentSteps()].sort((a, b) => a.seq - b.seq);
    },

    drain(): Step[] {
      const drained = this.steps();
      if (scenarioId !== null) buffers.set(scenarioId, []);
      return drained;
    },

    onStep(cb: (s: Step) => void): void {
      listeners.push(cb);
    },
  };
}
