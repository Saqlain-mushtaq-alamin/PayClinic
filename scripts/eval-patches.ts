import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { PatchOutput, type ScenarioKey } from '@payclinic/contracts';
import { createRepos, createVerify, loadConfig, openDb, runDiagnose } from '@payclinic/core';
import {
  evalExitCode,
  formatEvalTable,
  GeminiProvider,
  prescribe,
  RecordingProvider,
  type EvalRow,
} from '@payclinic/ai';
import { SCENARIOS } from '../scenarios';

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;

  if (!apiKey || !model) {
    console.error('Error: GEMINI_API_KEY and GEMINI_MODEL environment variables are required.');
    process.exit(1);
  }

  process.env.AI_RECORD = '1';

  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  const dbDir = join(rootDir, 'data');
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, `eval-${Date.now()}.db`);
  const db = openDb(dbPath);
  const repos = createRepos(db);
  const config = loadConfig({});

  try {
    const scenarioKeys: ScenarioKey[] = ['B1', 'B2', 'B3', 'B4', 'B5'];

    console.log('Running offline diagnose for scenarios B1..B5...');
    const diagnoseResult = await runDiagnose(
      {
        repos,
        config,
        scenarios: SCENARIOS,
        storeSourceDir: join(rootDir, 'apps/buggy-store'),
        newId: () => randomUUID(),
        now: () => new Date(),
      },
      {
        target: 'store',
        mode: 'offline',
        scenarios: scenarioKeys,
      },
    );

    const innerProvider = new GeminiProvider({ apiKey, model });
    const fixturesDir = join(rootDir, 'fixtures/ai');
    mkdirSync(fixturesDir, { recursive: true });
    const provider = new RecordingProvider(innerProvider, fixturesDir);

    const { verify } = createVerify({
      repoRoot: rootDir,
      config,
      scenarios: SCENARIOS,
      newId: () => randomUUID(),
      now: () => new Date(),
    });

    const loadReferencePatch = (key: ScenarioKey): PatchOutput | null => {
      const p = join(rootDir, 'fixtures/patches', `${key}.json`);
      if (!existsSync(p)) return null;
      return PatchOutput.parse(JSON.parse(readFileSync(p, 'utf8')));
    };

    const rows: EvalRow[] = [];

    for (const key of scenarioKeys) {
      const finding = diagnoseResult.findings.find((f) => f.scenarioKey === key);
      if (!finding) {
        rows.push({
          key,
          aiPatchProduced: false,
          verified: false,
          attempts: 0,
          seconds: 0,
          fallbackUsed: false,
        });
        continue;
      }

      const steps = repos.listStepsByIds(finding.evidenceStepIds);
      const t0 = performance.now();

      let aiPatchProduced = false;
      let verified = false;
      let fallbackUsed = false;

      try {
        const result = await prescribe(
          {
            provider,
            readSource: (f) => readFileSync(join(rootDir, f), 'utf8'),
            loadReferencePatch,
            deriveDiff: () => '--- a\n+++ b\n',
            newId: () => randomUUID(),
            now: () => new Date().toISOString(),
          },
          finding,
          steps,
        );

        const aiPatch = result.patches.find((p) => p.source === 'ai');
        aiPatchProduced = Boolean(aiPatch);
        fallbackUsed = result.patches.some((p) => p.source === 'template') && !aiPatch;

        if (aiPatch) {
          // verify ONLY the AI patch (not the fallback)
          const outcome = await verify(finding, aiPatch, {
            mode: 'offline',
            runId: `eval-${key}`,
          });
          verified = outcome.verified;
        }
      } catch (err) {
        console.error(`Evaluation failed for ${key}:`, err instanceof Error ? err.message : err);
      }

      const seconds = Math.round((performance.now() - t0) / 100) / 10;
      rows.push({
        key,
        aiPatchProduced,
        verified,
        attempts: 1,
        seconds,
        fallbackUsed,
      });
    }

    console.log('\n' + formatEvalTable(rows) + '\n');
    process.exit(evalExitCode(rows));
  } finally {
    db.close();
    rmSync(dbPath, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
