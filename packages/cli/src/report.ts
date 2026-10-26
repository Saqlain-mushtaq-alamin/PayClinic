import { CliReport } from '@payclinic/contracts';
import type { Repos } from '@payclinic/core';

/** Maps a persisted run and its findings into the stable JSON report contract. */
export function buildReport(runId: string, repos: Repos): CliReport {
  const run = repos.getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.scoreBefore === undefined) throw new Error(`Run ${runId} has no scoreBefore`);

  return CliReport.parse({
    runId,
    mode: run.mode,
    score: run.scoreBefore,
    ...(run.scoreAfter === undefined ? {} : { scoreAfter: run.scoreAfter }),
    findings: repos.listFindings(runId).map((finding) => ({
      scenario: finding.scenarioKey,
      invariant: finding.invariantKey,
      severity: finding.severity,
      state: finding.state,
      title: finding.title,
      summary: finding.summary,
    })),
  });
}
