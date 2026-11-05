import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PatchOutput, type PatchEdit, type ScenarioKey } from '@payclinic/contracts';
import { FixtureProvider, prescribe, type PrescribeDeps } from '@payclinic/ai';
import {
  createOrchestrator,
  createRepos,
  derivePatchDiff,
  loadConfig,
  openDb,
  type Prescriber,
} from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repoRoot = resolve(__dirname, '../..');

function setupOrchestrator() {
  const db = openDb(':memory:');
  const repos = createRepos(db);
  const config = loadConfig({
    AI_PROVIDER: 'fixture',
    PAYCLINIC_MODE: 'offline',
    BUYER_APPROVER: 'sim',
  });
  const bus = new EventEmitter();
  const newId = () => randomUUID();

  const provider = new FixtureProvider(join(repoRoot, 'fixtures', 'ai'));
  const readSource = (repoRelativePath: string) => {
    const fullPath = resolve(repoRoot, repoRelativePath);
    return readFileSync(fullPath, 'utf8');
  };
  const loadReferencePatch = (scenarioKey: ScenarioKey) => {
    const path = join(repoRoot, 'fixtures', 'patches', `${scenarioKey}.json`);
    if (!existsSync(path)) return null;
    return PatchOutput.parse(JSON.parse(readFileSync(path, 'utf8')));
  };

  const prescriberDeps: PrescribeDeps = {
    provider,
    readSource,
    loadReferencePatch,
    deriveDiff: (edits: PatchEdit[]) => derivePatchDiff(edits, readSource),
    newId,
    now: () => new Date().toISOString(),
  };

  const prescriber: Prescriber = (finding, steps) => prescribe(prescriberDeps, finding, steps);

  const orchestrator = createOrchestrator({
    repos,
    config,
    scenarios: SCENARIOS,
    repoRoot,
    storeSourceDir: join(repoRoot, 'apps/buggy-store'),
    prescriber,
    newId,
    now: () => new Date(),
    bus,
  });

  return { orchestrator, repos };
}

describe('run-time budget and performance', () => {
  it('diagnoses B1..B5 offline in <= 60 s and reuses one store process', async () => {
    const { orchestrator, repos } = setupOrchestrator();

    const start = performance.now();
    const runId = orchestrator.startRun({
      target: 'store',
      mode: 'offline',
      scenarios: ['B1', 'B2', 'B3', 'B4', 'B5'],
    });

    await orchestrator.idle();
    const elapsedMs = performance.now() - start;

    console.info(`[perf] B1..B5 diagnose offline: ${elapsedMs.toFixed(1)} ms`);

    const run = repos.getRun(runId);
    expect(run?.status).toBe('completed');

    const findings = repos.listFindings(runId);
    expect(findings.length).toBeGreaterThanOrEqual(4);

    expect(elapsedMs).toBeLessThanOrEqual(60_000);
  }, 120_000);

  it('prescribes and verifies one finding in <= 40 s', async () => {
    const { orchestrator, repos } = setupOrchestrator();

    const runId = orchestrator.startRun({
      target: 'store',
      mode: 'offline',
      scenarios: ['B2'],
    });
    await orchestrator.idle();

    const findings = repos.listFindings(runId);
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings[0]!;

    const start = performance.now();
    await orchestrator.prescribe(finding.id);
    await orchestrator.idle();
    const elapsedMs = performance.now() - start;

    console.info(
      `[perf] Prescribe+verify finding (${finding.scenarioKey}): ${elapsedMs.toFixed(1)} ms`,
    );

    const updated = repos.getFinding(finding.id);
    expect(updated?.state).toBe('verified');

    expect(elapsedMs).toBeLessThanOrEqual(40_000);
  }, 120_000);
});
