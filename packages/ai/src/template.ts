import { INVARIANT_META, SOURCE_FILES_FOR_SCENARIO } from '@payclinic/contracts';
import type { Explanation, Finding, PatchOutput } from '@payclinic/contracts';

/** Builds a deterministic explanation when the model cannot produce one. */
export function templateExplanation(
  finding: Finding,
  ref: PatchOutput | null,
  now: string,
): Explanation {
  const meta = INVARIANT_META[finding.invariantKey];
  const file = SOURCE_FILES_FOR_SCENARIO[finding.scenarioKey]?.[0] ?? '';

  return {
    findingId: finding.id,
    rootCause: meta.description,
    impact: `Violates: ${finding.title}`,
    whereInCode: { file, hint: meta.title },
    fixSummary: ref?.rationale ?? 'The verified reference fix for this scenario is applied.',
    model: 'template',
    createdAt: now,
  };
}
