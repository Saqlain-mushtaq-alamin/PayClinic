import type { Step } from '@payclinic/contracts';

export type StepTone = 'ok' | 'warn' | 'error';

export interface StepView {
  actorLabel: string;
  title: string;
  chip: string;
  tone: StepTone;
}

const ACTOR_LABELS: Record<Step['actor'], string> = {
  runner: 'Runner',
  store: 'Store',
  agent: 'Agent',
};

/** Describes one trace step for timeline display. Pure. */
export function describeStep(step: Step): StepView {
  try {
    return {
      actorLabel: ACTOR_LABELS[step.actor],
      title: step.label ?? `${step.method} ${new URL(step.url).pathname}`,
      chip: String(step.responseStatus),
      tone: toneForStatus(step.responseStatus),
    };
  } catch {
    return {
      actorLabel: ACTOR_LABELS[step.actor],
      title: `${step.method} ${step.url}`,
      chip: String(step.responseStatus),
      tone: toneForStatus(step.responseStatus),
    };
  }
}

function toneForStatus(status: number): StepTone {
  if (status >= 500 || status === 599) return 'error';
  if (status >= 400) return 'warn';
  return 'ok';
}

/** Sorts steps by their seq field. Pure. */
export function orderSteps(steps: Step[]): Step[] {
  return [...steps].sort((left, right) => left.seq - right.seq);
}
