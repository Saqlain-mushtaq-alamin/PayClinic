import type { EventEmitter } from 'node:events';
import type {
  AIProvider,
  Finding,
  FirewallDecision,
  InvariantResult,
  Policy,
  Product,
  Run,
  RunEvent,
  ScenarioKey,
  ScenarioStatus,
} from '@payclinic/contracts';
import type { PayTools } from '@payclinic/shopping-agent';
import { AGENT_INTENT, ALLOWED_MERCHANTS } from '@payclinic/shopping-agent';
import type { Config, Protector, Repos, ScenarioFn } from '@payclinic/core';
import { executeScenarios } from '@payclinic/core';
import { GuardedPayTools } from './guarded';
import { generatePolicy, type GeneratePolicyInput } from './generate';
import { serializePolicy } from './yaml';

/** Wraps the store PayTools so the re-run goes through the firewall. */
export type WrapTools = (tools: PayTools, catalog: Product[]) => PayTools;

/**
 * A protector scenario factory: builds the re-run scenario with the guarded tools applied,
 * keeping the original brain of the attack scenario.
 */
export type ProtectorScenario = (options: { wrapTools?: WrapTools }) => ScenarioFn;

export interface ProtectorDeps {
  provider: AIProvider;
  repos: Repos;
  config: Config;
  /** Re-run factories for the agent scenario keys (A1/A2 with their original brains). */
  scenarios: Partial<Record<ScenarioKey, ProtectorScenario>>;
  storeSourceDir: string;
  newId: () => string;
  now: () => Date;
  bus: EventEmitter;
  /** Test-only override for generatePolicy (lets a test inject a deliberately weak policy). */
  policyFor?: (input: GeneratePolicyInput) => Promise<Policy>;
}

const STILL_FAILING_MARK = ' (still failing after protection: ';

interface RerunOutcome {
  status: ScenarioStatus;
  results: InvariantResult[];
}

/**
 * Creates the Protector: generates a policy from the findings, proves it by re-running
 * the attacks behind GuardedPayTools, records every decision, and marks findings
 * protected only when the re-run's invariants all pass. Escalations are auto-denied.
 */
export function createProtector(deps: ProtectorDeps): Protector {
  const emit = (event: RunEvent): void => {
    deps.bus.emit('event', event);
  };

  const persistDecision = (decision: FirewallDecision): void => {
    deps.repos.insertDecision(decision);
    emit({ type: 'decision.recorded', decision });
  };

  return async function protect(run: Run, findings: Finding[]): Promise<void> {
    // 1. Policy from the findings (AI with a deterministic template fallback, or a test override).
    const input: GeneratePolicyInput = {
      findings,
      intent: AGENT_INTENT,
      allowedMerchants: ALLOWED_MERCHANTS,
    };
    const policy = deps.policyFor
      ? await deps.policyFor(input)
      : (await generatePolicy({ provider: deps.provider }, input)).policy;
    deps.repos.insertPolicy(run.id, policy, serializePolicy(policy), deps.now().toISOString());

    // 2. Re-run the same scenario keys with tools wrapped by GuardedPayTools(policy).
    const rerunScenarios: Partial<Record<ScenarioKey, ScenarioFn>> = {};
    for (const key of run.scenarioKeys) {
      const factory = deps.scenarios[key];
      if (!factory) {
        throw new Error(`No protector re-run scenario registered for ${key}`);
      }
      rerunScenarios[key] = factory({
        wrapTools: (tools, catalog) =>
          new GuardedPayTools(tools, policy, {
            runId: run.id,
            catalog,
            // The guard reads the injectable clock, the same time the scenario ctx gets.
            now: () => deps.now().getTime(),
            newId: deps.newId,
            onDecision: persistDecision,
          }),
      });
    }

    const outcomes = new Map<ScenarioKey, RerunOutcome>();
    await executeScenarios(
      {
        config: { ...deps.config, mode: run.mode },
        scenarios: rerunScenarios,
        storeSourceDir: deps.storeSourceDir,
        newId: deps.newId,
        now: deps.now,
        runId: run.id,
        onScenario: (key, info) => {
          outcomes.set(key, { status: info.status, results: info.results });
        },
      },
      [...run.scenarioKeys],
    );

    // 4. Finding states come from the re-run invariants, never from the policy.
    for (const finding of findings) {
      const outcome = outcomes.get(finding.scenarioKey);
      if (outcome?.status === 'passed') {
        deps.repos.updateFindingState(finding.id, 'protected');
        continue;
      }

      const failing = (outcome?.results ?? [])
        .filter((result) => !result.passed)
        .map((result) => result.key);
      const why = failing.length > 0 ? failing.join(', ') : finding.invariantKey;
      if (!finding.summary.includes(STILL_FAILING_MARK)) {
        deps.repos.updateFindingSummary(
          finding.id,
          `${finding.summary}${STILL_FAILING_MARK}${why})`,
        );
      }
    }
  };
}
