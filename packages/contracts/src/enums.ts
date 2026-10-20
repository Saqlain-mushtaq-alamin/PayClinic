import { z } from 'zod';

export const Severity = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof Severity>;

export const RunMode = z.enum(['online', 'offline']);
export type RunMode = z.infer<typeof RunMode>;

export const RunTarget = z.enum(['store', 'agent']);
export type RunTarget = z.infer<typeof RunTarget>;

export const RunStatus = z.enum(['queued', 'running', 'completed', 'failed']);
export type RunStatus = z.infer<typeof RunStatus>;

/** B* = merchant-store bugs, A* = agent attacks. B6 is optional (over-refund). */
export const ScenarioKey = z.enum(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'A1', 'A2']);
export type ScenarioKey = z.infer<typeof ScenarioKey>;

export const ScenarioStatus = z.enum(['pending', 'running', 'passed', 'failed', 'error']);
export type ScenarioStatus = z.infer<typeof ScenarioStatus>;

export const InvariantKey = z.enum([
  'I-01',
  'I-02',
  'I-03',
  'I-04',
  'I-05',
  'I-06',
  'I-07',
  'I-08',
  'I-09',
]);
export type InvariantKey = z.infer<typeof InvariantKey>;

/**
 * open        = found, nothing done yet
 * patched     = a patch exists but is not verified
 * verified    = patch applied AND re-run passed (merchant findings)
 * unverified  = patch exists but verification failed
 * protected   = firewall policy blocked the attack on re-run (agent findings)
 */
export const FindingState = z.enum(['open', 'patched', 'verified', 'unverified', 'protected']);
export type FindingState = z.infer<typeof FindingState>;

export const RuleId = z.enum(['R1', 'R2', 'R3', 'R4', 'R5']);
export type RuleId = z.infer<typeof RuleId>;

export const FirewallAction = z.enum(['allow', 'block', 'escalate']);
export type FirewallAction = z.infer<typeof FirewallAction>;

/** Who sent the recorded HTTP request. */
export const Actor = z.enum(['runner', 'store', 'agent']);
export type Actor = z.infer<typeof Actor>;
