import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PatchOutput, SCENARIO_META, type Finding, type ScenarioKey } from '@payclinic/contracts';
import { createVerify, executeScenarios, loadConfig, withPatchedStore } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repoRoot = join(__dirname, '../..');
// Keep this suite's temp copies outside the top-level verify-* namespace that other tests inspect.
const workspaceRoot = join(repoRoot, '.payclinic-tmp', 'a04-workspace');
rmSync(workspaceRoot, { recursive: true, force: true });
mkdirSync(join(workspaceRoot, 'apps'), { recursive: true });
cpSync(join(repoRoot, 'apps', 'buggy-store'), join(workspaceRoot, 'apps', 'buggy-store'), {
  recursive: true,
});
afterAll(() => rmSync(workspaceRoot, { recursive: true, force: true }));

let n = 0;
const deps = {
  repoRoot: workspaceRoot,
  config: loadConfig({}),
  scenarios: SCENARIOS,
  newId: () => `t${++n}`,
  now: () => new Date(),
};
const { verify } = createVerify(deps);
const keys = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
const load = (k: string) =>
  PatchOutput.parse(
    JSON.parse(readFileSync(join(repoRoot, 'fixtures/patches', `${k}.json`), 'utf8')),
  );

describe('reference patches', () => {
  for (const key of keys) {
    it(`${key}: verifies through the verify loop`, async () => {
      const ref = load(key);
      const finding: Finding = {
        id: `f-${key}`,
        runId: 'r',
        scenarioKey: key as ScenarioKey,
        invariantKey: SCENARIO_META[key].invariantKeys[0]!,
        severity: 'critical',
        state: 'open',
        title: key,
        summary: key,
        evidenceStepIds: [],
        createdAt: '2026-10-18T10:00:00.000Z',
      };
      const r = await verify(
        finding,
        {
          id: `p-${key}`,
          findingId: finding.id,
          edits: ref.edits,
          diff: '',
          source: 'template',
          createdAt: finding.createdAt,
        },
        { mode: 'offline', runId: 'r' },
      );
      expect(r.log.join('\n')).not.toMatch(/not found/);
      expect(r).toMatchObject({
        applied: true,
        started: true,
        invariantPassed: true,
        verified: true,
      });
    }, 120_000);
  }

  it('all five together make every merchant scenario pass', async () => {
    const edits = keys.flatMap((k) => load(k).edits);
    const out = await withPatchedStore(
      deps,
      edits,
      async (storeDir) =>
        executeScenarios({ ...deps, storeSourceDir: storeDir, runId: 'all' }, [...keys]),
      { maxEdits: 20 },
    );
    expect('applyError' in out ? out.applyError : '').toBe('');
    const rows = out as Awaited<ReturnType<typeof executeScenarios>>;
    for (const row of rows)
      expect(
        row.results.filter((r) => !r.passed),
        `${row.key} still failing`,
      ).toEqual([]);
  }, 240_000);
});
