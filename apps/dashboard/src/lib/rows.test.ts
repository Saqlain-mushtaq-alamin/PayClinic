import { describe, expect, it } from 'vitest';
import type { Finding } from '@payclinic/contracts';
import { toFindingRows } from './rows';

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  runId: 'run-1',
  scenarioKey: 'B1',
  invariantKey: 'I-01',
  severity: 'critical',
  state: 'open',
  title: 'Customer charged twice for one cart',
  summary: 'Cart cart-1 was captured 2 times.',
  evidenceStepIds: [],
  createdAt: '2026-10-18T10:00:00.000Z',
  ...over,
});

describe('toFindingRows', () => {
  it('maps finding fields and keeps their order', () => {
    const rows = toFindingRows([
      finding(),
      finding({
        id: 'f2',
        scenarioKey: 'B2',
        invariantKey: 'I-02',
        severity: 'high',
        state: 'verified',
        title: 'Capture amount differs',
      }),
    ]);
    expect(rows).toEqual([
      {
        id: 'f1',
        scenario: 'B1',
        invariant: 'I-01',
        severity: 'critical',
        state: 'open',
        title: 'Customer charged twice for one cart',
      },
      {
        id: 'f2',
        scenario: 'B2',
        invariant: 'I-02',
        severity: 'high',
        state: 'verified',
        title: 'Capture amount differs',
      },
    ]);
  });
});
