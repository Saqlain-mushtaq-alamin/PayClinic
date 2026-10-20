import { z } from 'zod';
import { RunMode, RunTarget, ScenarioKey } from './enums';
import {
  Explanation,
  Finding,
  FirewallDecision,
  Patch,
  Policy,
  Run,
  ScenarioResult,
  Score,
  Step,
  VerifyResult,
} from './types';

/**
 * REST contract. Base path: /api. All bodies are JSON. Errors: { error: string, code?: string } with a 4xx/5xx status.
 *
 * POST /api/runs                          body RunCreateRequest        -> 202 RunCreateResponse
 * GET  /api/runs                                                       -> 200 RunSummary[]
 * GET  /api/runs/:id                                                   -> 200 RunDetail
 * GET  /api/runs/:id/events               (SSE of RunEvent)
 * GET  /api/runs/:id/steps?scenarioId=                                 -> 200 Step[]
 * GET  /api/findings/:id                                               -> 200 FindingDetail
 * POST /api/findings/:id/prescribe                                     -> 202 { accepted: true }   (progress via SSE)
 * POST /api/findings/:id/open-pr                                       -> 200 OpenPrResponse
 * POST /api/runs/:id/protect                                           -> 202 { accepted: true }   (agent runs only)
 * GET  /api/runs/:id/policy                                            -> 200 PolicyResponse
 * GET  /api/runs/:id/decisions                                         -> 200 FirewallDecision[]
 * GET  /api/scenarios                                                  -> 200 ScenarioInfo[]
 * GET  /api/health                                                     -> 200 Health
 */
export const RunCreateRequest = z.object({
  target: RunTarget,
  mode: RunMode,
  scenarios: z.array(ScenarioKey).min(1),
});
export type RunCreateRequest = z.infer<typeof RunCreateRequest>;

export const RunCreateResponse = z.object({ runId: z.string() });
export type RunCreateResponse = z.infer<typeof RunCreateResponse>;

export const RunSummary = Run.extend({ findingCount: z.number().int(), score: Score.optional() });
export type RunSummary = z.infer<typeof RunSummary>;

export const RunDetail = z.object({
  run: Run,
  scenarios: z.array(ScenarioResult),
  findings: z.array(Finding),
  score: Score,
});
export type RunDetail = z.infer<typeof RunDetail>;

export const FindingDetail = z.object({
  finding: Finding,
  steps: z.array(Step),
  explanation: Explanation.nullable(),
  patch: Patch.nullable(),
  verify: VerifyResult.nullable(),
});
export type FindingDetail = z.infer<typeof FindingDetail>;

export const OpenPrResponse = z.object({
  prUrl: z.string().url().nullable(),
  reason: z.string().optional(),
});
export type OpenPrResponse = z.infer<typeof OpenPrResponse>;

export const PolicyResponse = z.object({ policy: Policy.nullable(), yaml: z.string().nullable() });
export type PolicyResponse = z.infer<typeof PolicyResponse>;

export const ScenarioInfo = z.object({
  key: ScenarioKey,
  title: z.string(),
  target: RunTarget,
  description: z.string(),
});
export type ScenarioInfo = z.infer<typeof ScenarioInfo>;

export const Health = z.object({
  ok: z.literal(true),
  mode: RunMode,
  version: z.string(),
  aiProvider: z.string(),
});
export type Health = z.infer<typeof Health>;

export const DecisionList = z.array(FirewallDecision);
export const StepList = z.array(Step);
