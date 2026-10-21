import { describe, expect, it } from 'vitest';
import { computeScore } from '@payclinic/core';

const f = (invariantKey: any, severity: any, state: any = 'open') => ({
  invariantKey,
  severity,
  state,
});
describe('computeScore', () => {
  it('is 100 with no findings', () => expect(computeScore([]).score).toBe(100));
  it('three open criticals score 70', () => {
    expect(
      computeScore([f('I-01', 'critical'), f('I-02', 'critical'), f('I-04', 'critical')]).score,
    ).toBe(70);
  });
  it('counts a distinct invariant key once', () => {
    expect(computeScore([f('I-01', 'critical'), f('I-01', 'critical')]).score).toBe(90);
  });
  it('verified and protected findings no longer count', () => {
    const s = computeScore([
      f('I-01', 'critical', 'verified'),
      f('I-08', 'critical', 'protected'),
      f('I-05', 'high'),
    ]);
    expect(s).toMatchObject({ score: 94, unresolvedCount: 1, resolvedCount: 2 });
  });
  it('all eight non-I-03 invariants unresolved scores 39 and never goes below 0', () => {
    const all = ['I-01', 'I-02', 'I-04', 'I-05', 'I-06', 'I-07', 'I-08', 'I-09'].map((k) =>
      f(
        k,
        (
          {
            'I-01': 'critical',
            'I-02': 'critical',
            'I-04': 'critical',
            'I-05': 'high',
            'I-06': 'medium',
            'I-07': 'high',
            'I-08': 'critical',
            'I-09': 'high',
          } as any
        )[k],
      ),
    );
    expect(computeScore(all).score).toBe(39);
    expect(
      computeScore(Array.from({ length: 50 }, (_, i) => f(`I-0${(i % 9) + 1}`, 'critical'))).score,
    ).toBeGreaterThanOrEqual(0);
  });
});
