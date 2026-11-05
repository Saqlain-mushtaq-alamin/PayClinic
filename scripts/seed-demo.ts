import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PatchOutput,
  type Finding,
  type PatchEdit,
  type Run,
  type ScenarioKey,
} from '@payclinic/contracts';
import { FixtureProvider, prescribe, type PrescribeDeps } from '@payclinic/ai';
import { generatePolicy, GuardedPayTools, serializePolicy } from '@payclinic/firewall';
import {
  AGENT_INTENT,
  ALLOWED_MERCHANTS,
  runAgentScenario,
  ScriptedNaiveBrain,
} from '@payclinic/shopping-agent';
import {
  cleanupTmp,
  computeScore,
  createOrchestrator,
  createRepos,
  derivePatchDiff,
  executeScenarios,
  loadConfig,
  openDb,
  type Prescriber,
  type Protector,
  type ScenarioFn,
} from '@payclinic/core';
import { SCENARIOS } from '../scenarios';

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

export interface SeedDemoOptions {
  repoRoot?: string;
  force?: boolean;
}

/** Returns true if seeding should be skipped because runs already exist and force is not set. */
export function shouldSkipSeed(existingRunsCount: number, force: boolean): boolean {
  return existingRunsCount > 0 && !force;
}

/** Seeds the demo database with three finished runs (store before fix, store after fix, agent protected). */
export async function seedDemo(options: SeedDemoOptions = {}): Promise<void> {
  const repoRoot = options.repoRoot ?? resolve(fileURLToPath(new URL('..', import.meta.url)));

  loadEnvFile(join(repoRoot, '.env'));

  process.env.PAYCLINIC_MODE = 'offline';
  process.env.AI_PROVIDER = process.env.AI_PROVIDER || 'fixture';
  process.env.BUYER_APPROVER = 'sim';
  if (!process.env.PAYPAL_CLIENT_ID) {
    process.env.PAYPAL_CLIENT_ID = 'sim-client-id';
  }
  if (!process.env.PAYPAL_CLIENT_SECRET) {
    process.env.PAYPAL_CLIENT_SECRET = 'sim-client-secret';
  }

  const config = loadConfig(process.env);
  const dbPath = config.dbPath === ':memory:' ? config.dbPath : resolve(repoRoot, config.dbPath);

  const force = options.force ?? process.argv.includes('--force');

  if (!force && existsSync(dbPath)) {
    const existingDb = openDb(dbPath);
    const existingRepos = createRepos(existingDb);
    const runs = existingRepos.listRuns();
    existingDb.close();

    if (shouldSkipSeed(runs.length, force)) {
      process.stdout.write(
        `Database at ${dbPath} already contains ${runs.length} runs. Skipping demo seed (use --force to re-seed).\n`,
      );
      return;
    }
  }

  if (force && existsSync(dbPath)) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-journal`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  cleanupTmp(repoRoot);

  const db = openDb(dbPath);
  const repos = createRepos(db);

  const aiProvider = new FixtureProvider(join(repoRoot, 'fixtures', 'ai'));
  const newId = () => randomUUID();

  const readSource = (repoRelativePath: string): string => {
    const fullPath = resolve(repoRoot, repoRelativePath);
    return readFileSync(fullPath, 'utf8');
  };

  const loadReferencePatch = (scenarioKey: ScenarioKey): PatchOutput | null => {
    const path = join(repoRoot, 'fixtures', 'patches', `${scenarioKey}.json`);
    if (!existsSync(path)) return null;
    return PatchOutput.parse(JSON.parse(readFileSync(path, 'utf8')));
  };

  const prescriberDeps: PrescribeDeps = {
    provider: aiProvider,
    readSource,
    loadReferencePatch,
    deriveDiff: (edits: PatchEdit[]) => derivePatchDiff(edits, readSource),
    newId,
    now: () => new Date().toISOString(),
  };

  const prescriber: Prescriber = (finding, steps) => prescribe(prescriberDeps, finding, steps);

  const protector: Protector = async (run: Run, findings: Finding[]): Promise<void> => {
    const policyResult = await generatePolicy(
      { provider: aiProvider },
      {
        findings,
        intent: AGENT_INTENT,
        allowedMerchants: ALLOWED_MERCHANTS,
      },
    );
    const policy = policyResult.policy;
    const yaml = serializePolicy(policy);
    repos.insertPolicy(run.id, policy, yaml, new Date().toISOString());

    const protectedScenarios: Partial<Record<ScenarioKey, ScenarioFn>> = {
      A1: (ctx) =>
        runAgentScenario(ctx, {
          brain: new ScriptedNaiveBrain({ gullible: true, retries: 0 }),
          wrapTools: (tools, catalog) =>
            new GuardedPayTools(tools, policy, {
              runId: run.id,
              catalog,
              now: () => ctx.now(),
              newId,
              onDecision: (d) => repos.insertDecision(d),
            }),
        }),
      A2: (ctx) =>
        runAgentScenario(ctx, {
          brain: new ScriptedNaiveBrain({ gullible: false, retries: 4, retryOnSuccess: true }),
          wrapTools: (tools, catalog) =>
            new GuardedPayTools(tools, policy, {
              runId: run.id,
              catalog,
              now: () => ctx.now(),
              newId,
              onDecision: (d) => repos.insertDecision(d),
            }),
        }),
    };

    const executed = await executeScenarios(
      {
        config,
        scenarios: protectedScenarios,
        storeSourceDir: join(repoRoot, 'apps/buggy-store'),
        newId,
        now: () => new Date(),
        runId: run.id,
      },
      ['A1', 'A2'],
    );

    for (const finding of findings) {
      const scenarioResult = executed.find((e) => e.key === finding.scenarioKey);
      if (scenarioResult && scenarioResult.results.every((r) => r.passed)) {
        repos.updateFindingState(finding.id, 'protected');
      }
    }

    const updatedFindings = repos.listFindings(run.id);
    const score = computeScore(updatedFindings);
    repos.updateRun(run.id, { scoreAfter: score.score });
  };

  const bus = new EventEmitter();
  const orchestrator = createOrchestrator({
    repos,
    config,
    scenarios: SCENARIOS,
    repoRoot,
    storeSourceDir: join(repoRoot, 'apps/buggy-store'),
    prescriber,
    protector,
    newId,
    now: () => new Date(),
    bus,
  });

  try {
    process.stdout.write('Seeding demo database offline...\n');

    // 1. Store before fix
    process.stdout.write('1/3 Running store diagnosis (before fix)...\n');
    const run1Id = orchestrator.startRun({
      target: 'store',
      mode: 'offline',
      scenarios: ['B1', 'B2', 'B3', 'B4', 'B5'],
    });
    await orchestrator.idle();
    const run1Findings = repos.listFindings(run1Id);
    process.stdout.write(`  Run 1 finished: ${run1Findings.length} findings found (state: open)\n`);

    // 2. Store after fix
    process.stdout.write('2/3 Running store diagnosis and applying fixes (after fix)...\n');
    const run2Id = orchestrator.startRun({
      target: 'store',
      mode: 'offline',
      scenarios: ['B1', 'B2', 'B3', 'B4', 'B5'],
    });
    await orchestrator.idle();
    const run2Findings = repos.listFindings(run2Id);
    for (const finding of run2Findings) {
      await orchestrator.prescribe(finding.id);
    }
    await orchestrator.idle();
    const run2 = repos.getRun(run2Id);
    process.stdout.write(
      `  Run 2 finished: ${run2Findings.length} findings verified (scoreAfter: ${run2?.scoreAfter})\n`,
    );

    // 3. Agent protected
    process.stdout.write('3/3 Running agent diagnosis and spending firewall protection...\n');
    const run3Id = orchestrator.startRun({
      target: 'agent',
      mode: 'offline',
      scenarios: ['A1', 'A2'],
    });
    await orchestrator.idle();
    await orchestrator.protect(run3Id);
    await orchestrator.idle();
    const run3 = repos.getRun(run3Id);
    process.stdout.write(`  Run 3 finished: protected (scoreAfter: ${run3?.scoreAfter})\n`);

    process.stdout.write('Demo seeding completed successfully with 3 finished runs.\n');
  } finally {
    db.close();
    cleanupTmp(repoRoot);
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  seedDemo().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`seed-demo failed: ${message}\n`);
    process.exitCode = 1;
  });
}
