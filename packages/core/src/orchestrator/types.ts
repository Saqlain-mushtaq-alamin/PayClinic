import type { EventEmitter } from 'node:events';
import type {
  Explanation,
  Finding,
  Patch,
  Run,
  RunCreateRequest,
  ScenarioKey,
  Step,
} from '@payclinic/contracts';
import type { Config } from '../config';
import type { Repos } from '../db/repos';
import type { ScenarioFn } from '../runner/context';

export type Prescriber = (
  finding: Finding,
  steps: Step[],
) => Promise<{ explanation: Explanation; patches: Patch[] }>;

export type Protector = (run: Run, findings: Finding[]) => Promise<void>;

export interface OrchestratorDeps {
  repos: Repos;
  config: Config;
  scenarios: Partial<Record<ScenarioKey, ScenarioFn>>;
  repoRoot: string;
  storeSourceDir: string;
  prescriber: Prescriber;
  protector?: Protector;
  newId: () => string;
  now: () => Date;
  bus: EventEmitter;
}

export interface Orchestrator {
  startRun(req: RunCreateRequest): string;
  prescribe(findingId: string): Promise<void>;
  protect(runId: string): Promise<void>;
  idle(): Promise<void>;
}

/** Raised when protect is requested for a run that is not an agent run. */
export class ProtectNotApplicableError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} is not an agent run`);
    this.name = 'ProtectNotApplicableError';
  }
}

/** Raised when protect is requested without a configured protector. */
export class ProtectNotConfiguredError extends Error {
  constructor() {
    super('No protector is configured');
    this.name = 'ProtectNotConfiguredError';
  }
}
