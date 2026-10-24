import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createRepos, loadConfig, openDb, runDiagnose } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repo = join(__dirname, '../..');
let n = 0;

it('B5 produces one I-06 finding whose evidence is the rejected JPY create request', async () => {
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
    { target: 'store', mode: 'offline', scenarios: ['B5'] },
  );
  expect(out.findings.map((f) => `${f.scenarioKey}:${f.invariantKey}:${f.severity}`)).toEqual([
    'B5:I-06:medium',
  ]);
  const [evidence] = repos.listStepsByIds(out.findings[0]!.evidenceStepIds);
  expect(evidence).toMatchObject({ actor: 'store', method: 'POST', responseStatus: 422 });
  expect(JSON.stringify(evidence!.requestBody)).toContain('2400.00');
}, 60_000);
