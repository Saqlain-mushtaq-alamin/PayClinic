import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  Finding,
  Patch,
  PatchEdit,
  ScenarioKey,
  Step,
  VerifyResult,
} from '@payclinic/contracts';
import type { VerifyFn, VerifyOptions } from '@payclinic/contracts';
import type { Config } from '../config';
import { executeScenarios } from '../runner/diagnose';
import { startStore } from '../runner/store-process';
import type { ScenarioFn } from '../runner/context';
import { applyEditsToDir } from './apply';
import { checkEditsSafety } from './safety';

const TEST_TIMEOUT_MS = 60_000;
const PREFLIGHT_PAYPAL_URL = 'http://127.0.0.1:1';

export interface WithPatchedStoreDeps {
  repoRoot: string;
  newId: () => string;
}

function shouldCopy(source: string): boolean {
  const name = basename(source);
  return name !== 'node_modules' && !name.includes('.db');
}

/** Copies the store, applies safe edits, runs work against the copy, and removes it. */
export async function withPatchedStore<T>(
  deps: WithPatchedStoreDeps,
  edits: PatchEdit[],
  fn: (storeDir: string) => Promise<T>,
  opts: { maxEdits?: number } = {},
): Promise<T | { applyError: string }> {
  const safety = checkEditsSafety(edits, opts);
  if (!safety.ok) return { applyError: safety.reason };

  const id = deps.newId().replace(/[^a-zA-Z0-9_-]/g, '-');
  const baseDir = join(deps.repoRoot, '.payclinic-tmp', `verify-${id}`);
  const storeDir = join(baseDir, 'buggy-store');

  try {
    mkdirSync(baseDir, { recursive: true });
    cpSync(join(deps.repoRoot, 'apps', 'buggy-store'), storeDir, {
      recursive: true,
      filter: shouldCopy,
    });

    const applied = applyEditsToDir(storeDir, edits);
    if (!applied.ok) return { applyError: applied.reason };

    return await fn(storeDir);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? process.env.Path ?? '',
    PORT: '0',
    PAYPAL_BASE_URL: PREFLIGHT_PAYPAL_URL,
    PAYPAL_CLIENT_ID: 'id',
    PAYPAL_CLIENT_SECRET: 'secret',
    STORE_DB_PATH: ':memory:',
    STORE_ADMIN: '1',
  };
  for (const name of [
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'ComSpec',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
  ]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function runCommand(args: string[], cwd: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: childEnv(),
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    let settled = false;
    const settle = (passed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(passed);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(false);
    }, TEST_TIMEOUT_MS);
    child.once('error', () => settle(false));
    child.once('exit', (code) => settle(code === 0));
  });
}

async function runRegressionTest(
  repoRoot: string,
  storeDir: string,
  testFile: { path: string; content: string },
): Promise<boolean> {
  const testsDir = join(storeDir, 'tests');
  mkdirSync(testsDir, { recursive: true });
  writeFileSync(join(testsDir, testFile.path), testFile.content, 'utf8');
  writeFileSync(
    join(storeDir, 'vitest.config.ts'),
    "export default { test: { include: ['tests/**/*.test.ts'] } };\n",
    'utf8',
  );
  return runCommand(
    [join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', storeDir],
    storeDir,
  );
}

export interface CreateVerifyDeps {
  repoRoot: string;
  config: Config;
  scenarios: Partial<Record<ScenarioKey, ScenarioFn>>;
  newId: () => string;
  now: () => Date;
  scenarioTimeoutMs?: number;
}

export interface VerifyDetailedOptions extends VerifyOptions {
  maxEdits?: number;
}

export interface VerifyDetailedResult {
  result: VerifyResult;
  steps: Step[];
}

/** Creates the verifier that re-runs one scenario against a patched temp copy. */
export function createVerify(deps: CreateVerifyDeps): {
  verify: VerifyFn;
  verifyDetailed(
    finding: Finding,
    patch: Patch,
    opts: VerifyDetailedOptions,
  ): Promise<VerifyDetailedResult>;
} {
  const verifyDetailed = async (
    finding: Finding,
    patch: Patch,
    opts: VerifyDetailedOptions,
  ): Promise<VerifyDetailedResult> => {
    const startedAt = deps.now().getTime();
    const log: string[] = [];
    let applied = false;
    let started = false;
    let invariantPassed = false;
    let testsPassed: boolean | null = null;
    let steps: Step[] = [];

    const finish = (): VerifyResult => ({
      patchId: patch.id,
      applied,
      started,
      invariantPassed,
      testsPassed,
      verified: applied && started && invariantPassed && testsPassed !== false,
      durationMs: Math.max(0, deps.now().getTime() - startedAt),
      log,
      rerunStepIds: steps.map((step) => step.id),
    });

    const safety = checkEditsSafety(patch.edits, { maxEdits: opts.maxEdits });
    if (!safety.ok) {
      log.push(`Safety check failed: ${safety.reason}`);
      return { result: finish(), steps };
    }
    log.push('Safety checks passed');

    let outcome: { done: true } | { applyError: string } | undefined;
    try {
      outcome = await withPatchedStore(
        deps,
        patch.edits,
        async (storeDir) => {
          log.push(`Copied store to ${storeDir}`);
          applied = true;
          log.push(`Applied ${patch.edits.length} edit(s)`);

          try {
            const probe = await startStore({
              sourceDir: storeDir,
              paypalBaseUrl: PREFLIGHT_PAYPAL_URL,
              paypalClientId: deps.config.paypalClientId,
              paypalClientSecret: deps.config.paypalClientSecret,
            });
            await probe.stop();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.push(`Store failed to start: ${message}`);
            return { done: true as const };
          }

          started = true;
          log.push('Store started from the patched copy');

          try {
            const executed = await executeScenarios(
              {
                config: { ...deps.config, mode: opts.mode },
                scenarios: deps.scenarios,
                storeSourceDir: storeDir,
                newId: deps.newId,
                now: deps.now,
                ...(deps.scenarioTimeoutMs === undefined
                  ? {}
                  : { scenarioTimeoutMs: deps.scenarioTimeoutMs }),
                runId: opts.runId,
              },
              [finding.scenarioKey],
            );
            const scenario = executed[0];
            steps = scenario?.steps ?? [];
            invariantPassed =
              scenario !== undefined &&
              scenario.status !== 'error' &&
              scenario.results.every((result) => result.passed);
            log.push(
              `Scenario ${finding.scenarioKey} ${invariantPassed ? 'passed' : 'failed'}`,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.push(`Scenario ${finding.scenarioKey} could not run: ${message}`);
          }

          if (patch.testFile) {
            testsPassed = await runRegressionTest(deps.repoRoot, storeDir, patch.testFile);
            log.push(`Regression test ${testsPassed ? 'passed' : 'failed'}`);
          }

          return { done: true as const };
        },
        { maxEdits: opts.maxEdits },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.push(`Verification failed: ${message}`);
      return { result: finish(), steps };
    }

    if (outcome !== undefined && 'applyError' in outcome) {
      applied = false;
      started = false;
      invariantPassed = false;
      testsPassed = null;
      log.push(`Apply failed: ${outcome.applyError}`);
    }

    const result = finish();
    log.push(
      result.verified
        ? 'Verification passed'
        : `Verification failed (applied=${String(applied)}, started=${String(started)}, ` +
            `invariantPassed=${String(invariantPassed)}, testsPassed=${String(testsPassed)})`,
    );
    return { result: finish(), steps };
  };

  const verify: VerifyFn = async (finding, patch, opts) =>
    (await verifyDetailed(finding, patch, opts)).result;

  return { verify, verifyDetailed };
}
