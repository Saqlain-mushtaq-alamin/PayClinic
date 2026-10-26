import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVerify, loadConfig } from '@payclinic/core';
import type { Finding, Patch, PatchEdit } from '@payclinic/contracts';
import { SCENARIOS } from '../../scenarios';

const repoRoot = join(__dirname, '../..');
let n = 0;
const { verify } = createVerify({
  repoRoot,
  config: loadConfig({}),
  scenarios: SCENARIOS,
  newId: () => `v${++n}`,
  now: () => new Date(),
});
const finding: Finding = {
  id: 'f1',
  runId: 'r1',
  scenarioKey: 'B2',
  invariantKey: 'I-02',
  severity: 'critical',
  state: 'open',
  title: 't',
  summary: 's',
  evidenceStepIds: [],
  createdAt: '2026-10-18T10:00:00.000Z',
};
const patch = (edits: PatchEdit[], extra: Partial<Patch> = {}): Patch => ({
  id: 'p1',
  findingId: 'f1',
  edits,
  diff: '',
  source: 'ai',
  createdAt: '2026-10-18T10:00:00.000Z',
  ...extra,
});
const file = 'apps/buggy-store/src/orders/pricing.ts';
const fix = { file, search: 'return clientTotal ?? serverTotal;', replace: 'return serverTotal;' };
const opts = { mode: 'offline' as const, runId: 'r1' };

function hashDir(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) =>
    readdirSync(d)
      .sort()
      .forEach((f) => {
        if (f === 'node_modules') return;
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else h.update(p).update(readFileSync(p));
      });
  walk(dir);
  return h.digest('hex');
}

describe('verifyPatch', () => {
  it('verifies a correct fix for B2', async () => {
    const r = await verify(finding, patch([fix]), opts);
    expect(r).toMatchObject({
      applied: true,
      started: true,
      invariantPassed: true,
      testsPassed: null,
      verified: true,
    });
    expect(r.log.length).toBeGreaterThanOrEqual(4);
  }, 90_000);

  it('does not verify an edit that applies but does not fix the bug', async () => {
    const r = await verify(
      finding,
      patch([{ ...fix, replace: 'return clientTotal ?? serverTotal; // changed' }]),
      opts,
    );
    expect(r).toMatchObject({
      applied: true,
      started: true,
      invariantPassed: false,
      verified: false,
    });
  }, 90_000);

  it('reports applied:false when the search text is not found', async () => {
    const r = await verify(finding, patch([{ ...fix, search: 'this text does not exist' }]), opts);
    expect(r).toMatchObject({ applied: false, started: false, verified: false });
    expect(r.log.join('\n')).toMatch(/not found|0 matches/i);
  }, 60_000);

  it('reports applied:false when the search text matches more than once', async () => {
    const r = await verify(finding, patch([{ ...fix, search: 'e' }]), opts);
    expect(r.applied).toBe(false);
    expect(r.log.join('\n')).toMatch(/more than once|matches/i);
  }, 60_000);

  it('rejects unsafe edits before touching anything', async () => {
    const r = await verify(
      finding,
      patch([{ ...fix, replace: 'return process.env.SECRET;' }]),
      opts,
    );
    expect(r).toMatchObject({ applied: false, verified: false });
  }, 60_000);

  it('reports started:false (quickly) when the patched store cannot boot', async () => {
    const t0 = Date.now();
    const r = await verify(finding, patch([{ ...fix, replace: 'return clientTotal ?? ;' }]), opts);
    expect(r).toMatchObject({ applied: true, started: false, verified: false });
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);

  it('leaves the repository store untouched and removes the temp directory', async () => {
    const before = hashDir(join(repoRoot, 'apps/buggy-store'));
    await verify(finding, patch([fix]), opts);
    expect(hashDir(join(repoRoot, 'apps/buggy-store'))).toBe(before);
    const tmp = join(repoRoot, '.payclinic-tmp');
    // Only this suite's temp dirs: other test files verify concurrently in the same repo.
    expect(existsSync(tmp) ? readdirSync(tmp).filter((x) => x.startsWith('verify-v')) : []).toEqual(
      [],
    );
  }, 90_000);

  it('runs a provided regression test and marks testsPassed', async () => {
    const testFile = {
      path: 'b2.regression.test.ts',
      content:
        "import { it, expect } from 'vitest';\nimport { resolveAmount } from '../src/orders/pricing';\nit('ignores the client total', () => { expect(resolveAmount('25.00', '1.00')).toBe('25.00'); });\n",
    };
    const r = await verify(finding, patch([fix], { testFile }), opts);
    expect(r.testsPassed).toBe(true);
    expect(r.verified).toBe(true);
  }, 120_000);

  it('fails verification when the regression test fails', async () => {
    const testFile = {
      path: 'b2.bad.test.ts',
      content: "import { it, expect } from 'vitest';\nit('fails', () => { expect(1).toBe(2); });\n",
    };
    const r = await verify(finding, patch([fix], { testFile }), opts);
    expect(r).toMatchObject({ invariantPassed: true, testsPassed: false, verified: false });
  }, 120_000);
});
