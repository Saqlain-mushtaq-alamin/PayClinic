import { z } from 'zod';
import { Finding, FirewallDecision, Run, ScenarioResult, Score, Step } from './types';

/** Server-Sent Events payloads for GET /api/runs/:id/events (one JSON object per `data:` line). */
export const RunEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run.started'), run: Run }),
  z.object({ type: z.literal('scenario.started'), scenario: ScenarioResult }),
  z.object({ type: z.literal('step.recorded'), step: Step }),
  z.object({ type: z.literal('scenario.finished'), scenario: ScenarioResult }),
  z.object({ type: z.literal('finding.created'), finding: Finding }),
  z.object({ type: z.literal('finding.updated'), finding: Finding }),
  z.object({
    type: z.literal('prescribe.progress'),
    findingId: z.string(),
    stage: z.enum(['explaining', 'patching', 'verifying', 'done', 'failed']),
    message: z.string(),
  }),
  z.object({ type: z.literal('decision.recorded'), decision: FirewallDecision }),
  z.object({ type: z.literal('score.updated'), score: Score }),
  z.object({ type: z.literal('run.completed'), run: Run }),
  z.object({ type: z.literal('run.failed'), runId: z.string(), error: z.string() }),
]);
export type RunEvent = z.infer<typeof RunEvent>;
