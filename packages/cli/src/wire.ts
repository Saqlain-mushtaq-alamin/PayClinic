import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PatchOutput,
  type AIProvider,
  type PatchEdit,
  type ScenarioKey,
} from '@payclinic/contracts';
import {
  FakeProvider,
  FixtureProvider,
  GeminiProvider,
  prescribe,
  type PrescribeDeps,
} from '@payclinic/ai';
import {
  ConfigError,
  createOrchestrator,
  createRepos,
  derivePatchDiff,
  loadConfig,
  openDb,
  type Config,
  type Orchestrator,
  type Prescriber,
  type Repos,
} from '@payclinic/core';
import { SCENARIOS } from '../../../scenarios';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Runtime {
  orchestrator: Orchestrator;
  repos: Repos;
  config: Config;
  bus: EventEmitter;
}

function createProvider(config: Config): AIProvider {
  switch (config.aiProvider) {
    case 'fixture':
      return new FixtureProvider(join(REPO_ROOT, 'fixtures', 'ai'));
    case 'fake':
      return new FakeProvider({});
    case 'gemini':
      if (config.geminiModel === undefined) {
        throw new ConfigError('AI_PROVIDER=gemini requires GEMINI_MODEL');
      }
      return new GeminiProvider({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
      });
  }
}

function createSourceReader(repoRoot: string): (repoRelativePath: string) => string {
  return (repoRelativePath) => {
    const fullPath = resolve(repoRoot, repoRelativePath);
    const rel = relative(repoRoot, fullPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Source path escapes the repository: ${repoRelativePath}`);
    }
    return readFileSync(fullPath, 'utf8');
  };
}

function createReferenceLoader(repoRoot: string): (scenarioKey: ScenarioKey) => PatchOutput | null {
  return (scenarioKey) => {
    const path = join(repoRoot, 'fixtures', 'patches', `${scenarioKey}.json`);
    if (!existsSync(path)) return null;
    return PatchOutput.parse(JSON.parse(readFileSync(path, 'utf8')));
  };
}

/** Builds the live runtime from an environment map: config, database, AI, orchestrator, bus. */
export function buildRuntime(env: Record<string, string | undefined>): Runtime {
  const config = loadConfig(env);
  const dbPath = config.dbPath === ':memory:' ? config.dbPath : resolve(REPO_ROOT, config.dbPath);
  const db = openDb(dbPath);
  const repos = createRepos(db);
  const bus = new EventEmitter();
  const newId = () => randomUUID();
  const readSource = createSourceReader(REPO_ROOT);
  const prescriberDeps: PrescribeDeps = {
    provider: createProvider(config),
    readSource,
    loadReferencePatch: createReferenceLoader(REPO_ROOT),
    deriveDiff: (edits: PatchEdit[]) => derivePatchDiff(edits, readSource),
    newId,
    now: () => new Date().toISOString(),
  };
  const prescriber: Prescriber = (finding, steps) => prescribe(prescriberDeps, finding, steps);

  const orchestrator = createOrchestrator({
    repos,
    config,
    scenarios: SCENARIOS,
    repoRoot: REPO_ROOT,
    storeSourceDir: join(REPO_ROOT, 'apps', 'buggy-store'),
    prescriber,
    newId,
    now: () => new Date(),
    bus,
  });

  return { orchestrator, repos, config, bus };
}
