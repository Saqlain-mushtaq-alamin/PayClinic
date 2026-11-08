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
  fetchProjectSources,
  prescribe,
  type PrescribeDeps,
} from '@payclinic/ai';
import {
  ConfigError,
  ProjectsRepo,
  SettingsStore,
  createOrchestrator,
  createProjectsRepo,
  createRepos,
  derivePatchDiff,
  loadConfig,
  openDb,
  resolveConfig,
  type Config,
  type Orchestrator,
  type Prescriber,
  type Repos,
} from '@payclinic/core';
import { createProtector, type ProtectorScenario } from '@payclinic/firewall';
import { runAgentScenario, ScriptedNaiveBrain, type AgentBrain } from '@payclinic/shopping-agent';
import { SCENARIOS } from '../../../scenarios';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Re-runs an agent attack with the same brain, optionally behind GuardedPayTools. */
function agentRerun(newBrain: () => AgentBrain): ProtectorScenario {
  return ({ wrapTools }) =>
    (ctx) =>
      runAgentScenario(ctx, {
        brain: newBrain(),
        ...(wrapTools === undefined ? {} : { wrapTools }),
      });
}

/** Same brains as scenarios/a1.ts and scenarios/a2.ts, used for the protection re-run. */
const PROTECTOR_SCENARIOS: Partial<Record<ScenarioKey, ProtectorScenario>> = {
  A1: agentRerun(() => new ScriptedNaiveBrain({ gullible: true, retries: 0 })),
  A2: agentRerun(
    () => new ScriptedNaiveBrain({ gullible: false, retries: 4, retryOnSuccess: true }),
  ),
};

export interface Runtime {
  orchestrator: Orchestrator;
  repos: Repos;
  projectsRepo: ProjectsRepo;
  config: Config;
  bus: EventEmitter;
  settingsStore: SettingsStore;
  getConfig: () => Config;
}

function createProvider(config: Config): AIProvider {
  switch (config.aiProvider) {
    case 'fixture':
      return new FixtureProvider(join(REPO_ROOT, 'fixtures', 'ai'));
    case 'fake':
      return new FakeProvider({});
    case 'gemini':
      if (!config.geminiApiKey || !config.geminiModel) {
        throw new ConfigError('AI_PROVIDER=gemini requires GEMINI_API_KEY and GEMINI_MODEL');
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
  const projectsRepo = createProjectsRepo(db);
  const settingsStore = new SettingsStore(db);
  const getConfig = () => resolveConfig(env, settingsStore);
  const bus = new EventEmitter();
  const newId = () => randomUUID();
  const readSource = createSourceReader(REPO_ROOT);
  const prescriber: Prescriber = async (finding, steps) => {
    const currentConfig = getConfig();
    const run = repos.getRun(finding.runId);
    const projectId = run?.projectId ?? 'builtin';
    const project = projectsRepo.getProject(projectId);
    const isRemote = project?.kind === 'remote';

    const geminiConfigured = Boolean(currentConfig.geminiApiKey && currentConfig.geminiModel);

    if (currentConfig.aiProvider === 'gemini' && !geminiConfigured) {
      if (isRemote) {
        const message = 'Configure Gemini in Settings to get an AI fix';
        return {
          explanation: {
            findingId: finding.id,
            rootCause: message,
            impact: message,
            whereInCode: { file: '', hint: message },
            fixSummary: message,
            model: 'template',
            createdAt: new Date().toISOString(),
          },
          patches: [],
          message,
        };
      }
      throw new ConfigError('AI_PROVIDER=gemini requires GEMINI_API_KEY and GEMINI_MODEL');
    }

    let sourceReader = readSource;
    let sourceFiles: string[] | undefined;

    if (isRemote && project) {
      if (!geminiConfigured) {
        const message = 'Configure Gemini in Settings to get an AI fix';
        return {
          explanation: {
            findingId: finding.id,
            rootCause: message,
            impact: message,
            whereInCode: { file: '', hint: message },
            fixSummary: message,
            model: 'template',
            createdAt: new Date().toISOString(),
          },
          patches: [],
          message,
        };
      }

      const githubToken = settingsStore.get('githubToken') ?? process.env.GITHUB_TOKEN;
      const sourceMap = await fetchProjectSources(project, finding, { token: githubToken });
      sourceReader = (file: string) => {
        const content = sourceMap.get(file);
        if (content === undefined) {
          throw new Error(`File not found in prefetched remote sources: ${file}`);
        }
        return content;
      };
      sourceFiles = Array.from(sourceMap.keys());
    }

    const provider = createProvider(currentConfig);
    const prescriberDeps: PrescribeDeps = {
      provider,
      readSource: sourceReader,
      loadReferencePatch: isRemote ? () => null : createReferenceLoader(REPO_ROOT),
      deriveDiff: (edits: PatchEdit[]) => derivePatchDiff(edits, sourceReader),
      newId,
      now: () => new Date().toISOString(),
      sourceFiles,
      isRemote,
      geminiConfigured,
    };

    return prescribe(prescriberDeps, finding, steps);
  };
  const storeSourceDir = join(REPO_ROOT, 'apps', 'buggy-store');
  const protector = createProtector({
    provider,
    repos,
    config,
    scenarios: PROTECTOR_SCENARIOS,
    storeSourceDir,
    newId,
    now: () => new Date(),
    bus,
  });

  const orchestrator = createOrchestrator({
    repos,
    projectsRepo,
    config,
    getConfig,
    scenarios: SCENARIOS,
    repoRoot: REPO_ROOT,
    storeSourceDir,
    prescriber,
    protector,
    newId,
    now: () => new Date(),
    bus,
  });

  return { orchestrator, repos, projectsRepo, config, bus, settingsStore, getConfig };
}
