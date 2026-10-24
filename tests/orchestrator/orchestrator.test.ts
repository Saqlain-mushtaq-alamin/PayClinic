import { EventEmitter } from 'node:events';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PatchOutput,
  type Explanation,
  type Finding,
  type Patch,
  type RunEvent,
} from '@payclinic/contracts';
import {
  createOrchestrator,
  createRepos,
  loadConfig,
  openDb,
  ProtectNotApplicableError,
  type Prescriber,
} from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repoRoot = join(__dirname, '../..');
// Keep this suite's temp copies outside the top-level verify-* namespace that other tests inspect.
const workspaceRoot = join(repoRoot, '.payclinic-tmp', 'orchestrator-workspace');
rmSync(workspaceRoot, { recursive: true, force: true });
mkdirSync(join(workspaceRoot, 'apps'), { recursive: true });
cpSync(join(repoRoot, 'apps', 'buggy-store'), join(workspaceRoot, 'apps', 'buggy-store'), {
  recursive: true,
});
afterAll(() => rmSync(workspaceRoot, { recursive: true, force: true }));

const ref = PatchOutput.parse(
  JSON.parse(readFileSync(join(repoRoot, 'fixtures/patches/B2.json'), 'utf8')),
);
const iso = '2026-10-18T10:00:00.000Z';
let n = 0;
const newId = () => `o${++n}`;
const patchFor = (
  f: Finding,
  edits = ref.edits,
  source: 'ai' | 'template' = 'template',
): Patch => ({
  id: newId(),
  findingId: f.id,
  edits,
  diff: '--- a\n+++ b\n',
  source,
  createdAt: iso,
});
const explanationFor = (f: Finding): Explanation => ({
  findingId: f.id,
  rootCause: 'cause',
  impact: 'impact',
  whereInCode: { file: ref.edits[0]!.file, hint: 'h' },
  fixSummary: 'fix',
  model: 'test',
  createdAt: iso,
});
const badEdits = [{ ...ref.edits[0]!, replace: 'return clientTotal ?? serverTotal; // noop' }];
const good: Prescriber = async (f) => ({ explanation: explanationFor(f), patches: [patchFor(f)] });

function setup(prescriber: Prescriber) {
  const repos = createRepos(openDb(':memory:'));
  const bus = new EventEmitter();
  const events: RunEvent[] = [];
  bus.on('event', (e: RunEvent) => events.push(e));
  const orch = createOrchestrator({
    repos,
    config: loadConfig({}),
    scenarios: SCENARIOS,
    repoRoot: workspaceRoot,
    storeSourceDir: join(workspaceRoot, 'apps/buggy-store'),
    prescriber,
    newId,
    now: () => new Date(iso),
    bus,
  });
  return { repos, orch, events };
}
const startB2 = async (t: ReturnType<typeof setup>) => {
  const runId = t.orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
  await t.orch.idle();
  return { runId, finding: t.repos.listFindings(runId)[0]! };
};

describe('orchestrator', () => {
  it('startRun returns a queued run immediately and completes with one open I-02 finding', async () => {
    const t = setup(good);
    const runId = t.orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
    expect(t.repos.getRun(runId)!.status).toMatch(/queued|running/);
    await t.orch.idle();
    expect(t.repos.getRun(runId)!.status).toBe('completed');
    expect(t.repos.listFindings(runId).map((f) => `${f.invariantKey}:${f.state}`)).toEqual([
      'I-02:open',
    ]);
  }, 120_000);

  it('prescribe verifies the finding, raises the score to 100 and emits the stages in order', async () => {
    const t = setup(good);
    const { runId, finding } = await startB2(t);
    await t.orch.prescribe(finding.id);
    const stages = t.events
      .filter(
        (e): e is Extract<RunEvent, { type: 'prescribe.progress' }> =>
          e.type === 'prescribe.progress',
      )
      .map((e) => e.stage);
    expect(stages).toEqual(['explaining', 'patching', 'verifying', 'done']);
    expect(t.repos.getFinding(finding.id)!.state).toBe('verified');
    const patch = t.repos.getPatchForFinding(finding.id)!;
    expect(t.repos.getVerifyForPatch(patch.id)).toMatchObject({ verified: true });
    expect(t.repos.getRun(runId)!.scoreAfter).toBe(100);
  }, 180_000);

  it('tries the next patch when the first does not verify', async () => {
    const second = { id: '' } as { id: string };
    const t = setup(async (f) => {
      const bad = patchFor(f, badEdits, 'ai');
      const ok = patchFor(f);
      second.id = ok.id;
      return { explanation: explanationFor(f), patches: [bad, ok] };
    });
    const { finding } = await startB2(t);
    await t.orch.prescribe(finding.id);
    expect(t.repos.getFinding(finding.id)!.state).toBe('verified');
    expect(t.repos.getPatchForFinding(finding.id)!.id).toBe(second.id);
  }, 240_000);

  it('marks the finding unverified and emits failed when no patch verifies', async () => {
    const t = setup(async (f) => ({
      explanation: explanationFor(f),
      patches: [patchFor(f, badEdits, 'ai')],
    }));
    const { finding } = await startB2(t);
    await t.orch.prescribe(finding.id);
    expect(t.repos.getFinding(finding.id)!.state).toBe('unverified');
    const last = [...t.events].reverse().find((e) => e.type === 'prescribe.progress');
    expect(last).toMatchObject({ stage: 'failed' });
  }, 180_000);

  it('runs queued runs one at a time, in order', async () => {
    const t = setup(good);
    t.orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
    t.orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
    await t.orch.idle();
    expect(
      t.events
        .filter((e) => e.type === 'run.started' || e.type === 'run.completed')
        .map((e) => e.type),
    ).toEqual(['run.started', 'run.completed', 'run.started', 'run.completed']);
  }, 240_000);

  it('protect rejects with ProtectNotApplicableError for a store run', async () => {
    const t = setup(good);
    const { runId } = await startB2(t);
    await expect(t.orch.protect(runId)).rejects.toThrow(ProtectNotApplicableError);
  }, 120_000);
});
