import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepos, loadConfig, openDb, runDiagnose } from '@payclinic/core';
import { SCENARIOS } from '../scenarios';

async function main(): Promise<void> {
  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  const dbPath = join(rootDir, 'data/smoke.db');
  const db = openDb(dbPath);
  const repos = createRepos(db);
  const config = loadConfig({});
  const traceDir = join(rootDir, 'fixtures/traces');
  mkdirSync(traceDir, { recursive: true });

  try {
    const out = await runDiagnose(
      {
        repos,
        config,
        scenarios: SCENARIOS,
        storeSourceDir: join(rootDir, 'apps/buggy-store'),
        newId: () => randomUUID(),
        now: () => new Date(),
        onScenarioFinished: (key, info) => {
          const tracePath = join(traceDir, `${key}.json`);
          writeFileSync(
            tracePath,
            JSON.stringify(
              {
                scenarioKey: key,
                steps: info.steps,
                state: info.state,
              },
              null,
              2,
            ),
            'utf8',
          );
        },
      },
      {
        target: 'store',
        mode: 'offline',
        scenarios: ['B1', 'B2', 'B4'],
      },
    );

    for (const finding of out.findings) {
      console.log(
        `${finding.scenarioKey} ${finding.invariantKey} ${finding.severity} ${finding.summary}`,
      );
    }
    console.log(`Score: ${out.score.score}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
