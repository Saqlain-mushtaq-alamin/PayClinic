import { z } from 'zod';
import { InvariantKey, FindingState, RunMode, ScenarioKey, Severity } from './enums';

/** JSON printed by `payclinic run --json`. Used by the GitHub Action and the PR-comment formatter. */
export const CliReport = z.object({
  runId: z.string(),
  mode: RunMode,
  /** score right after diagnosing */
  score: z.number().min(0).max(100),
  /** score after `--fix` (verified patches / protection); absent when --fix was not used */
  scoreAfter: z.number().min(0).max(100).optional(),
  findings: z.array(
    z.object({
      scenario: ScenarioKey,
      invariant: InvariantKey,
      severity: Severity,
      state: FindingState,
      title: z.string(),
      summary: z.string(),
    }),
  ),
});
export type CliReport = z.infer<typeof CliReport>;
