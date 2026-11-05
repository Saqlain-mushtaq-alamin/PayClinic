import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PatchOutput, type PatchEdit, type ScenarioKey } from '@payclinic/contracts';
import { FakeProvider, prescribe, type PrescribeDeps } from '@payclinic/ai';
import {
  createOrchestrator,
  createRepos,
  derivePatchDiff,
  loadConfig,
  openDb,
  type Config,
  type Database,
  type Orchestrator,
  type Prescriber,
  type Repos,
} from '@payclinic/core';
import { createApi } from '@payclinic/cli';
import { SCENARIOS } from '../../scenarios';

export interface TestRuntime {
  orchestrator: Orchestrator;
  repos: Repos;
  config: Config;
  bus: EventEmitter;
  db: Database;
}

export async function buildTestRuntime(): Promise<TestRuntime> {
  const repoRoot = resolve(__dirname, '../..');
  const config = loadConfig({ AI_PROVIDER: 'fake', DB_PATH: ':memory:' });
  const db = openDb(':memory:');
  const repos = createRepos(db);
  const bus = new EventEmitter();
  let idCounter = 0;
  const newId = () => `e2e-${Date.now()}-${++idCounter}`;
  const now = () => new Date();

  const fakeMap: Record<string, unknown> = {};
  for (const key of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
    const patchPath = join(repoRoot, 'fixtures', 'patches', `${key}.json`);
    if (existsSync(patchPath)) {
      fakeMap[`patch:${key}`] = JSON.parse(readFileSync(patchPath, 'utf8'));
    }
    const explainPath = join(repoRoot, 'fixtures', 'ai', `explain.${key}.json`);
    if (existsSync(explainPath)) {
      fakeMap[`explain:${key}`] = JSON.parse(readFileSync(explainPath, 'utf8'));
    }
  }

  const provider = new FakeProvider(fakeMap);
  const readSource = (repoRelativePath: string) => {
    return readFileSync(resolve(repoRoot, repoRelativePath), 'utf8');
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
    storeSourceDir: join(repoRoot, 'apps', 'buggy-store'),
    prescriber,
    newId,
    now,
    bus,
  });

  return { orchestrator, repos, config, bus, db };
}

export async function startApiOnFreePort(runtime: TestRuntime) {
  const app = createApi({
    orchestrator: runtime.orchestrator,
    repos: runtime.repos,
    config: runtime.config,
    bus: runtime.bus,
    version: 'test',
  });
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    baseUrl,
    async close() {
      await runtime.orchestrator.idle();
      await app.close();
      runtime.db.close();
    },
  };
}
