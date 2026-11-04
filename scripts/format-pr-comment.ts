import { readFileSync } from 'node:fs';
import { CliReport } from '@payclinic/contracts';

/** Escape pipes so finding text cannot break the Markdown table. */
function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|');
}

/** Render a CliReport as the Markdown body of the PayClinic PR comment. */
export function formatPrComment(report: CliReport): string {
  const lines: string[] = [];
  lines.push('<!-- payclinic-report -->');
  lines.push('### PayClinic payment-safety report');
  const score = report.scoreAfter === undefined ? `**${report.score}** / 100` : `**${report.score}** → **${report.scoreAfter}** / 100`;
  lines.push(`Score: ${score}`);

  if (report.findings.length === 0) {
    lines.push('No findings. Every checked invariant passed.');
  } else {
    lines.push('| Severity | Invariant | Scenario | State | Finding |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const finding of report.findings) {
      lines.push(
        `| ${finding.severity} | ${finding.invariant} | ${finding.scenario} | ${finding.state} | ${escapeCell(finding.title)} |`,
      );
    }
  }

  lines.push(`Run ${report.runId} · ${report.mode} mode`);
  return lines.join('\n');
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node --import tsx scripts/format-pr-comment.ts <report.json>');
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`format-pr-comment: invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const result = CliReport.safeParse(parsed);
  if (!result.success) {
    console.error(`format-pr-comment: invalid report in ${path}: ${result.error.message}`);
    process.exit(1);
  }

  process.stdout.write(formatPrComment(result.data));
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/format-pr-comment.ts')) {
  main();
}
