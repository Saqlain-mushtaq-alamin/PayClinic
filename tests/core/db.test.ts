import { beforeEach, describe, expect, it } from 'vitest';
import type { Explanation, Finding, Run } from '@payclinic/contracts';
import { buildStep } from '@payclinic/contracts/testing';
import { createRepos, openDb, type Repos } from '@payclinic/core';

const T = '2026-10-18T10:00:00.000Z';
const run = (over: Partial<Run> = {}): Run => ({
  id: 'run-1',
  target: 'store',
  mode: 'offline',
  scenarioKeys: ['B1', 'B2'],
  status: 'running',
  startedAt: T,
  ...over,
});
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  runId: 'run-1',
  scenarioKey: 'B1',
  invariantKey: 'I-01',
  severity: 'critical',
  state: 'open',
  title: 't',
  summary: 's',
  evidenceStepIds: ['s0'],
  createdAt: T,
  ...over,
});
const explanation = (rootCause: string): Explanation => ({
  findingId: 'f1',
  rootCause,
  impact: 'i',
  whereInCode: { file: 'apps/buggy-store/src/orders/create.ts', hint: 'h' },
  fixSummary: 'f',
  model: 'm',
  createdAt: T,
});
const step = (seq: number, scenarioId = 'scn-1', over = {}) =>
  buildStep({ id: `${scenarioId}-s${seq}`, runId: 'run-1', scenarioId, seq, ...over });

let db: ReturnType<typeof openDb>;
let repos: Repos;
beforeEach(() => {
  db = openDb(':memory:');
  repos = createRepos(db);
  repos.insertRun(run());
  repos.insertScenario({ id: 'scn-1', runId: 'run-1', key: 'B1', status: 'running' });
  repos.insertScenario({ id: 'scn-2', runId: 'run-1', key: 'B2', status: 'pending' });
});

describe('repositories', () => {
  it('round-trips a run and updates its fields', () => {
    expect(repos.getRun('run-1')).toEqual(run());
    repos.updateRun('run-1', { status: 'completed', scoreBefore: 70, completedAt: T });
    expect(repos.getRun('run-1')).toMatchObject({
      status: 'completed',
      scoreBefore: 70,
      completedAt: T,
    });
    expect(repos.getRun('missing')).toBeNull();
  });
  it('lists runs newest first', () => {
    repos.insertRun(run({ id: 'run-2', startedAt: '2026-10-18T11:00:00.000Z' }));
    expect(repos.listRuns().map((r) => r.id)).toEqual(['run-2', 'run-1']);
  });
  it('returns steps ordered by seq and can filter by scenario', () => {
    repos.insertSteps([step(2), step(0), step(1), step(0, 'scn-2')]);
    expect(repos.listSteps('run-1', 'scn-1').map((s) => s.seq)).toEqual([0, 1, 2]);
    expect(repos.listSteps('run-1')).toHaveLength(4);
    expect(repos.listStepsByIds(['scn-2-s0']).map((s) => s.scenarioId)).toEqual(['scn-2']);
  });
  it('stores request and response bodies as JSON and returns them parsed', () => {
    repos.insertSteps([step(0, 'scn-1', { requestBody: { a: 1 }, responseBody: { ok: [1, 2] } })]);
    const [s] = repos.listSteps('run-1', 'scn-1');
    expect(s!.requestBody).toEqual({ a: 1 });
    expect(s!.responseBody).toEqual({ ok: [1, 2] });
  });
  it('stores findings and updates their state', () => {
    repos.insertFinding(finding());
    repos.updateFindingState('f1', 'verified');
    expect(repos.getFinding('f1')!.state).toBe('verified');
    expect(repos.listFindings('run-1')).toHaveLength(1);
  });
  it('upserts an explanation (second write wins)', () => {
    repos.insertFinding(finding());
    repos.upsertExplanation(explanation('first'));
    repos.upsertExplanation(explanation('second'));
    expect(repos.getExplanation('f1')!.rootCause).toBe('second');
  });
  it('deleting a run cascades to scenarios, steps and findings', () => {
    repos.insertSteps([step(0)]);
    repos.insertFinding(finding());
    db.prepare('DELETE FROM runs WHERE id = ?').run('run-1');
    for (const table of ['scenarios', 'steps', 'findings']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
  });
  it('rejects a stored row that violates the contract schema when reading', () => {
    db.prepare("UPDATE runs SET status = 'bogus' WHERE id = 'run-1'").run();
    expect(() => repos.getRun('run-1')).toThrow();
  });
});
