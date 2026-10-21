import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InvariantResult, RunState, Step } from '@payclinic/contracts';
import { createRepos, loadConfig, openDb, runDiagnose } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repo = join(__dirname, '../..');
let n = 0;

describe('IC1 end-to-end smoke test', () => {
  it('runs diagnose offline on B1, B2, B4 within 30s and verifies traces, findings, and score', async () => {
    const start = Date.now();
    const traces = new Map<
      string,
      { steps: Step[]; state: RunState; results: InvariantResult[] }
    >();

    const db = openDb(':memory:');
    const repos = createRepos(db);
    const config = loadConfig({});

    const out = await runDiagnose(
      {
        repos,
        config,
        scenarios: SCENARIOS,
        storeSourceDir: join(repo, 'apps/buggy-store'),
        newId: () => `ic1-${++n}`,
        now: () => new Date('2026-10-18T10:00:00Z'),
        onScenarioFinished: (key, info) => {
          traces.set(key, info);
        },
      },
      {
        target: 'store',
        mode: 'offline',
        scenarios: ['B1', 'B2', 'B4'],
      },
    );

    const elapsedMs = Date.now() - start;

    // Assert total run time is under 30s
    expect(elapsedMs).toBeLessThan(30_000);

    // Assert findings are exactly B1:I-01, B2:I-02, B4:I-04
    const findingKeys = out.findings.map((f) => `${f.scenarioKey}:${f.invariantKey}`).sort();
    expect(findingKeys).toEqual(['B1:I-01', 'B2:I-02', 'B4:I-04']);

    // Assert score is 70
    expect(out.score.score).toBe(70);

    // Verify B1 trace exists
    const b1 = traces.get('B1');
    expect(b1).toBeDefined();
    const b1Steps = b1!.steps;

    // The B1 trace contains two successful store->PayPal order creations with the same custom_id
    const storeOrderCreates = b1Steps.filter(
      (s) =>
        s.actor === 'store' &&
        s.method === 'POST' &&
        s.url.includes('/v2/checkout/orders') &&
        !s.url.includes('/capture') &&
        s.responseStatus === 201,
    );
    expect(storeOrderCreates).toHaveLength(2);

    const create0 = storeOrderCreates[0]!;
    const create1 = storeOrderCreates[1]!;

    const customId0 = (
      create0.requestBody as {
        purchase_units?: Array<{ custom_id?: string }>;
      }
    )?.purchase_units?.[0]?.custom_id;
    const customId1 = (
      create1.requestBody as {
        purchase_units?: Array<{ custom_id?: string }>;
      }
    )?.purchase_units?.[0]?.custom_id;

    expect(customId0).toBeDefined();
    expect(customId0).toBe(customId1);

    // And two successful captures
    const storeCaptures = b1Steps.filter(
      (s) =>
        s.actor === 'store' &&
        s.method === 'POST' &&
        s.url.includes('/capture') &&
        s.responseStatus === 201,
    );
    expect(storeCaptures).toHaveLength(2);

    // Every step has seq strictly increasing
    for (const [_key, trace] of traces) {
      expect(trace.steps.length).toBeGreaterThan(0);
      for (let i = 1; i < trace.steps.length; i++) {
        expect(trace.steps[i]!.seq).toBeGreaterThan(trace.steps[i - 1]!.seq);
      }
    }
  }, 35_000);
});
