import { SEVERITY_POINTS } from '@payclinic/contracts';
import type { Finding, FindingState, InvariantKey, Score, Severity } from '@payclinic/contracts';

type ScoredFinding = Pick<Finding, 'invariantKey' | 'severity' | 'state'>;
type ScorePenalty = Score['penalties'][number];

const RESOLVED_STATES = new Set<FindingState>(['verified', 'protected']);
const UNRESOLVED_STATES = new Set<FindingState>(['open', 'patched', 'unverified']);

/** Scores a run: each distinct unresolved invariant key deducts its severity once. */
export function computeScore(findings: ScoredFinding[]): Score {
  const unresolved = findings.filter((finding) => UNRESOLVED_STATES.has(finding.state));
  const resolved = findings.filter((finding) => RESOLVED_STATES.has(finding.state));

  const byKey = new Map<InvariantKey, Severity>();
  for (const finding of unresolved) {
    if (!byKey.has(finding.invariantKey)) byKey.set(finding.invariantKey, finding.severity);
  }

  const penalties: ScorePenalty[] = [...byKey].map(([invariantKey, severity]) => ({
    invariantKey,
    severity,
    points: SEVERITY_POINTS[severity],
  }));
  const deducted = penalties.reduce((sum, penalty) => sum + penalty.points, 0);

  return {
    score: Math.max(0, 100 - deducted),
    penalties,
    unresolvedCount: unresolved.length,
    resolvedCount: resolved.length,
  };
}
