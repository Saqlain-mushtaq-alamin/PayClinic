import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScenarioKey } from '@payclinic/contracts';
import { assertSafePayPalBase, executeScenarios, loadConfig } from '@payclinic/core';
import { SCENARIOS } from '../scenarios';

const MERCHANT_SCENARIOS: ScenarioKey[] = ['B1', 'B2', 'B3', 'B4', 'B5'];

async function main(): Promise<void> {
  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  const config = loadConfig(process.env);

  if (config.mode !== 'online') {
    throw new Error('record:online requires PAYCLINIC_MODE=online');
  }
  if (!config.paypalBaseUrl) {
    throw new Error('record:online requires PAYPAL_BASE_URL');
  }
  assertSafePayPalBase(config.paypalBaseUrl);

  const traceDir = join(rootDir, 'fixtures/traces-online');
  mkdirSync(traceDir, { recursive: true });

  const executed = await executeScenarios(
    {
      config,
      scenarios: SCENARIOS,
      storeSourceDir: join(rootDir, 'apps/buggy-store'),
      newId: () => randomUUID(),
      now: () => new Date(),
      runId: randomUUID(),
      onScenario: (key, info) => {
        writeFileSync(
          join(traceDir, `${key}.json`),
          `${JSON.stringify({ scenarioKey: key, steps: info.steps, state: info.state }, null, 2)}\n`,
          'utf8',
        );

        const debugIds = [
          ...new Set(
            info.steps.flatMap((step) => (step.paypalDebugId ? [step.paypalDebugId] : [])),
          ),
        ];
        console.log(`${key} ${info.status} (${info.steps.length} steps)`);
        if (debugIds.length === 0) {
          console.log('  No PayPal debug ids captured');
        } else {
          for (const debugId of debugIds) console.log(`  PayPal debug id: ${debugId}`);
        }
      },
    },
    MERCHANT_SCENARIOS,
  );

  console.log(`Recorded ${executed.length}/${MERCHANT_SCENARIOS.length} scenarios in ${traceDir}`);
  const withFindings = executed.filter((scenario) => scenario.status !== 'passed');
  if (withFindings.length > 0) {
    console.log(
      `Scenarios with findings: ${withFindings.map((scenario) => scenario.key).join(', ')}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
