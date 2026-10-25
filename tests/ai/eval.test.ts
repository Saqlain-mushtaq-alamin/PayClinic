import { describe, expect, it } from 'vitest';
import { evalExitCode, formatEvalTable, type EvalRow } from '@payclinic/ai';

describe('formatEvalTable', () => {
  it('formats a fixed-width table containing headers and summary count', () => {
    const rows: EvalRow[] = [
      {
        key: 'B1',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.2,
        fallbackUsed: false,
      },
      {
        key: 'B2',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 0.9,
        fallbackUsed: false,
      },
      {
        key: 'B3',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 2.1,
        fallbackUsed: false,
      },
      {
        key: 'B4',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.5,
        fallbackUsed: false,
      },
      {
        key: 'B5',
        aiPatchProduced: true,
        verified: false,
        attempts: 1,
        seconds: 1.8,
        fallbackUsed: true,
      },
    ];

    const table = formatEvalTable(rows);
    expect(table).toContain('Scenario');
    expect(table).toContain('AI Patch');
    expect(table).toContain('Verified');
    expect(table).toContain('AI verified: 4/5');
  });
});

describe('evalExitCode', () => {
  it('returns 0 when 4 of 5 verify (default minVerified = 4)', () => {
    const rows: EvalRow[] = [
      {
        key: 'B1',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: false,
      },
      {
        key: 'B2',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: false,
      },
      {
        key: 'B3',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: false,
      },
      {
        key: 'B4',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: false,
      },
      {
        key: 'B5',
        aiPatchProduced: true,
        verified: false,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: true,
      },
    ];
    expect(evalExitCode(rows)).toBe(0);
  });

  it('returns 1 when 3 of 5 verify (default minVerified = 4)', () => {
    const rows: EvalRow[] = [
      {
        key: 'B1',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: false,
      },
      {
        key: 'B2',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: false,
      },
      {
        key: 'B3',
        aiPatchProduced: true,
        verified: true,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: false,
      },
      {
        key: 'B4',
        aiPatchProduced: true,
        verified: false,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: true,
      },
      {
        key: 'B5',
        aiPatchProduced: true,
        verified: false,
        attempts: 1,
        seconds: 1.0,
        fallbackUsed: true,
      },
    ];
    expect(evalExitCode(rows)).toBe(1);
  });
});
