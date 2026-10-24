import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createRepos, loadConfig, openDb, runDiagnose } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repo = join(__dirname, '../..');
let n = 0;

it('B3 produces exactly one I-05 finding and three webhook deliveries', async () => {
  const repos = createRepos(openDb(':memory:'));
  const out = await runDiagnose(
    {
      repos,
      config: loadConfig({}),
      scenarios: SCENARIOS,
      storeSourceDir: join(repo, 'apps/buggy-store'),
      newId: () => `id${++n}`,
      now: () => new Date('2026-10-18T10:00:00Z'),
    },
    { target: 'store', mode: 'offline', scenarios: ['B3'] },
  );
  expect(out.findings.map((f) => `${f.scenarioKey}:${f.invariantKey}:${f.severity}`)).toEqual([
    'B3:I-05:high',
  ]);
  const hooks = repos
    .listSteps(out.runId)
    .filter((s) => s.actor === 'runner' && s.url.endsWith('/webhooks/paypal'));
  expect(hooks).toHaveLength(3);
}, 60_000);
