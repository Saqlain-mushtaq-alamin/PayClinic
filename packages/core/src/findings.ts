import { INVARIANT_META } from '@payclinic/contracts';
import type { Finding, InvariantResult, ScenarioKey } from '@payclinic/contracts';

/** Creates one open finding for each failed invariant result. */
export function findingsFromResults(o: {
  runId: string;
  scenarioKey: ScenarioKey;
  results: InvariantResult[];
  newId: () => string;
  now: () => string;
}): Finding[] {
  return o.results
    .filter((result) => !result.passed)
    .map((result) => ({
      id: o.newId(),
      runId: o.runId,
      scenarioKey: o.scenarioKey,
      invariantKey: result.key,
      severity: result.severity,
      state: 'open',
      title: INVARIANT_META[result.key].title,
      summary: result.message,
      evidenceStepIds: [...result.evidenceStepIds],
      createdAt: o.now(),
    }));
}
