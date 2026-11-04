import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CliReport } from '@payclinic/contracts';
import { formatPrComment } from '../../scripts/format-pr-comment';

function buildReport(overrides: Partial<CliReport> = {}): CliReport {
  return {
    runId: 'run-123',
    mode: 'offline',
    score: 61,
    findings: [
      {
        scenario: 'B1',
        invariant: 'I-01',
        severity: 'critical',
        state: 'open',
        title: 'Overcharge in checkout',
        summary: 'Total charged exceeds cart total.',
      },
    ],
    ...overrides,
  };
}

describe('formatPrComment', () => {
  it('starts with the payclinic-report marker', () => {
    const comment = formatPrComment(buildReport());
    expect(comment.startsWith('<!-- payclinic-report -->')).toBe(true);
  });

  it('shows the table with a critical B1 finding', () => {
    const comment = formatPrComment(buildReport());
    expect(comment).toContain('### PayClinic payment-safety report');
    expect(comment).toContain('Score: **61** / 100');
    expect(comment).toContain('| Severity | Invariant | Scenario | State | Finding |');
    expect(comment).toContain('| critical | I-01 | B1 | open | Overcharge in checkout |');
    expect(comment).toContain('Run run-123 · offline mode');
  });

  it('shows score → scoreAfter when scoreAfter is set', () => {
    const comment = formatPrComment(buildReport({ scoreAfter: 100 }));
    expect(comment).toContain('Score: **61** → **100** / 100');
    expect(comment).not.toContain('Score: **61** / 100');
  });

  it('shows the no-findings text when the findings list is empty', () => {
    const comment = formatPrComment(buildReport({ findings: [] }));
    expect(comment).toContain('No findings. Every checked invariant passed.');
    expect(comment).not.toContain('| Severity |');
  });

  it('escapes pipes inside finding text', () => {
    const comment = formatPrComment(
      buildReport({
        findings: [
          {
            scenario: 'B1',
            invariant: 'I-01',
            severity: 'critical',
            state: 'open',
            title: 'Charged |a| and |b|',
            summary: 'Total exceeds |cart| total.',
          },
        ],
      }),
    );
    expect(comment).toContain('| critical | I-01 | B1 | open | Charged \\|a\\| and \\|b\\| |');
    expect(comment).not.toContain('Charged |a| and');
  });
});

describe('format-pr-comment CLI', () => {
  const scriptPath = join('scripts', 'format-pr-comment.ts');

  it('exits non-zero with a message for invalid JSON', () => {
    const dir = join('.payclinic-tmp', 'format-pr-comment-test');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'invalid.json');
    writeFileSync(filePath, 'not json at all', 'utf8');

    expect(() =>
      execFileSync('node', ['--import', 'tsx', scriptPath, filePath], {
        stdio: 'pipe',
        encoding: 'utf8',
      }),
    ).toThrowError(/invalid/i);
  });

  it('exits non-zero when the file does not exist', () => {
    expect(() =>
      execFileSync('node', ['--import', 'tsx', scriptPath, join('.payclinic-tmp', 'missing-report.json')], {
        stdio: 'pipe',
        encoding: 'utf8',
      }),
    ).toThrowError();
  });
});
