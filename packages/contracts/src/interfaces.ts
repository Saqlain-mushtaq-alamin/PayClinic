import type { z } from 'zod';
import type {
  FirewallDecision,
  GuardHistory,
  GuardRequest,
  InvariantResult,
  Patch,
  Policy,
  RunState,
  Step,
  VerifyResult,
  Finding,
} from './types';
import type { InvariantKey } from './enums';

/** An invariant is a PURE function. No IO, no clock, no randomness, no AI. */
export interface InvariantContext {
  trace: Step[];
  state: RunState;
}
export type InvariantFn = (ctx: InvariantContext) => InvariantResult;
export type InvariantRegistry = Record<InvariantKey, InvariantFn>;

export type AITask = 'variations' | 'explain' | 'patch' | 'policy';

export interface GenerateJsonOptions<T> {
  task: AITask;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** hash of (task, system, prompt, model): used by the on-disk response cache */
  cacheKey: string;
  /** logical key used by FixtureProvider, e.g. "explain:B1", "patch:B2", "policy:agent" */
  fixtureKey: string;
}

export interface AIProvider {
  readonly name: string;
  generateJSON<T>(opts: GenerateJsonOptions<T>): Promise<T>;
}

/** Track A implements this. Track B and C call it (through the orchestrator). */
export interface VerifyOptions {
  mode: 'online' | 'offline';
  runId: string;
}
export type VerifyFn = (
  finding: Finding,
  patch: Patch,
  options: VerifyOptions,
) => Promise<VerifyResult>;

/** Track B implements this. Pure and stateless. */
export interface FirewallEngine {
  evaluate(
    request: GuardRequest,
    policy: Policy,
    history: GuardHistory,
  ): Omit<FirewallDecision, 'id' | 'runId' | 'ts'>;
}
