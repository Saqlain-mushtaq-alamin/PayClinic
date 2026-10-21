import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepos, loadConfig, openDb, runDiagnose } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repo = join(__dirname, '../..');
let n = 0;
const deps = () => ({
  repos: createRepos(openDb(':memory:')),
  config: loadConfig({}),
  scenarios: SCENARIOS,
  storeSourceDir: join(repo, 'apps/buggy-store'),
  newId: () => `id${++n}`,
  now: () => new Date('2026-10-18T10:00:00Z'),
});

describe('runDiagnose (offline)', () => {
  it('finds I-01 for B1, I-02 for B2, I-04 for B4 and scores 70', async () => {
    const d = deps();
    const events: string[] = [];
    const out = await runDiagnose(
      { ...d, emit: (e) => events.push(e.type) },
      { target: 'store', mode: 'offline', scenarios: ['B1', 'B2', 'B4'] },
    );
    expect(out.findings.map((f) => `${f.scenarioKey}:${f.invariantKey}`).sort()).toEqual([
      'B1:I-01',
      'B2:I-02',
      'B4:I-04',
    ]);
    expect(out.score.score).toBe(70);
    expect(d.repos.getRun(out.runId)).toMatchObject({ status: 'completed', scoreBefore: 70 });
    expect(d.repos.listSteps(out.runId).length).toBeGreaterThan(15);
    expect(d.repos.listScenarios(out.runId).map((s) => s.status)).toEqual([
      'failed',
      'failed',
      'failed',
    ]);
    expect(events[0]).toBe('run.started');
    expect(events.at(-1)).toBe('run.completed');
  }, 60_000);

  it('never stores tokens or authorization headers', async () => {
    const d = deps();
    const out = await runDiagnose(d, { target: 'store', mode: 'offline', scenarios: ['B1'] });
    const json = JSON.stringify(d.repos.listSteps(out.runId));
    expect(json).not.toContain('SIM-TOKEN');
    expect(json).not.toContain('Bearer ');
  }, 60_000);

  it('marks a throwing scenario as error and still completes the run', async () => {
    const d = deps();
    const boom = async () => {
      throw new Error('boom');
    };
    const out = await runDiagnose(
      { ...d, scenarios: { ...SCENARIOS, B1: boom } },
      { target: 'store', mode: 'offline', scenarios: ['B1', 'B2'] },
    );
    const st = d.repos.listScenarios(out.runId);
    expect(st.find((s) => s.key === 'B1')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('boom'),
    });
    expect(d.repos.getRun(out.runId)!.status).toBe('completed');
    expect(out.findings.some((f) => f.scenarioKey === 'B2')).toBe(true);
  }, 60_000);

  it('times out a scenario that never finishes', async () => {
    const d = deps();
    const hang = () => new Promise<void>(() => {});
    const out = await runDiagnose(
      { ...d, scenarios: { ...SCENARIOS, B1: hang }, scenarioTimeoutMs: 500 },
      { target: 'store', mode: 'offline', scenarios: ['B1'] },
    );
    expect(d.repos.listScenarios(out.runId)[0]).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/timed out/i),
    });
  }, 60_000);
});
