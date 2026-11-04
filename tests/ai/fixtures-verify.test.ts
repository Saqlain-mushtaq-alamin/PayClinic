import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PatchOutput, SCENARIO_META, type Finding, type ScenarioKey } from '@payclinic/contracts';
import { createVerify, loadConfig } from '@payclinic/core';
import { FixtureProvider, prescribe } from '@payclinic/ai';
import { SCENARIOS } from '../../scenarios';

const repoRoot = join(__dirname, '../..');
const fixturesAiDir = join(repoRoot, 'fixtures/ai');
const workspaceRoot = join(repoRoot, '.payclinic-tmp', 'fixtures-verify-workspace');

rmSync(workspaceRoot, { recursive: true, force: true });
mkdirSync(join(workspaceRoot, 'apps'), { recursive: true });
cpSync(join(repoRoot, 'apps', 'buggy-store'), join(workspaceRoot, 'apps', 'buggy-store'), {
  recursive: true,
});
afterAll(() => rmSync(workspaceRoot, { recursive: true, force: true }));

let n = 0;
const verifyDeps = {
  repoRoot: workspaceRoot,
  config: loadConfig({}),
  scenarios: SCENARIOS,
  newId: () => `fv${++n}`,
  now: () => new Date(),
};
const { verify } = createVerify(verifyDeps);

const candidateKeys = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
const activeKeys = candidateKeys.filter((k) => existsSync(join(fixturesAiDir, `patch.${k}.json`)));

const loadReferencePatch = (key: ScenarioKey): PatchOutput | null => {
  const p = join(repoRoot, 'fixtures/patches', `${key}.json`);
  if (!existsSync(p)) return null;
  return PatchOutput.parse(JSON.parse(readFileSync(p, 'utf8')));
};

describe('fixtures-verify', () => {
  if (activeKeys.length === 0) {
    it('requires at least one fixture to be present', () => {
      expect(activeKeys.length).toBeGreaterThan(0);
    });
  }

  for (const key of activeKeys) {
    it(`${key}: recorded AI patch verifies`, async () => {
      const finding: Finding = {
        id: `f-${key}`,
        runId: 'r-fixtures-verify',
        scenarioKey: key,
        invariantKey: SCENARIO_META[key].invariantKeys[0]!,
        severity: 'critical',
        state: 'open',
        title: key,
        summary: `Offline recorded fixture verification for ${key}`,
        evidenceStepIds: [],
        createdAt: '2026-10-18T10:00:00.000Z',
      };

      const prescribeDeps = {
        provider: new FixtureProvider(fixturesAiDir),
        readSource: (file: string) => readFileSync(join(workspaceRoot, file), 'utf8'),
        loadReferencePatch,
        deriveDiff: () => '--- a\n+++ b\n',
        newId: () => `id-${++n}`,
        now: () => '2026-10-18T10:00:00.000Z',
      };

      const { patches } = await prescribe(prescribeDeps, finding, []);
      expect(patches.length).toBeGreaterThan(0);
      const aiPatch = patches[0]!;
      expect(aiPatch.source).toBe('ai');

      const outcome = await verify(finding, aiPatch, {
        mode: 'offline',
        runId: `r-${key}`,
      });
      expect(outcome.verified).toBe(true);
    });
  }
});
