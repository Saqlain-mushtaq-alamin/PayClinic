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
 * GET  /api/settings                                                   -> 200 SettingsResponse
 * PUT  /api/settings                      body SettingsUpdateRequest   -> 200 SettingsResponse
 * POST /api/settings/test/:kind                                        -> 200 TestSettingsResponse
 * GET  /api/auth/status                                                -> 200 AuthStatusResponse
 * GET  /api/projects                                                   -> 200 Project[]
 * POST /api/projects                      body ProjectCreateRequest    -> 201 Project
 * PUT  /api/projects/:id                  body ProjectUpdateRequest    -> 200 Project
 * DELETE /api/projects/:id                                             -> 200 { ok: true }
 * POST /api/projects/:id/check                                         -> 200 AdapterCheckItem[]
 * GET  /api/docs/connect-your-site                                     -> 200 Markdown
 */
export const RunCreateRequest = z.object({
  projectId: z.string().default('builtin').optional(),
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

export const SettingMaskedValue = z.object({
  configured: z.boolean(),
  hint: z.string(),
});
export type SettingMaskedValue = z.infer<typeof SettingMaskedValue>;

export const SettingsResponse = z.record(z.string(), SettingMaskedValue);
export type SettingsResponse = z.infer<typeof SettingsResponse>;

export const SettingsUpdateRequest = z.record(z.string(), z.union([z.string(), z.null()]));
export type SettingsUpdateRequest = z.infer<typeof SettingsUpdateRequest>;

export const TestKind = z.enum(['paypal', 'gemini', 'github']);
export type TestKind = z.infer<typeof TestKind>;

export const TestSettingsResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type TestSettingsResponse = z.infer<typeof TestSettingsResponse>;

export const AuthStatusResponse = z.object({
  required: z.boolean(),
});
export type AuthStatusResponse = z.infer<typeof AuthStatusResponse>;

export const ProjectKind = z.enum(['builtin', 'remote']);
export type ProjectKind = z.infer<typeof ProjectKind>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProjectKind,
  baseUrl: z.string().nullable().optional(),
  proxyToken: z.string(),
  proxyUrl: z.string().optional(),
  hasAdminSecret: z.boolean(),
  repoOwner: z.string().nullable().optional(),
  repoName: z.string().nullable().optional(),
  repoBranch: z.string().nullable().optional(),
  sourceRoot: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const ProjectCreateRequest = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url().optional().nullable(),
  adminSecret: z.string().optional().nullable(),
  repoOwner: z.string().optional().nullable(),
  repoName: z.string().optional().nullable(),
  repoBranch: z.string().optional().nullable(),
  sourceRoot: z.string().optional().nullable(),
});
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequest>;

export const ProjectUpdateRequest = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional().nullable(),
  adminSecret: z.string().optional().nullable(),
  repoOwner: z.string().optional().nullable(),
  repoName: z.string().optional().nullable(),
  repoBranch: z.string().optional().nullable(),
  sourceRoot: z.string().optional().nullable(),
});
export type ProjectUpdateRequest = z.infer<typeof ProjectUpdateRequest>;

export const AdapterCheckItem = z.object({
  id: z.string(),
  endpoint: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  fix: z.string().nullable(),
});
export type AdapterCheckItem = z.infer<typeof AdapterCheckItem>;

export const AdapterCheckResponse = z.array(AdapterCheckItem);
export type AdapterCheckResponse = z.infer<typeof AdapterCheckResponse>;

