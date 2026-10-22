import type { Finding } from '@payclinic/contracts';

export interface FindingRow {
  id: string;
  scenario: string;
  invariant: string;
  severity: string;
  state: string;
  title: string;
}

/** Flattens findings into the row shape AG Grid renders (order preserved). */
export function toFindingRows(findings: Finding[]): FindingRow[] {
  return findings.map((finding) => ({
    id: finding.id,
    scenario: finding.scenarioKey,
    invariant: finding.invariantKey,
    severity: finding.severity,
    state: finding.state,
    title: finding.title,
  }));
}
