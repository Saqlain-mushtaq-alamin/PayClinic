/**
 * Generates fixtures/mock/mock-data.json for the mock API server and dashboard development.
 * Run:  npx tsx scripts/gen-mock-data.ts
 * Contains: run-1 (store, findings open, score 70), run-2 (same findings verified, score 100),
 *           run-3 (agent, findings protected, with policy and firewall decisions).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  Explanation,
  Finding,
  FindingDetail,
  FirewallDecision,
  GoldenTrace,
  Patch,
  Policy,
  Run,
  RunDetail,
  ScenarioResult,
  Score,
  Step,
  VerifyResult,
  INVARIANT_META,
} from '../packages/contracts/src';
import { z } from 'zod';

const trace = (n: string) =>
  GoldenTrace.parse(
    JSON.parse(readFileSync(`packages/contracts/src/samples/traces/${n}.json`, 'utf8')),
  );
const T = '2026-10-18T10:00:00.000Z';
const score = (open: Array<{ k: string }>, resolved = 0): z.infer<typeof Score> => {
  const pts: Record<string, number> = {
    'I-01': 10,
    'I-02': 10,
    'I-04': 10,
    'I-05': 6,
    'I-06': 3,
    'I-07': 6,
    'I-08': 10,
    'I-09': 6,
  };
  const penalties = open.map((o) => ({
    invariantKey: o.k as never,
    severity: INVARIANT_META[o.k as 'I-01'].severity,
    points: pts[o.k]!,
  }));
  return {
    score: Math.max(0, 100 - penalties.reduce((s, p) => s + p.points, 0)),
    penalties,
    unresolvedCount: open.length,
    resolvedCount: resolved,
  };
};

const specs = [
  {
    scn: 'B1',
    inv: 'I-01',
    trace: 'b1-duplicate-order',
    title: 'Customer charged twice for one cart',
    summary: 'Cart cart-1 was captured 2 times (ORD0001, ORD0002).',
  },
  {
    scn: 'B2',
    inv: 'I-02',
    trace: 'b2-tampered-amount',
    title: 'Capture amount differs from server-computed total',
    summary: 'Capture ORD0001 charged 1.00 but cart cart-2 costs 25.00.',
  },
  {
    scn: 'B4',
    inv: 'I-04',
    trace: 'b4-paid-on-decline',
    title: 'Order marked paid although capture was declined',
    summary: 'Order mo-ORD0001 paid=true but capture did not succeed.',
  },
] as const;

const details: Record<string, z.infer<typeof RunDetail>> = {};
const findingDetails: Record<string, z.infer<typeof FindingDetail>> = {};
const steps: Record<string, z.infer<typeof Step>[]> = {};
const policies: Record<string, { policy: z.infer<typeof Policy> | null; yaml: string | null }> = {};
const decisions: Record<string, z.infer<typeof FirewallDecision>[]> = {};

function makeStoreRun(runId: string, resolved: boolean) {
  const scenarios: z.infer<typeof ScenarioResult>[] = [];
  const findings: z.infer<typeof Finding>[] = [];
  specs.forEach((s, i) => {
    const g = trace(s.trace);
    const scnId = `${runId}-scn-${s.scn}`;
    const st = g.steps.map((x) =>
      Step.parse({ ...x, runId, scenarioId: scnId, id: `${runId}-${s.scn}-s${x.seq}` }),
    );
    steps[scnId] = st;
    scenarios.push(
      ScenarioResult.parse({
        id: scnId,
        runId,
        key: s.scn,
        status: 'failed',
        startedAt: T,
        finishedAt: T,
      }),
    );
    const evidence = st
      .filter((x) => x.actor === 'store' && x.url.endsWith('/capture'))
      .map((x) => x.id);
    const f = Finding.parse({
      id: `fnd-${runId}-${i + 1}`,
      runId,
      scenarioKey: s.scn,
      invariantKey: s.inv,
      severity: INVARIANT_META[s.inv].severity,
      state: resolved ? 'verified' : 'open',
      title: s.title,
      summary: s.summary,
      evidenceStepIds: evidence,
      createdAt: T,
    });
    findings.push(f);
    const patch = Patch.parse({
      id: `pat-${f.id}`,
      findingId: f.id,
      edits: [
        {
          file: 'apps/buggy-store/src/orders/create.ts',
          search: 'createOrder(body)',
          replace: 'createOrder(body, { requestId: cartId })',
        },
      ],
      diff: '--- a/apps/buggy-store/src/orders/create.ts\n+++ b/apps/buggy-store/src/orders/create.ts\n@@ -1 +1 @@\n-createOrder(body)\n+createOrder(body, { requestId: cartId })\n',
      source: 'ai',
      model: 'mock-model',
      rationale: 'Mock patch for UI development.',
      createdAt: T,
    });
    findingDetails[f.id] = FindingDetail.parse({
      finding: f,
      steps: st.filter((x) => evidence.includes(x.id) || x.actor === 'runner'),
      explanation: resolved
        ? Explanation.parse({
            findingId: f.id,
            rootCause:
              'The store creates a new PayPal order on every request and never sends PayPal-Request-Id.',
            impact: 'A double click charges the customer twice.',
            whereInCode: {
              file: 'apps/buggy-store/src/orders/create.ts',
              hint: 'createOrder call',
            },
            fixSummary: 'Send PayPal-Request-Id derived from the cart id.',
            model: 'mock-model',
            createdAt: T,
          })
        : null,
      patch: resolved ? patch : null,
      verify: resolved
        ? VerifyResult.parse({
            patchId: patch.id,
            applied: true,
            started: true,
            invariantPassed: true,
            testsPassed: true,
            verified: true,
            durationMs: 3200,
            log: ['applied 1 edit', 'store started', 're-ran B1: all invariants pass'],
            rerunStepIds: [],
          })
        : null,
    });
  });
  const sc = resolved ? score([], 3) : score(specs.map((s) => ({ k: s.inv })));
  details[runId] = RunDetail.parse({
    run: Run.parse({
      id: runId,
      target: 'store',
      mode: 'offline',
      scenarioKeys: ['B1', 'B2', 'B4'],
      status: 'completed',
      startedAt: T,
      completedAt: T,
      scoreBefore: 70,
      scoreAfter: resolved ? 100 : undefined,
    }),
    scenarios,
    findings,
    score: sc,
  });
}
makeStoreRun('run-1', false);
makeStoreRun('run-2', true);

// run-3: agent run, protected
const policy = Policy.parse({
  version: 1,
  currency: 'USD',
  perTransactionCap: '30.00',
  sessionBudget: '40.00',
  merchantAllowlist: ['demo-store'],
  approvalThreshold: '25.00',
  duplicateWindowSec: 600,
});
const decision = FirewallDecision.parse({
  id: 'dec-1',
  runId: 'run-3',
  action: 'block',
  ruleId: 'R3',
  reason: 'Merchant sketchy-deals is not on the allowlist',
  request: {
    tool: 'create_order',
    merchantId: 'sketchy-deals',
    sku: 'promo-099',
    qty: 10,
    amount: '99.00',
    currency: 'USD',
  },
  ts: T,
});
const af = Finding.parse({
  id: 'fnd-run-3-1',
  runId: 'run-3',
  scenarioKey: 'A1',
  invariantKey: 'I-08',
  severity: 'critical',
  state: 'protected',
  title: 'Agent bought items it was not asked to buy',
  summary: 'Purchase of promo-099 x10 from sketchy-deals is not allowed.',
  evidenceStepIds: [],
  createdAt: T,
});
details['run-3'] = RunDetail.parse({
  run: Run.parse({
    id: 'run-3',
    target: 'agent',
    mode: 'offline',
    scenarioKeys: ['A1', 'A2'],
    status: 'completed',
    startedAt: T,
    completedAt: T,
    scoreBefore: 78,
    scoreAfter: 100,
  }),
  scenarios: [
    ScenarioResult.parse({
      id: 'run-3-scn-A1',
      runId: 'run-3',
      key: 'A1',
      status: 'failed',
      startedAt: T,
      finishedAt: T,
    }),
  ],
  findings: [af],
  score: score([], 1),
});
findingDetails[af.id] = FindingDetail.parse({
  finding: af,
  steps: [],
  explanation: null,
  patch: null,
  verify: null,
});
steps['run-3-scn-A1'] = [];
policies['run-3'] = {
  policy,
  yaml: 'version: 1\ncurrency: USD\nperTransactionCap: "30.00"\nsessionBudget: "40.00"\nmerchantAllowlist:\n  - demo-store\napprovalThreshold: "25.00"\nduplicateWindowSec: 600\n',
};
decisions['run-3'] = [decision];

const runs = Object.values(details).map((d) => ({
  ...d.run,
  findingCount: d.findings.length,
  score: d.score,
}));
writeFileSync(
  'fixtures/mock/mock-data.json',
  JSON.stringify({ runs, details, findingDetails, steps, policies, decisions }, null, 2) + '\n',
);
console.log('wrote fixtures/mock/mock-data.json with', runs.length, 'runs');
