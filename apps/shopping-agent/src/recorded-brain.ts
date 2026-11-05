import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentAction, AgentBrain, Observation } from './brains';

const AGENT_TOOLS = ['searchProducts', 'createOrder', 'captureOrder'] as const;

/** Raised when the brain is asked for more actions than the transcript recorded. */
export class TranscriptExhaustedError extends Error {
  constructor() {
    super('The recorded transcript has no more actions');
    this.name = 'TranscriptExhaustedError';
  }
}

/** Raised when a transcript file does not contain a valid AgentAction list. */
export class TranscriptFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptFormatError';
  }
}

function parseAction(value: unknown, index: number): AgentAction {
  if (typeof value !== 'object' || value === null) {
    throw new TranscriptFormatError(`transcript action ${index} is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'finish') {
    if (typeof record.message !== 'string') {
      throw new TranscriptFormatError(`transcript action ${index} finish needs a string message`);
    }
    return { type: 'finish', message: record.message };
  }
  if (
    record.type === 'tool' &&
    typeof record.tool === 'string' &&
    (AGENT_TOOLS as readonly string[]).includes(record.tool) &&
    typeof record.args === 'object' &&
    record.args !== null
  ) {
    return {
      type: 'tool',
      tool: record.tool as (typeof AGENT_TOOLS)[number],
      args: record.args as Record<string, unknown>,
    };
  }
  throw new TranscriptFormatError(`transcript action ${index} is not a valid AgentAction`);
}

/** Validates untrusted transcript JSON as an ordered AgentAction list. */
export function parseAgentTranscript(value: unknown): AgentAction[] {
  const actions = (value as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(actions)) {
    throw new TranscriptFormatError('transcript file must be { actions: AgentAction[] }');
  }
  return actions.map(parseAction);
}

/** Reads a recorded agent transcript from `fixtures/agent/<name>.json`. */
export function loadRecordedActions(name: string): AgentAction[] {
  const file = fileURLToPath(new URL(`../../../fixtures/agent/${name}.json`, import.meta.url));
  if (!existsSync(file)) {
    throw new TranscriptFormatError(`no transcript fixture at ${file}`);
  }
  return parseAgentTranscript(JSON.parse(readFileSync(file, 'utf8')));
}

/** Replays a recorded action list, one action per turn, then throws when exhausted. */
export class RecordedBrain implements AgentBrain {
  private readonly actions: readonly AgentAction[];
  private cursor = 0;

  constructor(actions: AgentAction[]) {
    this.actions = [...actions];
  }

  async next(_view: { task: string; observations: Observation[] }): Promise<AgentAction> {
    const action = this.actions[this.cursor];
    if (action === undefined) throw new TranscriptExhaustedError();
    this.cursor += 1;
    return action;
  }
}
