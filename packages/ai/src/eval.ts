export interface EvalRow {
  key: string;
  aiPatchProduced: boolean;
  verified: boolean;
  attempts: number;
  seconds: number;
  fallbackUsed: boolean;
}

/** Formats a fixed-width table for patch evaluation results. */
export function formatEvalTable(rows: EvalRow[]): string {
  const headers = ['Scenario', 'AI Patch', 'Verified', 'Attempts', 'Time (s)', 'Fallback'];
  const formattedRows = rows.map((r) => [
    r.key,
    r.aiPatchProduced ? 'yes' : 'no',
    r.verified ? 'yes' : 'no',
    String(r.attempts),
    r.seconds.toFixed(1),
    r.fallbackUsed ? 'yes' : 'no',
  ]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...formattedRows.map((r) => r[i]!.length)),
  );

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i]!)).join(' | ');
  const sepLine = colWidths.map((w) => '-'.repeat(w)).join('-+-');
  const dataLines = formattedRows.map((r) =>
    r.map((cell, i) => cell.padEnd(colWidths[i]!)).join(' | '),
  );

  const verifiedCount = rows.filter((r) => r.verified).length;
  const summaryLine = `AI verified: ${verifiedCount}/${rows.length}`;

  return [headerLine, sepLine, ...dataLines, summaryLine].join('\n');
}

/** Returns 0 if verified count meets or exceeds threshold, else 1. */
export function evalExitCode(rows: Array<{ verified: boolean }>, minVerified = 4): 0 | 1 {
  const count = rows.filter((r) => r.verified).length;
  return count >= minVerified ? 0 : 1;
}
