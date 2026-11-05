import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Policy, RunEvent, ScenarioKey } from '@payclinic/contracts';
import {
  createOrchestrator,
  createRepos,
  loadConfig,
  openDb,
  ProtectNotApplicableError,
  ProtectNotConfiguredError,
  type Prescriber,
  type Repos,
} from '@payclinic/core';
import { runAgentScenario, ScriptedNaiveBrain, type AgentBrain } from '@payclinic/shopping-agent';
import { SCENARIOS } from '../../scenarios';
import {
  createProtector,
  parsePolicy,
  type GeneratePolicyInput,
  type ProtectorDeps,
  type ProtectorScenario,
} from '@payclinic/firewall';

const repoRoot = join(__dirname, '../..');
const storeSourceDir = join(repoRoot, 'apps/buggy-store');
const iso = '2026-10-18T10:00:00.000Z';
let n = 0;
const newId = () => `p${++n}`;
const now = () => new Date(iso);

const throwingProvider = {
  name: 'fake',
  generateJSON: async () => {
    throw new Error('No AI provider in the offline protector test');
  },
};

/** Builds an A1/A2 re-run factory that runs the original brain with wrapTools applied. */
const agentScenario =
  (newBrain: () => AgentBrain): ProtectorScenario =>
  ({ wrapTools }) =>
  (ctx) =>
    runAgentScenario(ctx, {
      brain: newBrain(),
      ...(wrapTools === undefined ? {} : { wrapTools }),
    });

/** Same brains as scenarios/a1.ts and scenarios/a2.ts (the original attack scenarios). */
const PROT_SCENARIOS: Partial<Record<ScenarioKey, ProtectorScenario>> = {
  A1: agentScenario(() => new ScriptedNaiveBrain({ gullible: true, retries: 0 })),
  A2: agentScenario(
    () => new ScriptedNaiveBrain({ gullible: false, retries: 4, retryOnSuccess: true }),
  ),
};

const neverPrescriber: Prescriber = async () => {
  throw new Error('prescribe is not called by the protector suite');
};

interface SetupResult {
  repos: Repos;
  events: RunEvent[];
  startAgentRun(): Promise<string>;
  protect(runId: string): Promise<void>;
  protectWithoutProtector(runId: string): Promise<void>;
}

function setup(policyFor?: ProtectorDeps['policyFor']): SetupResult {
  const repos = createRepos(openDb(':memory:'));
  const bus = new EventEmitter();
  const events: RunEvent[] = [];
  bus.on('event', (event: RunEvent) => events.push(event));

  const protectorDeps: ProtectorDeps = {
    provider: throwingProvider,
    repos,
    config: loadConfig({}),
    scenarios: PROT_SCENARIOS,
    storeSourceDir,
    newId,
    now,
    bus,
    ...(policyFor === undefined ? {} : { policyFor }),
  };

  const withProtector = createOrchestrator({
    repos,
    config: loadConfig({}),
    scenarios: SCENARIOS,
    repoRoot,
    storeSourceDir,
    prescriber: neverPrescriber,
    protector: createProtector(protectorDeps),
    newId,
    now,
    bus,
  });
  const withoutProtector = createOrchestrator({
    repos,
    config: loadConfig({}),
    scenarios: SCENARIOS,
    repoRoot,
    storeSourceDir,
    prescriber: neverPrescriber,
    newId,
    now,
    bus,
  });

  return {
    repos,
    events,
    startAgentRun: async () => {
      const runId = withProtector.startRun({
        target: 'agent',
        mode: 'offline',
        scenarios: ['A1', 'A2'],
      });
      await withProtector.idle();
      return runId;
    },
    protect: (runId) => withProtector.protect(runId),
    protectWithoutProtector: (runId) => withoutProtector.protect(runId),
  };
}

const weakPolicy: Policy = {
  version: 1,
  currency: 'USD',
  perTransactionCap: '999.00',
  sessionBudget: '999.00',
  merchantAllowlist: ['demo-store', 'sketchy-deals'],
  duplicateWindowSec: 600,
};
const weakPolicyFor = async (_input: GeneratePolicyInput): Promise<Policy> => weakPolicy;

describe('protector (offline end to end)', () => {
  it('diagnoses both agent attacks into four open findings with score 78', async () => {
    const t = setup();
    const runId = await t.startAgentRun();

    const run = t.repos.getRun(runId)!;
    expect(run.target).toBe('agent');
    expect(run.scenarioKeys).toEqual(['A1', 'A2']);
    expect(run.scoreBefore).toBe(78);

    const findings = t.repos.listFindings(runId);
    expect(
      findings.map((finding) => `${finding.scenarioKey}:${finding.invariantKey}`).sort(),
    ).toEqual(['A1:I-07', 'A1:I-08', 'A2:I-07', 'A2:I-09']);
    expect(findings.every((finding) => finding.state === 'open')).toBe(true);
  }, 240_000);

  it('protects all four findings via the template policy and proves score 100', async () => {
    const t = setup();
    const runId = await t.startAgentRun();
    await t.protect(runId);

    // The invariants decide: every finding was proven blocked on the re-run.
    const findings = t.repos.listFindings(runId);
    expect(
      findings.map((finding) => `${finding.scenarioKey}:${finding.invariantKey}:${finding.state}`),
    ).toEqual(['A1:I-07:protected', 'A1:I-08:protected', 'A2:I-07:protected', 'A2:I-09:protected']);

    const run = t.repos.getRun(runId)!;
    expect(run.scoreAfter).toBe(100);

    // Decisions: A1 is stopped by R3 (sketchy-deals), A2 by the budget/duplicate rules.
    const decisions = t.repos.listDecisions(runId);
    const a1Block = decisions.find(
      (decision) => decision.request.merchantId === 'sketchy-deals' && decision.action === 'block',
    );
    expect(a1Block?.ruleId).toBe('R3');
    const a2Blocks = decisions.filter(
      (decision) => decision.request.merchantId === 'demo-store' && decision.action === 'block',
    );
    expect(a2Blocks.length).toBeGreaterThan(0);
    expect(a2Blocks.every((decision) => decision.ruleId === 'R2' || decision.ruleId === 'R5')).toBe(
      true,
    );
    for (const decision of decisions) {
      expect(decision.runId).toBe(runId);
      expect(decision.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }

    // The policy row exists and its YAML round-trips back to the stored policy.
    const stored = t.repos.getLatestPolicy(runId);
    expect(stored).not.toBeNull();
    expect(parsePolicy(stored!.yaml)).toStrictEqual(stored!.policy);
    for (const [field, value] of [
      ['perTransactionCap', '30.00'],
      ['sessionBudget', '40.00'],
      ['merchantAllowlist', ['demo-store']],
      ['duplicateWindowSec', 600],
    ] as const) {
      expect(stored!.policy[field]).toStrictEqual(value);
    }

    // Events: one decision.recorded per stored decision, finding.updated then score.updated.
    const recorded = t.events.filter((event) => event.type === 'decision.recorded');
    expect(recorded.map((event) => event.decision.id)).toHaveLength(decisions.length);
    const updated = t.events.filter((event) => event.type === 'finding.updated');
    expect(updated.map((event) => event.finding.state)).toEqual([
      'protected',
      'protected',
      'protected',
      'protected',
    ]);
    const scores = t.events.filter((event) => event.type === 'score.updated');
    expect(scores.at(-1)?.score.score).toBe(100);
  }, 240_000);

  it('does not mark A1 findings protected when the policy is deliberately weak', async () => {
    const t = setup(weakPolicyFor);
    const runId = await t.startAgentRun();
    await t.protect(runId);

    // sketchy-deals is allowed and 99.00 stays under the weak caps, so the
    // invariants (against the user intent, not the policy) still fail.
    const a1 = t.repos.listFindings(runId).filter((finding) => finding.scenarioKey === 'A1');
    expect(a1.map((finding) => finding.state)).toEqual(['open', 'open']);
    for (const finding of a1) {
      expect(finding.summary).toContain('(still failing after protection: I-07, I-08)');
      expect(finding.summary.split('(still failing after protection:')).toHaveLength(2);
    }
    // A2 is genuinely stopped by the weak policy (R5 duplicate) and proven protected.
    const a2 = t.repos.listFindings(runId).filter((finding) => finding.scenarioKey === 'A2');
    expect(a2.map((finding) => finding.state)).toEqual(['protected', 'protected']);
    const scoreAfter = t.repos.getRun(runId)!.scoreAfter;
    expect(scoreAfter).toBeLessThan(100);
  }, 240_000);

  it('rejects protect on a store run and without a configured protector', async () => {
    const t = setup();

    const storeRunId = 'store-run';
    t.repos.insertRun({
      id: storeRunId,
      target: 'store',
      mode: 'offline',
      scenarioKeys: ['B2'],
      status: 'completed',
      startedAt: iso,
    });
    await expect(t.protect(storeRunId)).rejects.toThrow(ProtectNotApplicableError);

    t.repos.insertRun({
      id: 'agent-run',
      target: 'agent',
      mode: 'offline',
      scenarioKeys: ['A1', 'A2'],
      status: 'completed',
      startedAt: iso,
    });
    await expect(t.protectWithoutProtector('agent-run')).rejects.toThrow(ProtectNotConfiguredError);
  }, 120_000);
});
