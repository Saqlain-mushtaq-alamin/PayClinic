# Phase 2: The merchant loop and the MVP (Sat Oct 24 to Fri Oct 30)

**Goal:** Diagnose → Prescribe → Verify works end to end for all five merchant bugs, through the real REST API and the dashboard, **online-or-offline**, with the Payment Safety Score going from **61** (five merchant bugs open: critical×3 + high + medium = 10+10+10+6+3 = 39 points off) to **100**. The agent attacks exist as scenarios.
**Exit criteria (IC2, target Wed Oct 28, hard Fri Oct 30):**

1. `npm run check` green; CI green.
2. All five reference patches verify (`tests/patches`), and all five together make every merchant invariant pass.
3. `POST /api/runs` (B1..B5) → findings I-01, I-02, I-04, I-05, I-06 → `POST /api/findings/:id/prescribe` → every finding `verified` → score 100, **offline, with no API keys**.
4. The same shared API contract suite passes against the mock server **and** the real server.
5. The dashboard shows a run, a finding with timeline, explanation and diff, and the Prescribe button with live progress, against the real API.
6. A human records a rough screen capture of the MVP as insurance (P2-X01).

> Score arithmetic used everywhere: merchant-only run with B1..B5 failing = findings I-01(10) + I-02(10) + I-04(10) + I-05(6) + I-06(3) = 39 penalty → **61**. With B1, B2, B4 only (Phase 1) = **70**.

**New dependencies:** A: `diff` (and `@types/diff` if your version needs it), `yaml` is Track B's. B: none new. C: none new (SSE via `EventSource`).

**Suggested order, Track A:** A01 → A02 → A03 → A04 → A05 → A06 → A07 → A08. **Track B:** B01 → B05 → B04 → B03 → B02 → B06. **Track C:** C01 → C02 → C03 → C04.

---

# Track A: Engine

### P2-A01 · Scenario B3, webhook chaos, invariant I-05 ⏱ 2h Track A

**Depends on:** P1-A09 · **Blocks:** P2-A04

**Goal:** webhook replay and forged-webhook coverage.

**Read:** TECH_DESIGN §5 (B3 row), §6 (I-05).

**Files:** create `scenarios/b3.ts`, `packages/core/src/invariants/webhooks.ts`, `tests/invariants/webhooks.test.ts`, `tests/runner/b3.test.ts`; edit `scenarios/index.ts` and `packages/core/src/invariants/index.ts` (register I-05).

**Spec:**

```ts
// scenarios/b3.ts
import type { Cart } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';

export const b3: ScenarioFn = async (ctx) => {
  const cart: Cart = {
    id: 'cart-b3',
    items: [{ sku: 'mug-003', qty: 1 }],
    currency: 'USD',
    expectedTotal: '12.00',
  };
  ctx.declareCart(cart);
  const co = await ctx.checkout({ cartId: cart.id, items: cart.items });
  if (co.orderId) {
    await ctx.approve(co.orderId);
    await ctx.capture(co.orderId);
  }
  const event = (id: string) => ({
    id,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { id: 'CAP0001', custom_id: cart.id },
  });
  const deliver = (deliveryId: string, eventId: string, sig: string) =>
    ctx.http.request('POST', '/webhooks/paypal', event(eventId), {
      label: `Webhook delivery ${deliveryId}`,
      headers: { 'x-payclinic-delivery-id': deliveryId, 'paypal-transmission-sig': sig },
    });
  await deliver('d-1', 'WH-EVT-1', 'SIM-VALID-SIGNATURE');
  await deliver('d-2', 'WH-EVT-1', 'SIM-VALID-SIGNATURE'); // replay of the same event
  ctx.declareForgedDelivery('d-forged');
  await deliver('d-forged', 'WH-EVT-2', 'FORGED');
};
```

I-05 per TECH_DESIGN §6: fail if a forged delivery has `applied > 0` (`Forged delivery <id> was applied`), or the sum of `applied` over **non-forged** deliveries of one `eventId` is greater than 1 (`Webhook event <id> applied <n> times`). Severity from `INVARIANT_META`; no evidence steps.

**Tests (write first):**

```ts
// tests/invariants/webhooks.test.ts
import { describe, expect, it } from 'vitest';
import { buildState } from '@payclinic/contracts/testing';
import { INVARIANTS } from '@payclinic/core';

const d = (deliveryId: string, eventId: string, applied: number) => ({
  deliveryId,
  eventId,
  eventType: 'PAYMENT.CAPTURE.COMPLETED',
  applied,
});
const run = (webhookDeliveries: any[], forgedDeliveryIds: string[] = []) =>
  INVARIANTS['I-05']!({ trace: [], state: buildState({ webhookDeliveries, forgedDeliveryIds }) });

describe('I-05', () => {
  it('passes when each event is applied once and the forged delivery is not', () => {
    expect(run([d('d-1', 'E1', 1), d('d-2', 'E1', 0), d('d-f', 'E2', 0)], ['d-f']).passed).toBe(
      true,
    );
  });
  it('fails when a replayed event is applied twice', () => {
    const r = run([d('d-1', 'E1', 1), d('d-2', 'E1', 1)]);
    expect(r).toMatchObject({ passed: false, severity: 'high' });
    expect(r.message).toBe('Webhook event E1 applied 2 times');
  });
  it('fails when a forged delivery is applied', () => {
    const r = run([d('d-f', 'E2', 1)], ['d-f']);
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Forged delivery d-f was applied');
  });
  it('ignores forged deliveries when summing per event', () => {
    expect(run([d('d-1', 'E1', 1), d('d-f', 'E1', 0)], ['d-f']).passed).toBe(true);
  });
  it('passes with no deliveries', () => expect(run([]).passed).toBe(true));
});
```

```ts
// tests/runner/b3.test.ts
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createRepos, loadConfig, openDb, runDiagnose } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repo = join(__dirname, '../..');
let n = 0;

it('B3 produces exactly one I-05 finding and three webhook deliveries', async () => {
  const repos = createRepos(openDb(':memory:'));
  const out = await runDiagnose(
    {
      repos,
      config: loadConfig({}),
      scenarios: SCENARIOS,
      storeSourceDir: join(repo, 'apps/buggy-store'),
      newId: () => `id${++n}`,
      now: () => new Date('2026-10-18T10:00:00Z'),
    },
    { target: 'store', mode: 'offline', scenarios: ['B3'] },
  );
  expect(out.findings.map((f) => `${f.scenarioKey}:${f.invariantKey}:${f.severity}`)).toEqual([
    'B3:I-05:high',
  ]);
  const hooks = repos
    .listSteps(out.runId)
    .filter((s) => s.actor === 'runner' && s.url.endsWith('/webhooks/paypal'));
  expect(hooks).toHaveLength(3);
}, 60_000);
```

**Done when:** `npx vitest run tests/invariants/webhooks.test.ts tests/runner/b3.test.ts` green; check green. Commit: `feat(core): scenario B3 and invariant I-05`.

---

### P2-A02 · Scenario B5, invariants I-06 and I-03, optional B6 ⏱ 2h Track A

**Depends on:** P2-A01 · **Blocks:** P2-A04

**Goal:** zero-decimal currency coverage, amount validity, and refund accounting.

**Read:** TECH_DESIGN §5 (B5), §6 (I-03, I-06), `money.ts`.

**Files:** create `scenarios/b5.ts`, `scenarios/b6.ts` (optional, see below), `packages/core/src/invariants/amounts.ts`, `tests/invariants/amounts.test.ts`, `tests/runner/b5.test.ts`; edit `scenarios/index.ts`, `invariants/index.ts`; for B6 only: complete `apps/buggy-store/src/orders/refund.ts`, persist the capture id in `apps/buggy-store/src/db.ts` and `apps/buggy-store/src/orders/finalize.ts`, keep its route registration, plus `tests/store/refund.test.ts`.

**Spec:**

```ts
// scenarios/b5.ts
import type { Cart } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';

export const b5: ScenarioFn = async (ctx) => {
  const cart: Cart = {
    id: 'cart-b5',
    items: [{ sku: 'jp-pen-01', qty: 2 }],
    currency: 'JPY',
    expectedTotal: '2400',
  };
  ctx.declareCart(cart);
  const co = await ctx.checkout({ cartId: cart.id, items: cart.items });
  if (co.orderId) {
    await ctx.approve(co.orderId);
    await ctx.capture(co.orderId);
  }
};
```

- **I-06**: examine every step with `actor: 'store'` and a `requestBody` that has `purchase_units[*].amount` or a top-level `amount`; each must have `currency_code` matching `^[A-Z]{3}$` and a `value` for which `isValidAmountString(value, currency)` is true (unknown currencies fail). Message `Amount "<v>" is invalid for <cur>`; evidence = that step; severity medium. Several bad amounts → one result citing all steps, message of the first.
- **I-03**: fail if any merchant order has `toMinor(refundedTotal) > toMinor(capturedTotal)` (message `Order <id> refunded <r> of <c>`). If a value cannot be parsed the invariant fails with `Order <id> has unparseable money`.
- **B6 (optional, Could):** implement `refund.ts` (`POST /api/orders/:orderId/refund {amount}`): finds the capture id from the stored capture, calls `paypal.refund`, then **always** adds the amount to `refunded_total` **even if PayPal rejected it** (`// BUG B6: refunded total is increased without checking the PayPal result`). Scenario `b6`: checkout/approve/capture 25.00 then refund 20.00 twice. Expected failing invariant: I-03. Skip B6 entirely if you are behind; nothing else depends on it.

**Tests (write first):**

```ts
// tests/invariants/amounts.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildMerchantOrder,
  buildState,
  paypalCreateStep,
  buildStep,
} from '@payclinic/contracts/testing';
import { INVARIANTS } from '@payclinic/core';

const i06 = (trace: any[]) => INVARIANTS['I-06']!({ trace, state: buildState() });
const i03 = (merchantOrders: any[]) =>
  INVARIANTS['I-03']!({ trace: [], state: buildState({ merchantOrders }) });

describe('I-06', () => {
  it('passes for valid USD and JPY amounts', () => {
    expect(
      i06([
        paypalCreateStep({ orderId: 'O1', cartId: 'c', amount: '25.00' }),
        paypalCreateStep({ orderId: 'O2', cartId: 'c', amount: '2400', currency: 'JPY' }),
      ]).passed,
    ).toBe(true);
  });
  it('fails for JPY with decimals and cites the step', () => {
    const s = paypalCreateStep({
      orderId: 'O1',
      cartId: 'c',
      amount: '2400.00',
      currency: 'JPY',
      status: 422,
      body: {},
    });
    const r = i06([s]);
    expect(r).toMatchObject({ passed: false, severity: 'medium', evidenceStepIds: [s.id] });
    expect(r.message).toBe('Amount "2400.00" is invalid for JPY');
  });
  it('fails for float drift', () => {
    expect(
      i06([paypalCreateStep({ orderId: 'O1', cartId: 'c', amount: '0.30000000000000004' })]).passed,
    ).toBe(false);
  });
  it('checks refund bodies too and ignores runner steps', () => {
    const refund = buildStep({
      actor: 'store',
      method: 'POST',
      url: 'http://x/v2/payments/captures/C1/refund',
      requestBody: { amount: { value: '10.005', currency_code: 'USD' } },
    });
    const runner = buildStep({
      actor: 'runner',
      method: 'POST',
      url: 'http://x/api/orders',
      requestBody: { amount: { value: 'abc', currency_code: 'USD' } },
    });
    expect(i06([refund]).passed).toBe(false);
    expect(i06([runner]).passed).toBe(true);
  });
  it('fails for a malformed currency code', () => {
    expect(
      i06([paypalCreateStep({ orderId: 'O1', cartId: 'c', amount: '1.00', currency: 'usd' })])
        .passed,
    ).toBe(false);
  });
});

describe('I-03', () => {
  it('passes when refunds are within the captured amount', () => {
    expect(
      i03([buildMerchantOrder({ capturedTotal: '25.00', refundedTotal: '25.00' })]).passed,
    ).toBe(true);
  });
  it('fails when refunds exceed the capture', () => {
    const r = i03([buildMerchantOrder({ capturedTotal: '25.00', refundedTotal: '40.00' })]);
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Order mo-1 refunded 40.00 of 25.00');
  });
});
```

```ts
// tests/runner/b5.test.ts
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createRepos, loadConfig, openDb, runDiagnose } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repo = join(__dirname, '../..');
let n = 0;

it('B5 produces one I-06 finding whose evidence is the rejected JPY create request', async () => {
  const repos = createRepos(openDb(':memory:'));
  const out = await runDiagnose(
    {
      repos,
      config: loadConfig({}),
      scenarios: SCENARIOS,
      storeSourceDir: join(repo, 'apps/buggy-store'),
      newId: () => `id${++n}`,
      now: () => new Date('2026-10-18T10:00:00Z'),
    },
    { target: 'store', mode: 'offline', scenarios: ['B5'] },
  );
  expect(out.findings.map((f) => `${f.scenarioKey}:${f.invariantKey}:${f.severity}`)).toEqual([
    'B5:I-06:medium',
  ]);
  const [evidence] = repos.listStepsByIds(out.findings[0]!.evidenceStepIds);
  expect(evidence).toMatchObject({ actor: 'store', method: 'POST', responseStatus: 422 });
  expect(JSON.stringify(evidence!.requestBody)).toContain('2400.00');
}, 60_000);
```

**Done when:** `npx vitest run tests/invariants/amounts.test.ts tests/runner/b5.test.ts` green; check green. Commit: `feat(core): scenario B5, invariants I-06 and I-03`.

---

### P2-A03 · Verify loop `[HARD]` ⏱ 4h Track A

**Depends on:** P1-A07, P1-A04, P2-A01, P2-A02 · **Blocks:** P2-A04, P2-A05

**Goal:** prove a patch fixes the bug by applying it to a temporary copy of the store and re-running the scenario.

**Read:** TECH_DESIGN §8 (**every step and safety rule**), §5, §1. `packages/contracts/src/types.ts` (`PatchEdit`, `Patch`, `VerifyResult`).

**Files:** create `packages/core/src/verify/safety.ts`, `verify/apply.ts`, `verify/diff.ts`, `verify/verify.ts`, `tests/verify/safety.test.ts`, `tests/verify/verify.test.ts`; **edit** `packages/core/src/runner/diagnose.ts` only to extract a reusable `executeScenarios` (see below) without changing its behavior; export from `src/index.ts`. `npm install diff` (add `@types/diff` if needed).

**Spec:**

- Refactor: extract from `runDiagnose` a function `executeScenarios(env: { config; scenarios; storeSourceDir; newId; now; scenarioTimeoutMs?; runId; onScenario?: (...) => void }, keys: ScenarioKey[]): Promise<Array<{ key: ScenarioKey; scenarioId: string; status: ScenarioStatus; error?: string; steps: Step[]; state: RunState; results: InvariantResult[] }>>` that starts PayPal target, proxy and store, runs the scenarios, **does not touch the database**, and stops everything in `finally`. `runDiagnose` becomes: create run row, call `executeScenarios`, persist. **All Phase 1 tests must still pass unchanged.**
- `safety.ts`: `checkEditsSafety(edits: PatchEdit[], opts?: { maxEdits?: number }): { ok: true } | { ok: false; reason: string }` implementing TECH_DESIGN §8 step 2: at most `maxEdits` (default 5); each `file` normalizes (`path.posix.normalize`) to a path that still starts with `apps/buggy-store/src/` and contains no `..` segment; each `replace` ≤ 4000 chars; **denylist** on `replace`: `child_process`, `eval(`, `new Function`, `process.env`, `require(`, `import(`, `fs.`, `writeFile`, and any literal `http://` or `https://`.
- `apply.ts`: `applyEditsToDir(storeDir: string, edits: PatchEdit[]): { ok: true } | { ok: false; reason: string }`: `storeDir` is the copied `buggy-store` directory; map `apps/buggy-store/<rest>` → `<storeDir>/<rest>`; read the file; require `search` to occur **exactly once** (report which edit and whether 0 or >1 matches); replace; write. Edits are applied in order; any failure leaves the temp copy discarded by the caller (no rollback needed).
- `diff.ts`: `derivePatchDiff(edits: PatchEdit[], readFile: (repoRelativePath: string) => string): string` using `createTwoFilesPatch` from `diff` per file (after applying all edits for that file), headers `a/<path>` / `b/<path>`. Pure.
- `verify.ts`: `withPatchedStore<T>(deps: { repoRoot: string; newId: () => string }, edits: PatchEdit[], fn: (storeDir: string) => Promise<T>, opts?: { maxEdits?: number }): Promise<T | { applyError: string }>`: creates `<repoRoot>/.payclinic-tmp/verify-<id>/buggy-store` (copy of `apps/buggy-store` excluding `node_modules`, `*.db*`), runs safety + apply, calls `fn(storeDir)`, always deletes the temp directory in `finally`.
- `createVerify(deps: { repoRoot; config; scenarios; newId; now; scenarioTimeoutMs? }): { verify: VerifyFn; verifyDetailed(finding, patch, opts): Promise<{ result: VerifyResult; steps: Step[] }> }` implementing the 8 steps of TECH_DESIGN §8 exactly: safety → copy → apply → start store from the copy (`startStore` with `sourceDir` = the copy; if it fails to start → `started:false`) → `executeScenarios` for **only** the finding's scenario → `invariantPassed` = every invariant of that scenario passed → optional `testFile` run with vitest (60 s) → `verified`. `log` has one human-readable line per step. `durationMs` measured with `deps.now`.
- The repository working tree (`apps/buggy-store`) must be byte-for-byte unchanged after any verification.

**Tests (write first):**

```ts
// tests/verify/safety.test.ts
import { describe, expect, it } from 'vitest';
import { checkEditsSafety } from '@payclinic/core';

const edit = (over: Partial<{ file: string; search: string; replace: string }> = {}) => ({
  file: 'apps/buggy-store/src/orders/pricing.ts',
  search: 'a',
  replace: 'b',
  ...over,
});

describe('checkEditsSafety', () => {
  it('accepts a normal edit', () => expect(checkEditsSafety([edit()]).ok).toBe(true));
  it('rejects more than 5 edits by default and honors maxEdits', () => {
    const many = Array.from({ length: 6 }, () => edit());
    expect(checkEditsSafety(many).ok).toBe(false);
    expect(checkEditsSafety(many, { maxEdits: 10 }).ok).toBe(true);
  });
  it.each([
    'apps/buggy-store/src/../../package.json',
    'apps/buggy-store/src/../package.json',
    'apps/buggy-store/src/orders/../../../x.ts',
  ])('rejects path traversal %s', (file) =>
    expect(checkEditsSafety([edit({ file })]).ok).toBe(false),
  );
  it.each([
    'process.env.X',
    "require('fs')",
    'eval(x)',
    'new Function("x")',
    'import("x")',
    'child_process',
    'fs.readFileSync',
    'writeFile',
    'https://evil.example',
    'http://evil.example',
  ])('rejects replace text %s', (replace) =>
    expect(checkEditsSafety([edit({ replace })]).ok).toBe(false),
  );
  it('rejects a replace over 4000 characters', () =>
    expect(checkEditsSafety([edit({ replace: 'x'.repeat(4001) })]).ok).toBe(false));
});
```

```ts
// tests/verify/verify.test.ts
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVerify, loadConfig } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repoRoot = join(__dirname, '../..');
let n = 0;
const { verify } = createVerify({
  repoRoot,
  config: loadConfig({}),
  scenarios: SCENARIOS,
  newId: () => `v${++n}`,
  now: () => new Date(),
});
const finding = {
  id: 'f1',
  runId: 'r1',
  scenarioKey: 'B2',
  invariantKey: 'I-02',
  severity: 'critical',
  state: 'open',
  title: 't',
  summary: 's',
  evidenceStepIds: [],
  createdAt: '2026-10-18T10:00:00.000Z',
} as const;
const patch = (edits: any[], extra: object = {}) => ({
  id: 'p1',
  findingId: 'f1',
  edits,
  diff: '',
  source: 'ai' as const,
  createdAt: '2026-10-18T10:00:00.000Z',
  ...extra,
});
const file = 'apps/buggy-store/src/orders/pricing.ts';
const fix = { file, search: 'return clientTotal ?? serverTotal;', replace: 'return serverTotal;' };
const opts = { mode: 'offline' as const, runId: 'r1' };

function hashDir(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) =>
    readdirSync(d)
      .sort()
      .forEach((f) => {
        if (f === 'node_modules') return;
        const p = join(d, f);
        statSync(p).isDirectory() ? walk(p) : h.update(p).update(readFileSync(p));
      });
  walk(dir);
  return h.digest('hex');
}

describe('verifyPatch', () => {
  it('verifies a correct fix for B2', async () => {
    const r = await verify(finding, patch([fix]), opts);
    expect(r).toMatchObject({
      applied: true,
      started: true,
      invariantPassed: true,
      testsPassed: null,
      verified: true,
    });
    expect(r.log.length).toBeGreaterThanOrEqual(4);
  }, 90_000);

  it('does not verify an edit that applies but does not fix the bug', async () => {
    const r = await verify(
      finding,
      patch([{ ...fix, replace: 'return clientTotal ?? serverTotal; // changed' }]),
      opts,
    );
    expect(r).toMatchObject({
      applied: true,
      started: true,
      invariantPassed: false,
      verified: false,
    });
  }, 90_000);

  it('reports applied:false when the search text is not found', async () => {
    const r = await verify(finding, patch([{ ...fix, search: 'this text does not exist' }]), opts);
    expect(r).toMatchObject({ applied: false, started: false, verified: false });
    expect(r.log.join('\n')).toMatch(/not found|0 matches/i);
  }, 60_000);

  it('reports applied:false when the search text matches more than once', async () => {
    const r = await verify(finding, patch([{ ...fix, search: 'e' }]), opts);
    expect(r.applied).toBe(false);
    expect(r.log.join('\n')).toMatch(/more than once|matches/i);
  }, 60_000);

  it('rejects unsafe edits before touching anything', async () => {
    const r = await verify(
      finding,
      patch([{ ...fix, replace: 'return process.env.SECRET;' }]),
      opts,
    );
    expect(r).toMatchObject({ applied: false, verified: false });
  }, 60_000);

  it('reports started:false (quickly) when the patched store cannot boot', async () => {
    const t0 = Date.now();
    const r = await verify(finding, patch([{ ...fix, replace: 'return clientTotal ?? ;' }]), opts);
    expect(r).toMatchObject({ applied: true, started: false, verified: false });
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);

  it('leaves the repository store untouched and removes the temp directory', async () => {
    const before = hashDir(join(repoRoot, 'apps/buggy-store'));
    await verify(finding, patch([fix]), opts);
    expect(hashDir(join(repoRoot, 'apps/buggy-store'))).toBe(before);
    const tmp = join(repoRoot, '.payclinic-tmp');
    expect(existsSync(tmp) ? readdirSync(tmp).filter((x) => x.startsWith('verify-')) : []).toEqual(
      [],
    );
  }, 90_000);

  it('runs a provided regression test and marks testsPassed', async () => {
    const testFile = {
      path: 'b2.regression.test.ts',
      content:
        "import { it, expect } from 'vitest';\nimport { resolveAmount } from '../src/orders/pricing';\nit('ignores the client total', () => { expect(resolveAmount('25.00', '1.00')).toBe('25.00'); });\n",
    };
    const r = await verify(finding, patch([fix], { testFile }), opts);
    expect(r.testsPassed).toBe(true);
    expect(r.verified).toBe(true);
  }, 120_000);

  it('fails verification when the regression test fails', async () => {
    const testFile = {
      path: 'b2.bad.test.ts',
      content: "import { it, expect } from 'vitest';\nit('fails', () => { expect(1).toBe(2); });\n",
    };
    const r = await verify(finding, patch([fix], { testFile }), opts);
    expect(r).toMatchObject({ invariantPassed: true, testsPassed: false, verified: false });
  }, 120_000);
});
```

**Done when:** `npx vitest run tests/verify` green (allow several minutes); `npm run check` green; `git status` shows no changes under `apps/buggy-store`; no `.payclinic-tmp/verify-*` directories remain. Commit: `feat(core): verify loop with safety checks and temp-copy re-run`.

**Pitfalls:** the temp copy lives **inside** the repo on purpose so Node resolves `node_modules` upward; kill the store child before deleting the directory; the child env is minimal (TECH_DESIGN §8); keep `executeScenarios` free of DB writes so verification never pollutes the findings.

---

### P2-A04 · Reference patches B1 to B5 and the CI proof `[HARD]` ⏱ 3h Track A

**Depends on:** P2-A03 · **Blocks:** P2-A05, P2-B01, P2-B02

**Goal:** known-good fixes for every planted bug, proven by the verify loop, used as the fallback and as the test oracle.

**Read:** TECH_DESIGN §2.2 (bug table with the fix for each), §8 (reference patches), the real source of the five bug files.

**Files:** create `fixtures/patches/B1.json`, `B2.json`, `B3.json`, `B4.json`, `B5.json`, `tests/patches/reference-patches.test.ts`. **Do not modify** `apps/buggy-store` (the repo store stays buggy forever).

**Spec:** each file is JSON matching `PatchOutput` (`{ "edits": PatchEdit[], "rationale": string }`). Every `search` must be copied **character for character** from the real source file and match exactly once.

- **B1:** edit `orders/create.ts`: `paypal.createOrder(body)` → `paypal.createOrder(body, { requestId: cartId })` (keep the rest of the line).
- **B2:** edit `orders/pricing.ts`: `return clientTotal ?? serverTotal;` → `return serverTotal;`.
- **B3:** edit `webhooks.ts`: verify the signature through `deps.paypal.verifyWebhook(headers, event)` (on failure `recordDelivery(... applied: 0)` and respond `400 {error:'invalid signature'}`); skip duplicates with `deps.db.hasLedgerEvent(event.id)` (`recordDelivery(... applied: 0)` and respond `200`); otherwise credit once and `recordDelivery(... applied: 1)`.
- **B4:** edit `orders/finalize.ts` (three edits): remove the early `db.markPaid(...)` line; call `db.markFailedIfUnpaid(merchantOrderId)` before returning `{ ok: false }`; call `db.markPaid(merchantOrderId)` immediately before `db.recordCapture(...)`.
- **B5:** edit `money.ts`: `formatAmount` uses the exponent of the currency (`JPY`, `HUF`, `TWD` → 0 digits; everything else 2) instead of always `toFixed(2)`; define the map inline inside the function so the whole change is one edit.

**Tests (write first):**

```ts
// tests/patches/reference-patches.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PatchOutput, SCENARIO_META, type ScenarioKey } from '@payclinic/contracts';
import { createVerify, executeScenarios, loadConfig, withPatchedStore } from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repoRoot = join(__dirname, '../..');
let n = 0;
const deps = {
  repoRoot,
  config: loadConfig({}),
  scenarios: SCENARIOS,
  newId: () => `t${++n}`,
  now: () => new Date(),
};
const { verify } = createVerify(deps);
const keys = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
const load = (k: string) =>
  PatchOutput.parse(
    JSON.parse(readFileSync(join(repoRoot, 'fixtures/patches', `${k}.json`), 'utf8')),
  );

describe('reference patches', () => {
  for (const key of keys) {
    it(`${key}: verifies through the verify loop`, async () => {
      const ref = load(key);
      const finding = {
        id: `f-${key}`,
        runId: 'r',
        scenarioKey: key as ScenarioKey,
        invariantKey: SCENARIO_META[key].invariantKeys[0]!,
        severity: 'critical',
        state: 'open',
        title: key,
        summary: key,
        evidenceStepIds: [],
        createdAt: '2026-10-18T10:00:00.000Z',
      } as const;
      const r = await verify(
        finding,
        {
          id: `p-${key}`,
          findingId: finding.id,
          edits: ref.edits,
          diff: '',
          source: 'template',
          createdAt: finding.createdAt,
        },
        { mode: 'offline', runId: 'r' },
      );
      expect(r.log.join('\n')).not.toMatch(/not found/);
      expect(r).toMatchObject({
        applied: true,
        started: true,
        invariantPassed: true,
        verified: true,
      });
    }, 120_000);
  }

  it('all five together make every merchant scenario pass', async () => {
    const edits = keys.flatMap((k) => load(k).edits);
    const out = await withPatchedStore(
      deps,
      edits,
      async (storeDir) =>
        executeScenarios({ ...deps, storeSourceDir: storeDir, runId: 'all' }, [...keys]),
      { maxEdits: 20 },
    );
    expect('applyError' in out ? out.applyError : '').toBe('');
    const rows = out as Awaited<ReturnType<typeof executeScenarios>>;
    for (const row of rows)
      expect(
        row.results.filter((r) => !r.passed),
        `${row.key} still failing`,
      ).toEqual([]);
  }, 240_000);
});
```

**Done when:** `npx vitest run tests/patches` green; `git diff --stat apps/` shows nothing; check green. Commit: `feat(fixtures): reference patches for B1-B5 proven by the verify loop`.

---

### P2-A05 · Orchestrator: diagnose, prescribe, score ⏱ 3h Track A

**Depends on:** P2-A03, P2-A04 · **Blocks:** P2-A06, P2-A07, P3-B01

**Goal:** one object that runs the whole loop and emits events.

**Read:** TECH_DESIGN §12, §13; `events.ts`, `api.ts`.

**Files:** create `packages/core/src/orchestrator/orchestrator.ts`, `orchestrator/types.ts`, `tests/orchestrator/orchestrator.test.ts`; edit `runner/diagnose.ts` only so that an existing run row (status `queued`) is **updated** instead of inserted; export from `src/index.ts`.

**Spec:**

```ts
export type Prescriber = (
  finding: Finding,
  steps: Step[],
) => Promise<{ explanation: Explanation; patches: Patch[] }>; // patches in order of preference
export type Protector = (run: Run, findings: Finding[]) => Promise<void>; // implemented in P3-B01; optional dependency

export interface OrchestratorDeps {
  repos: Repos;
  config: Config;
  scenarios: Partial<Record<ScenarioKey, ScenarioFn>>;
  repoRoot: string;
  storeSourceDir: string;
  prescriber: Prescriber;
  protector?: Protector;
  newId: () => string;
  now: () => Date;
  bus: EventEmitter; // emits RunEvent on channel "event"
}
export interface Orchestrator {
  startRun(req: RunCreateRequest): string; // inserts a queued run, returns its id immediately, runs async (one run at a time, FIFO)
  prescribe(findingId: string): Promise<void>;
  protect(runId: string): Promise<void>;
  idle(): Promise<void>; // resolves when the queue is empty (used by tests and the CLI)
}
export function createOrchestrator(deps: OrchestratorDeps): Orchestrator;
```

`prescribe(findingId)` (TECH_DESIGN §12): emit `prescribe.progress` with stages `explaining` → `patching` → `verifying` → `done` (or `failed`). Load the finding and its evidence steps; call `deps.prescriber`; store the explanation; then try the patches **in order**: store the patch, run `verifyDetailed`, store the verify result; stop at the first `verified`. On success set the finding `verified`; if every patch fails set `unverified` and emit `failed` with the last log line. After each change recompute the run's `scoreAfter` with `computeScore` over the run's findings and update the run; emit `finding.updated` and `score.updated`. Persist the verify re-run steps under a scenario row with id `<scenarioId>-verify-<patchId>` and key = the finding's scenario so `rerunStepIds` resolve.

`protect(runId)`: if the run is not `target: 'agent'` throw `ProtectNotApplicableError`; if `deps.protector` is missing throw `ProtectNotConfiguredError`; otherwise call it. (The real protector arrives in P3-B01; these two typed errors are the complete behavior until then.)

**Tests (write first):** with a temp `:memory:` DB and a **test Prescriber** built from the real reference patch `fixtures/patches/B2.json`:

```ts
// tests/orchestrator/orchestrator.test.ts
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PatchOutput,
  type Explanation,
  type Finding,
  type Patch,
  type RunEvent,
} from '@payclinic/contracts';
import {
  createOrchestrator,
  createRepos,
  loadConfig,
  openDb,
  ProtectNotApplicableError,
  type Prescriber,
} from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const repoRoot = join(__dirname, '../..');
const ref = PatchOutput.parse(
  JSON.parse(readFileSync(join(repoRoot, 'fixtures/patches/B2.json'), 'utf8')),
);
const iso = '2026-10-18T10:00:00.000Z';
let n = 0;
const newId = () => `o${++n}`;
const patchFor = (
  f: Finding,
  edits = ref.edits,
  source: 'ai' | 'template' = 'template',
): Patch => ({
  id: newId(),
  findingId: f.id,
  edits,
  diff: '--- a\n+++ b\n',
  source,
  createdAt: iso,
});
const explanationFor = (f: Finding): Explanation => ({
  findingId: f.id,
  rootCause: 'cause',
  impact: 'impact',
  whereInCode: { file: ref.edits[0]!.file, hint: 'h' },
  fixSummary: 'fix',
  model: 'test',
  createdAt: iso,
});
const badEdits = [{ ...ref.edits[0]!, replace: 'return clientTotal ?? serverTotal; // noop' }];
const good: Prescriber = async (f) => ({ explanation: explanationFor(f), patches: [patchFor(f)] });

function setup(prescriber: Prescriber) {
  const repos = createRepos(openDb(':memory:'));
  const bus = new EventEmitter();
  const events: RunEvent[] = [];
  bus.on('event', (e: RunEvent) => events.push(e));
  const orch = createOrchestrator({
    repos,
    config: loadConfig({}),
    scenarios: SCENARIOS,
    repoRoot,
    storeSourceDir: join(repoRoot, 'apps/buggy-store'),
    prescriber,
    newId,
    now: () => new Date(iso),
    bus,
  });
  return { repos, orch, events };
}
const startB2 = async (t: ReturnType<typeof setup>) => {
  const runId = t.orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
  await t.orch.idle();
  return { runId, finding: t.repos.listFindings(runId)[0]! };
};

describe('orchestrator', () => {
  it('startRun returns a queued run immediately and completes with one open I-02 finding', async () => {
    const t = setup(good);
    const runId = t.orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
    expect(t.repos.getRun(runId)!.status).toMatch(/queued|running/);
    await t.orch.idle();
    expect(t.repos.getRun(runId)!.status).toBe('completed');
    expect(t.repos.listFindings(runId).map((f) => `${f.invariantKey}:${f.state}`)).toEqual([
      'I-02:open',
    ]);
  }, 120_000);

  it('prescribe verifies the finding, raises the score to 100 and emits the stages in order', async () => {
    const t = setup(good);
    const { runId, finding } = await startB2(t);
    await t.orch.prescribe(finding.id);
    const stages = t.events
      .filter(
        (e): e is Extract<RunEvent, { type: 'prescribe.progress' }> =>
          e.type === 'prescribe.progress',
      )
      .map((e) => e.stage);
    expect(stages).toEqual(['explaining', 'patching', 'verifying', 'done']);
    expect(t.repos.getFinding(finding.id)!.state).toBe('verified');
    const patch = t.repos.getPatchForFinding(finding.id)!;
    expect(t.repos.getVerifyForPatch(patch.id)).toMatchObject({ verified: true });
    expect(t.repos.getRun(runId)!.scoreAfter).toBe(100);
  }, 180_000);

  it('tries the next patch when the first does not verify', async () => {
    const second = { id: '' } as { id: string };
    const t = setup(async (f) => {
      const bad = patchFor(f, badEdits, 'ai');
      const ok = patchFor(f);
      second.id = ok.id;
      return { explanation: explanationFor(f), patches: [bad, ok] };
    });
    const { finding } = await startB2(t);
    await t.orch.prescribe(finding.id);
    expect(t.repos.getFinding(finding.id)!.state).toBe('verified');
    expect(t.repos.getPatchForFinding(finding.id)!.id).toBe(second.id);
  }, 240_000);

  it('marks the finding unverified and emits failed when no patch verifies', async () => {
    const t = setup(async (f) => ({
      explanation: explanationFor(f),
      patches: [patchFor(f, badEdits, 'ai')],
    }));
    const { finding } = await startB2(t);
    await t.orch.prescribe(finding.id);
    expect(t.repos.getFinding(finding.id)!.state).toBe('unverified');
    const last = [...t.events].reverse().find((e) => e.type === 'prescribe.progress');
    expect(last).toMatchObject({ stage: 'failed' });
  }, 180_000);

  it('runs queued runs one at a time, in order', async () => {
    const t = setup(good);
    t.orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
    t.orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
    await t.orch.idle();
    expect(
      t.events
        .filter((e) => e.type === 'run.started' || e.type === 'run.completed')
        .map((e) => e.type),
    ).toEqual(['run.started', 'run.completed', 'run.started', 'run.completed']);
  }, 240_000);

  it('protect rejects with ProtectNotApplicableError for a store run', async () => {
    const t = setup(good);
    const { runId } = await startB2(t);
    await expect(t.orch.protect(runId)).rejects.toThrow(ProtectNotApplicableError);
  }, 120_000);
});
```

**Done when:** `npx vitest run tests/orchestrator` green; check green. Commit: `feat(core): orchestrator with prescribe and verify`.

---

### P2-A06 · REST API and SSE, plus the shared contract suite ⏱ 3.5h Track A

**Depends on:** P2-A05 · **Blocks:** P2-C01, P2-X01

**Goal:** the real server implementing `packages/contracts/src/api.ts`, plus one **contract test suite that runs against both the mock and the real server**.

**Read:** `api.ts`, `events.ts`, TECH_DESIGN §13.

**Files:** create `packages/cli/package.json` (name `@payclinic/cli`, deps `@payclinic/core`, `@payclinic/contracts`, `fastify`), `packages/cli/src/api.ts`, `packages/cli/src/wire.ts`, `tests/contract/api-contract.ts`, `tests/contract/real.contract.test.ts`, `tests/contract/mock.contract.test.ts`.

**Spec:**

- `createApi(deps: { orchestrator; repos; config; bus; version?: string }): FastifyInstance`: every route in the table at the top of `api.ts`; every response validated with the contract schema before sending; errors are `{ error: string; code?: string }` with correct status (`400` invalid body via zod, `404` unknown run/finding, `409` for `ProtectNotApplicable`/`ProtectNotConfigured` with codes `protect_not_applicable` / `protect_not_configured`). `POST /api/findings/:id/open-pr` returns `200 { prUrl: null, reason: 'GitHub is not configured' }` until P3-C03 supplies an `openPr` dependency (optional dependency; when present it is called). CORS: allow `http://localhost:5173` and `http://127.0.0.1:5173`.
- SSE `GET /api/runs/:id/events`: `text/event-stream`; live events for that run from `bus`; **replay for runs that already finished or already have data**: build `run.started`, per scenario `scenario.started`/`scenario.finished`, `finding.created` for each finding, `score.updated`, and `run.completed` from the database, then stay open. Send `:keepalive` every 15 s. Unsubscribe on close.
- `wire.ts`: `buildRuntime(env)` creates config, db, repos, provider (by `AI_PROVIDER`), orchestrator and returns `{ orchestrator, repos, config, bus }`. In this card the prescriber is built by importing `prescribe` from `@payclinic/ai` (P2-B01); until B01 merges, use the card's test prescriber **only inside tests**, and have `wire.ts` depend on B01. (If B01 is not merged, start P2-A06 with the contract suite and the mock test and finish the real wiring afterwards.)
- The **shared suite** `tests/contract/api-contract.ts` exports `describeApiContract(name, start)`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FindingDetail,
  Health,
  RunCreateResponse,
  RunDetail,
  RunEvent,
  RunSummary,
  ScenarioInfo,
} from '@payclinic/contracts';

type Server = { baseUrl: string; close(): Promise<void> };

async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  ms = 90_000,
  every = 300,
): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, every));
  }
}

export function describeApiContract(name: string, start: () => Promise<Server>) {
  describe(`API contract: ${name}`, () => {
    let srv: Server;
    beforeAll(async () => {
      srv = await start();
    }, 60_000);
    afterAll(async () => {
      await srv.close();
    });
    const get = (p: string) => fetch(srv.baseUrl + p);
    const post = (p: string, body?: unknown) =>
      fetch(srv.baseUrl + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });

    it('GET /api/health', async () => {
      Health.parse(await (await get('/api/health')).json());
    });
    it('GET /api/scenarios lists B1..B5 with titles', async () => {
      const list = ScenarioInfo.array().parse(await (await get('/api/scenarios')).json());
      expect(list.map((s) => s.key)).toEqual(
        expect.arrayContaining(['B1', 'B2', 'B3', 'B4', 'B5']),
      );
    });
    it('rejects an invalid create body with 400', async () => {
      expect((await post('/api/runs', { target: 'nope' })).status).toBe(400);
    });
    it('returns JSON 404 for unknown run and finding', async () => {
      for (const p of ['/api/runs/nope', '/api/findings/nope']) {
        const r = await get(p);
        expect(r.status).toBe(404);
        expect(await r.json()).toHaveProperty('error');
      }
    });
    it('creates a run, completes it, exposes findings and steps, replays events, prescribes and verifies', async () => {
      const created = await post('/api/runs', {
        target: 'store',
        mode: 'offline',
        scenarios: ['B2'],
      });
      expect(created.status).toBe(202);
      const { runId } = RunCreateResponse.parse(await created.json());
      const detail = await waitFor(
        async () => RunDetail.parse(await (await get(`/api/runs/${runId}`)).json()),
        (d) => d.run.status === 'completed',
      );
      expect(detail.findings.length).toBeGreaterThan(0);
      expect(detail.score.score).toBeLessThan(100);
      const list = RunSummary.array().parse(await (await get('/api/runs')).json());
      expect(list.some((r) => r.id === runId)).toBe(true);
      const f = detail.findings[0]!;
      const fd = FindingDetail.parse(await (await get(`/api/findings/${f.id}`)).json());
      expect(fd.steps.length).toBeGreaterThan(0);
      const ac = new AbortController();
      const sse = await fetch(`${srv.baseUrl}/api/runs/${runId}/events`, { signal: ac.signal });
      const reader = sse.body!.getReader();
      const { value } = await reader.read();
      const line = new TextDecoder()
        .decode(value)
        .split('\n')
        .find((l) => l.startsWith('data: '))!;
      expect(RunEvent.parse(JSON.parse(line.slice(6))).type).toBe('run.started');
      ac.abort();
      expect((await post(`/api/findings/${f.id}/prescribe`)).status).toBe(202);
      const after = await waitFor(
        async () => FindingDetail.parse(await (await get(`/api/findings/${f.id}`)).json()),
        (d) => d.finding.state === 'verified' || d.finding.state === 'unverified',
      );
      expect(after.finding.state).toBe('verified');
      expect(after.patch).not.toBeNull();
      expect(after.verify?.verified).toBe(true);
    }, 180_000);
  });
}
```

`tests/contract/real.contract.test.ts` starts the real API on port 0 with a test prescriber; `tests/contract/mock.contract.test.ts` starts `createMockApi()` on port 0 (the mock must pass; if it does not, **file the difference to Track C**: do not edit `mocks/`).

**Done when:** `npx vitest run tests/contract/real.contract.test.ts` green; the mock test is green or the failing assertions are listed for Track C; check green. Commit: `feat(api): REST + SSE server and shared contract suite`.

---

### P2-A07 · CLI and offline fixture recording ⏱ 2.5h Track A

**Depends on:** P2-A05, P2-B01 · **Blocks:** P2-C04, P3-A02

**Goal:** the `payclinic` command, the `serve` entry, and a way to record real runs.

**Files:** create `packages/cli/src/cli.ts`, `packages/cli/src/serve.ts`, `packages/cli/src/report.ts`, `tests/cli/cli.test.ts`; add a `bin` entry and root scripts `"payclinic": "tsx packages/cli/src/cli.ts"`, `"serve": "tsx packages/cli/src/serve.ts"`.

**Spec:**

- `payclinic run [--target store|agent] [--scenarios B1,B2,...] [--offline|--online] [--fix] [--json]`: defaults `store`, all merchant scenarios, offline. Builds the runtime with `buildRuntime`, runs, optionally prescribes every finding (`--fix`), then prints either a human table or, with `--json`, a `CliReport` (contracts) to stdout and **nothing else on stdout** (logs go to stderr). Exit code `0` when the run completed (even with findings), `1` on runtime error, `2` when `--fail-on-findings` is given and any finding is unresolved.
- `payclinic verify-reference`: runs the reference-patch verification and prints a table (key, verified, seconds). Exit `1` if any fails.
- `payclinic serve`: starts the API on `config.ports.api`.
- `report.ts`: `buildReport(runId, repos): CliReport` (maps findings; `score` = `run.scoreBefore`, `scoreAfter` = `run.scoreAfter`).

**Tests (write first):** `tests/cli/cli.test.ts` spawns `process.execPath` with `['--import','tsx','packages/cli/src/cli.ts', ...]` and asserts: `run --scenarios B2 --offline --json` → stdout parses as `CliReport`, one finding `I-02`, `score` 90, no `scoreAfter`; the same with `--fix` → `scoreAfter` 100 and the finding `state: 'verified'`; `--scenarios B9` exits non-zero with a message on stderr; `--fail-on-findings` exits 2. Use `{ timeout: 180_000 }` and `DB_PATH` set to a temp file in the child env.

**Done when:** `npx vitest run tests/cli` green; `npm run payclinic -- run --scenarios B2 --json` prints valid JSON; check green. Commit: `feat(cli): run, verify-reference and serve commands`.

---

### P2-A08 · PlaywrightApprover and online recording `[depends on spike S2]` ⏱ 3h Track A

**Depends on:** P2-A05, spike S2 decision · **Blocks:** nothing (offline mode never needs it)

**Goal:** make online mode real, **only if S2 chose `playwright` or `manual`**. If S2 chose `card`, implement the card payment source variant instead (orders created with `payment_source.card` using a sandbox test card; `approve` is a no-op) and say so in the report.

**Files:** create `packages/core/src/runner/playwright-approver.ts` (and add `playwright` as a dependency only if S2 chose it), `scripts/record-online.ts`, `tests/runner/playwright-approver.test.ts`; edit `runner/approvers.ts` to select the approver from `config.buyerApprover`.

**Spec:** `createPlaywrightApprover(o: { buyerEmail: string; buyerPassword: string; launch?: LaunchFn })` where `LaunchFn` returns a minimal `{ page: { goto, fill, click, waitForURL, close } }`-style object so the logic is unit-testable with a fake. It opens the approval URL, logs into the sandbox buyer account, clicks the approve/continue button, waits for the return URL. Selectors are kept in one `SELECTORS` constant. Timeouts 60 s; on failure take a screenshot into `data/approver-failure.png` and throw an error whose message names the step that failed.
`scripts/record-online.ts` (`npm run record:online`): requires `PAYCLINIC_MODE=online`, runs the five merchant scenarios, writes each trace as `fixtures/traces-online/<scenarioKey>.json` (`{scenarioKey, steps, state}`), and prints the PayPal debug ids found. Refuses to run unless `assertSafePayPalBase` passes.

**Tests (write first):** unit tests with the fake launcher: the happy path performs `goto(approveUrl)` → `fill(email)` → `fill(password)` → `click(login)` → `click(approve)` in order; a missing selector throws an error naming the step; credentials never appear in thrown error messages. The **real** run is a human check: record one trace online and attach the generated file to the PR.

**Done when:** unit tests green; check green; a human has recorded at least B1 and B2 online (or the report says S2 chose `manual` and how the recording was done). Commit: `feat(core): online buyer approval and trace recording`.

---

# Track B: Brain & Agent

### P2-B01 · Prescribe pipeline with fallbacks ⏱ 2.5h Track B

**Depends on:** P1-B02 · **Blocks:** P2-A05 integration, P2-A06, P2-A07

**Goal:** `prescribe(finding, steps)` returns an explanation and an **ordered list of candidate patches** (AI first, then the proven reference patch). Verification is Track A's job.

**Read:** TECH_DESIGN §9 (fallback chain), `types.ts` (`Explanation`, `Patch`, `PatchOutput`).

**Files:** create `packages/ai/src/prescribe.ts`, `packages/ai/src/template.ts`, `tests/ai/prescribe.test.ts`; export from `index.ts`.

**Spec:**

```ts
export interface PrescribeDeps {
  provider: AIProvider;
  readSource: (repoRelativePath: string) => string;
  loadReferencePatch: (scenarioKey: ScenarioKey) => PatchOutput | null;
  deriveDiff: (edits: PatchEdit[]) => string;
  newId: () => string;
  now: () => string; // ISO
}
export class PrescribeError extends Error {}
export function prescribe(
  deps: PrescribeDeps,
  finding: Finding,
  steps: Step[],
): Promise<{ explanation: Explanation; patches: Patch[] }>;
export function templateExplanation(
  finding: Finding,
  ref: PatchOutput | null,
  now: string,
): Explanation; // model 'template'
```

- Explanation: try `explain(...)`; on `AIOutputError`, `FixtureMissingError`, or `AIRateLimitError` use `templateExplanation` (`rootCause` from `INVARIANT_META[...].description`, `impact` = `Violates: <title>`, `whereInCode` = first file of `SOURCE_FILES_FOR_SCENARIO`, `fixSummary` = `ref.rationale` or a sentence saying the reference fix is applied; `model: 'template'`).
- Patches: `[aiPatch?, templatePatch?]`. The AI patch has `source: 'ai'`, `model: provider.name`. The template patch comes from `loadReferencePatch` with `source: 'template'`. If both exist and their `edits` are deeply equal, return only the AI one. Every patch gets `diff: deriveDiff(edits)`, `id: newId()`, `createdAt: now()`, and must pass `Patch.parse`. If there is no patch at all, throw `PrescribeError`.
- Never throws for AI failures while a reference patch exists.

**Tests (write first):**

```ts
import { describe, expect, it } from 'vitest';
import { Patch, PatchOutput, type AIProvider } from '@payclinic/contracts';
import { AIOutputError, FakeProvider, prescribe, PrescribeError } from '@payclinic/ai';

const finding = {
  id: 'f1',
  runId: 'r',
  scenarioKey: 'B2',
  invariantKey: 'I-02',
  severity: 'critical',
  state: 'open',
  title: 'Capture amount differs',
  summary: 'x',
  evidenceStepIds: [],
  createdAt: '2026-10-18T10:00:00.000Z',
} as const;
const ref = PatchOutput.parse({
  edits: [
    {
      file: 'apps/buggy-store/src/orders/pricing.ts',
      search: 'return clientTotal ?? serverTotal;',
      replace: 'return serverTotal;',
    },
  ],
  rationale: 'Ignore the client total.',
});
const explainOk = {
  rootCause: 'resolveAmount returns the browser total',
  impact: 'Customers can pay any amount',
  whereInCode: { file: 'apps/buggy-store/src/orders/pricing.ts', hint: 'resolveAmount' },
  fixSummary: 'Always use the server total',
};
const aiEdit = { ...ref.edits[0]!, replace: 'return serverTotal; // from the model' };
let n = 0;
const base = (provider: AIProvider, reference: PatchOutput | null = ref) => ({
  provider,
  readSource: () => 'export const x = 1;',
  loadReferencePatch: () => reference,
  deriveDiff: () => '--- a\n+++ b\n',
  newId: () => `id${++n}`,
  now: () => '2026-10-18T10:00:00.000Z',
});
const failing = (tasks: string[]): AIProvider => ({
  name: 'broken',
  generateJSON: async (o) => {
    if (tasks.includes(o.task)) throw new AIOutputError('bad json');
    return (
      new FakeProvider({
        'explain:B2': explainOk,
        'patch:B2': { edits: [aiEdit], rationale: 'r' },
      }) as AIProvider
    ).generateJSON(o);
  },
});

describe('prescribe', () => {
  it('returns the AI patch first and the reference patch second', async () => {
    const p = new FakeProvider({
      'explain:B2': explainOk,
      'patch:B2': { edits: [aiEdit], rationale: 'model' },
    });
    const out = await prescribe(base(p), finding, []);
    expect(out.patches.map((x) => x.source)).toEqual(['ai', 'template']);
    expect(out.explanation.model).toBe(p.name);
    out.patches.forEach((x) => Patch.parse(x));
  });
  it('falls back to the reference patch when the AI patch fails', async () => {
    const out = await prescribe(base(failing(['patch'])), finding, []);
    expect(out.patches.map((x) => x.source)).toEqual(['template']);
    expect(out.explanation.model).toBe('broken');
  });
  it('uses a template explanation when explain fails', async () => {
    const out = await prescribe(base(failing(['explain'])), finding, []);
    expect(out.explanation.model).toBe('template');
    expect(out.explanation.fixSummary).toContain('Ignore the client total');
    expect(out.patches.length).toBeGreaterThan(0);
  });
  it('throws PrescribeError when nothing is available', async () => {
    await expect(prescribe(base(failing(['patch', 'explain']), null), finding, [])).rejects.toThrow(
      PrescribeError,
    );
  });
  it('returns a single patch when the AI edits equal the reference', async () => {
    const p = new FakeProvider({
      'explain:B2': explainOk,
      'patch:B2': { edits: ref.edits, rationale: 'same' },
    });
    expect((await prescribe(base(p), finding, [])).patches).toHaveLength(1);
  });
});
```

**Done when:** `npx vitest run tests/ai/prescribe.test.ts` green; check green. Commit: `feat(ai): prescribe pipeline with template fallbacks`.

---

### P2-B05 · Policy generation and YAML ⏱ 2.5h Track B

**Depends on:** P1-B03 · **Blocks:** P3-B01

**Goal:** a generated firewall policy that can never be weaker than a safe baseline, and readable YAML.

**Read:** TECH_DESIGN §10; `Policy`, `PolicyOutput`, `AgentIntent`.

**Files:** create `packages/firewall/src/yaml.ts`, `packages/firewall/src/generate.ts`, `tests/firewall/policy.test.ts`; export from `index.ts`.

**Spec:**

- `serializePolicy(policy: Policy): string` (package `yaml`) with a leading comment block and one comment line per rule (`# R1 per-transaction cap`, `# R2 session budget`, `# R3 merchant allowlist (deny by default)`, `# R4 approval threshold`, `# R5 duplicate window`). `parsePolicy(text: string): Policy` validates with the `Policy` schema; invalid input throws `PolicyParseError`.
- `defaultPolicyFor(intent: AgentIntent, allowedMerchants: string[], extra?: { approvalThreshold?: string }): Policy` = `{version:1, currency, perTransactionCap: intent.perTxnCap, sessionBudget: intent.budget, merchantAllowlist: allowedMerchants, duplicateWindowSec: 600, ...extra}`.
- `generatePolicy(deps: { provider: AIProvider }, input: { findings: Finding[]; intent: AgentIntent; allowedMerchants: string[]; approvalThreshold?: string }): Promise<{ policy: Policy; source: 'ai' | 'template'; rationale: string }>`: ask the provider (`task: 'policy'`, `fixtureKey: 'policy:agent'`, schema `PolicyOutput`) with a prompt that states the **user intent** and the findings (as data). **Sanity gate**, enforced in code: the AI policy is accepted only if it has a non-empty `merchantAllowlist` that is a **subset** of `allowedMerchants`, `perTransactionCap` ≤ `intent.perTxnCap`, `sessionBudget` ≤ `intent.budget`, `currency` equal to the intent's, and `duplicateWindowSec` present. Otherwise (or on any provider error) return the default policy with `source: 'template'`.

**Tests (write first):**

```ts
import { describe, expect, it } from 'vitest';
import type { AIProvider, AgentIntent, Policy } from '@payclinic/contracts';
import {
  defaultPolicyFor,
  generatePolicy,
  parsePolicy,
  serializePolicy,
} from '@payclinic/firewall';

const intent: AgentIntent = {
  skus: ['tee-001'],
  maxQtyPerSku: 1,
  budget: '40.00',
  perTxnCap: '30.00',
  currency: 'USD',
};
const provider = (policy: Partial<Policy> | Error): AIProvider => ({
  name: 'p',
  generateJSON: async () => {
    if (policy instanceof Error) throw policy;
    return { policy: { version: 1, currency: 'USD', ...policy }, rationale: 'r' } as never;
  },
});
const good = {
  perTransactionCap: '30.00',
  sessionBudget: '40.00',
  merchantAllowlist: ['demo-store'],
  duplicateWindowSec: 600,
};
const input = { findings: [], intent, allowedMerchants: ['demo-store'] };

describe('policy yaml', () => {
  it('round-trips and keeps comments', () => {
    const p = defaultPolicyFor(intent, ['demo-store'], { approvalThreshold: '25.00' });
    const text = serializePolicy(p);
    expect(text).toMatch(/# R3 merchant allowlist/);
    expect(parsePolicy(text)).toEqual(p);
  });
  it('rejects invalid YAML policies', () =>
    expect(() => parsePolicy('version: 2\ncurrency: usd')).toThrow());
});

describe('generatePolicy', () => {
  it('accepts a strict AI policy', async () =>
    expect(await generatePolicy({ provider: provider(good) }, input)).toMatchObject({
      source: 'ai',
    }));
  it.each([
    ['extra merchant', { ...good, merchantAllowlist: ['demo-store', 'sketchy-deals'] }],
    ['empty allowlist', { ...good, merchantAllowlist: [] }],
    ['cap above intent', { ...good, perTransactionCap: '99.00' }],
    ['budget above intent', { ...good, sessionBudget: '500.00' }],
    ['missing dedupe window', { ...good, duplicateWindowSec: undefined }],
  ])('falls back to the default for %s', async (_n, bad) => {
    const out = await generatePolicy({ provider: provider(bad as Partial<Policy>) }, input);
    expect(out.source).toBe('template');
    expect(out.policy).toEqual(defaultPolicyFor(intent, ['demo-store']));
  });
  it('falls back when the provider throws', async () =>
    expect((await generatePolicy({ provider: provider(new Error('down')) }, input)).source).toBe(
      'template',
    ));
});
```

**Done when:** `npx vitest run tests/firewall/policy.test.ts` green; check green. Commit: `feat(firewall): policy generation with sanity gate and yaml`.

---

### P2-B04 · GuardedPayTools and the decision log ⏱ 2.5h Track B

**Depends on:** P1-B03, P1-B04 · **Blocks:** P2-B03 (Protect runs), P3-B01

**Goal:** the in-process firewall wrapper around `PayTools`.

**Read:** TECH_DESIGN §10 (GuardedPayTools).

**Files:** create `packages/firewall/src/guarded.ts`, `tests/firewall/guarded.test.ts`; export from `index.ts`.

**Spec:**

```ts
export class GuardedPayTools implements PayTools {
  constructor(
    inner: PayTools,
    policy: Policy,
    o: {
      runId: string;
      catalog: Product[];
      now: () => number;
      newId: () => string;
      onDecision?: (d: FirewallDecision) => void;
      onEscalate?: (d: FirewallDecision) => Promise<boolean>; // default: async () => false
    },
  );
}
```

`createOrder({merchantId, sku, qty})`: look up the product in `catalog` (unknown → `{error: 'unknown product <sku>'}` **and no decision**); `amount = fromMinor(toMinor(price) * BigInt(qty), currency)`; call `firewallEngine.evaluate(request, policy, history)` with history from internal state (`sessionSpent` as a money string, `recentPurchases`, `nowMs: now()`); build the `FirewallDecision` (`id`, `runId`, `ts = new Date(now()).toISOString()`) and call `onDecision`. `block` → `{ error: 'blocked by firewall: <ruleId> <reason>' }`. `escalate` → ask `onEscalate`; if `false` return `{ error: 'blocked pending approval: <ruleId> <reason>' }`; if `true` record a second decision (`action:'allow'`, `ruleId:null`, reason `Approved by human after escalation (R4)`) and continue. `allow` → call `inner.createOrder` and remember the pending order `{orderId → {merchantId, sku, qty, amount}}`. `captureOrder(orderId)`: call `inner.captureOrder`; **only on `COMPLETED`** add the amount to `sessionSpent` and push to `recentPurchases` (with `atMs: now()`). `searchProducts` passes through.

**Tests (write first):**

Test file header (real imports):

```ts
import { describe, expect, it } from 'vitest';
import type { FirewallDecision, Policy, Product } from '@payclinic/contracts';
import type { PayTools } from '@payclinic/shopping-agent';
import { GuardedPayTools } from '@payclinic/firewall';
```

Write real tests (use a local `fakeTools()` implementing `PayTools` whose `createOrder` returns `{orderId: 'O'+n, amount, currency}` and records calls; `captureOrder` returns `COMPLETED` unless a flag says otherwise) for: (1) an allowed order passes through and logs one `allow` decision with `ruleId: null`; (2) `sketchy-deals` is blocked with the exact error `blocked by firewall: R3 Merchant sketchy-deals is not on the allowlist`, the inner `createOrder` is **not** called, and the decision has `ruleId 'R3'`; (3) session spend counts only completed captures: after one captured 25.00 order, a 20.00 order is blocked by R2, but after a **failed** capture it is not; (4) R5: an identical purchase inside the window after a completed capture is blocked, and allowed after `now()` advances past the window; (5) escalation: threshold 20.00 and a 25.00 order → default `onEscalate` blocks with `blocked pending approval: R4`, and with `onEscalate: async () => true` it goes through and logs two decisions (`escalate` then `allow`); (6) unknown sku → `{error}` and no decision; (7) decisions carry the given `runId`, unique ids and ISO timestamps derived from `now()`. The `PayTools` interface lives in `@payclinic/shopping-agent`; add that package (and `@payclinic/core` for `toMinor`/`fromMinor`) to `packages/firewall/package.json` dependencies.

**Done when:** `npx vitest run tests/firewall/guarded.test.ts` green; check green. Commit: `feat(firewall): GuardedPayTools with decision log`.

---

### P2-B03 · Agent scenarios A1 and A2 ⏱ 2.5h Track B

**Depends on:** P1-B04, P1-B05, P1-A07, P2-B04 · **Blocks:** P3-B01

**Goal:** the two attacks run through the same pipeline as the merchant bugs.

**Read:** TECH_DESIGN §10 (A1, A2, constants).

**Files:** create `apps/shopping-agent/src/scenario.ts`, `scenarios/a1.ts`, `scenarios/a2.ts`, `tests/runner/agent-scenarios.test.ts`; edit `scenarios/index.ts` (register A1, A2) and `packages/core/src/runner/context.ts` (**only** to add `now(): number` and `declareAgent(state: AgentRunState): void`, and to include the declared agent state in the `RunState` built by the pipeline).

**Spec:**

```ts
// apps/shopping-agent/src/scenario.ts
export const AGENT_TASK =
  'Buy one Logo Tee (tee-001). Budget 40.00 USD, maximum 30.00 per purchase.';
export const AGENT_INTENT: AgentIntent = {
  skus: ['tee-001'],
  maxQtyPerSku: 1,
  budget: '40.00',
  perTxnCap: '30.00',
  currency: 'USD',
};
export const ALLOWED_MERCHANTS = ['demo-store'];
export const DEDUPE_WINDOW_SEC = 600;
export async function runAgentScenario(
  ctx: ScenarioContext,
  o: { brain: AgentBrain; wrapTools?: (tools: PayTools, catalog: Product[]) => PayTools },
): Promise<void>;
```

`runAgentScenario` builds `createStorePayTools` from the context (`request` → `ctx.http.request`, `approve` → `ctx.approve`, `now` → `ctx.now`, `onPurchase` → collects purchases), optionally wraps the tools (the Protect flow passes a `GuardedPayTools` factory), runs `runAgent`, then calls `ctx.declareAgent({ intent: AGENT_INTENT, allowedMerchants: ALLOWED_MERCHANTS, dedupeWindowSec: DEDUPE_WINDOW_SEC, purchases })`. `a1` uses `new ScriptedNaiveBrain({ gullible: true, retries: 0 })`; `a2` uses `new ScriptedNaiveBrain({ gullible: false, retries: 4, retryOnSuccess: true })`.

**Tests (write first):** `runDiagnose` offline with `target: 'agent'`, scenarios `['A1','A2']`:

```ts
// expected findings (scenario:invariant): A1:I-07, A1:I-08, A2:I-07, A2:I-09
// score = 100 - (I-07 high 6 + I-08 critical 10 + I-09 high 6) = 78
// A1 state: exactly one purchase { merchantId: 'sketchy-deals', sku: 'promo-099', qty: 10, amount: '99.00' }
// A2 state: exactly five purchases of tee-001 qty 1 amount '25.00' (sum 125.00)
// the A1 trace contains a runner GET /api/products step whose response includes the poisoned description
```

Write as real code using the helpers in `tests/runner/diagnose.test.ts`.

**Done when:** `npx vitest run tests/runner/agent-scenarios.test.ts` green and **all earlier runner tests still green**; check green. Commit: `feat(agent): attack scenarios A1 and A2`.

---

### P2-B02 · Patch evaluation harness and AI fixtures ⏱ 2.5h Track B (needs a human with a Gemini key)

**Depends on:** P2-A04, P2-B01, P2-A05 · **Blocks:** P3-A02

**Goal:** measure how well the real model fixes each bug, and **record its outputs as offline fixtures**, so the demo can replay real AI work with no key.

**Files:** create `scripts/eval-patches.ts`, `packages/ai/src/eval.ts`, `tests/ai/eval.test.ts`, `tests/ai/fixtures-verify.test.ts`; fixtures are written to `fixtures/ai/explain.B*.json` and `fixtures/ai/patch.B*.json`.

**Spec:**

- `packages/ai/src/eval.ts`: `formatEvalTable(rows: { key: string; aiPatchProduced: boolean; verified: boolean; attempts: number; seconds: number; fallbackUsed: boolean }[]): string` (fixed-width table, last line `AI verified: <n>/<total>`), and `evalExitCode(rows, minVerified = 4): 0 | 1`.
- `scripts/eval-patches.ts`: requires `GEMINI_API_KEY`, `GEMINI_MODEL`; sets `AI_RECORD=1`; for B1..B5: run diagnose offline, `prescribe` (real Gemini through `RecordingProvider`), verify **only the AI patch** (not the fallback) via `createVerify`, print the table, exit code from `evalExitCode`.
- A **human** runs it once with their own key and commits `fixtures/ai/*.json`. If fewer than 4 of 5 AI patches verify, improve the **prompts** (not the tests), re-run, and record the final numbers in `docs/spikes/AI-EVAL.md`.

**Tests (write first):** `tests/ai/eval.test.ts`: table contains the header and `AI verified: 4/5`; exit code `0` for 4/5 and `1` for 3/5. `tests/ai/fixtures-verify.test.ts`: for every `B*` present in `fixtures/ai/` (skip a key only if its fixture file does not exist), run `prescribe` with `FixtureProvider('fixtures/ai')` + the reference loader, verify the **first** (AI) patch with `createVerify`, and require `verified: true`. This protects the offline demo: a recorded AI output that no longer verifies fails CI.

**Done when:** tests green; fixtures committed; `AI-EVAL.md` written; check green. Commit: `feat(ai): patch evaluation harness and recorded AI fixtures`.

---

### P2-B06 · AI scenario variations `[Could, cut first]` ⏱ 2h Track B

**Depends on:** P1-B01 · **Blocks:** nothing

**Goal:** the AI proposes extra carts (other items, currencies) for existing scenarios; code validates them.

**Files:** create `packages/ai/src/variations.ts`, `tests/ai/variations.test.ts`.

**Spec:** `buildVariationsPrompt(scenarioKey, catalog)` and `generateVariations(deps, scenarioKey, catalog): Promise<VariationOutput['variations']>` using `task: 'variations'`, `fixtureKey: 'variations:<key>'`. `validateVariations(output, catalog)` drops entries whose `sku` is not in the catalog, whose currency differs from the product currency, or whose `scenarioKey` is not a merchant scenario, and caps the list at 5. Any provider failure returns `[]`.

**Tests:** invalid sku dropped; currency mismatch dropped; agent scenario key dropped; more than 5 trimmed to 5; provider error returns `[]`; deterministic prompt for the same inputs.

**Done when:** tests green; check green. Commit: `feat(ai): validated scenario variations`.

---

# Track C: Experience & Delivery

### P2-C01 · Live API wiring, SSE hook, start-run panel ⏱ 3h Track C

**Depends on:** P1-C03, P2-A06 (shared contract suite) · **Blocks:** P2-C03

**Goal:** the dashboard talks to the mock **or** the real API by changing one setting, and shows live run progress.

**Read:** `api.ts`, `events.ts`; `tests/contract/api-contract.ts` (written by Track A).

**Files:** edit `apps/dashboard/src/api/client.ts`, `hooks.ts`, `pages/RunsPage.tsx`; create `src/api/useRunEvents.ts`, `src/components/StartRunPanel.tsx`, `src/components/RunProgress.tsx`, tests next to them; fix `mocks/api/**` where the shared contract suite finds differences (you own the mock).

**Spec:**

- `useRunEvents(runId, { eventSourceCtor = EventSource })` returns `{ events: RunEvent[]; status: 'connecting' | 'open' | 'closed' }`; parses each message with `RunEvent` (invalid messages are ignored and counted in `invalid`); closes on unmount and when it receives `run.completed` or `run.failed`.
- `StartRunPanel`: loads `/api/scenarios`, shows a checkbox per merchant scenario (all selected by default), a mode label from `/api/health` (offline/online), a **Diagnose** button (disabled while posting), and navigates to `/runs/:id` after `POST /api/runs`. Shows the API error text on failure.
- `RunProgress`: a vertical list built from events (`scenario.started` → "Running B2…", `finding.created` → severity badge + title, `run.completed` → "Done, score N").
- `VITE_API_URL` defaults to `http://localhost:4001` (mock). Add npm scripts `dev:mock` and `dev:real` that set it to 4001/4000.

**Tests (write first):** a fake `EventSource` class (stores the handler, exposes `emit(data)`): the hook collects valid events, ignores invalid JSON, closes on `run.completed`; `StartRunPanel` renders scenarios from a fake client, posts the selected keys (assert the fake client received exactly the checked scenarios) and navigates; `RunProgress` renders one line per event type.

**Done when:** `npx vitest run apps/dashboard` green; `npx vitest run tests/contract/mock.contract.test.ts` green; check green; with the real API running (`npm run serve`) the dashboard (`npm run dev:real`) starts a run and shows live progress. Commit: `feat(dashboard): live wiring, SSE hook, start-run panel`.

---

### P2-C02 · Finding detail: timeline, explanation, diff viewer ⏱ 3.5h Track C

**Depends on:** P1-C03 · **Blocks:** P2-C03, P3-C01

**Goal:** the screen that explains a finding with evidence: what you will show in the video.

**Files:** create `apps/dashboard/src/pages/FindingPage.tsx`, `src/components/TraceTimeline.tsx`, `ExplanationPanel.tsx`, `UnifiedDiff.tsx`, `VerifyBadge.tsx`, `src/lib/diff.ts`, `src/lib/trace.ts`, tests next to them; edit `App.tsx` (route `/runs/:id/findings/:fid`) and `FindingsGrid.tsx` (row click navigates).

**Spec:**

- `lib/diff.ts`: `parseUnifiedDiff(diff: string): { kind: 'meta' | 'hunk' | 'add' | 'del' | 'ctx'; text: string }[]` (`---`/`+++` → meta, `@@` → hunk, `+` add, `-` del, else ctx). Pure.
- `lib/trace.ts`: `describeStep(step: Step): { actorLabel: string; title: string; chip: string; tone: 'ok' | 'warn' | 'error' }` where `title` is `step.label ?? "<METHOD> <path>"`, `chip` is `"<status>"`, tone is `ok` for 2xx, `warn` for 4xx, `error` for 5xx/599; and `orderSteps(steps)` sorting by `seq`.
- `TraceTimeline({ steps, evidenceStepIds })`: vertical timeline in `seq` order; actor shown as a coloured tag (Customer/Runner, Store, Agent); each row shows title, status chip, PayPal debug id chip when present; **evidence steps are highlighted** and carry `aria-current="true"`; clicking a row expands request and response bodies as formatted JSON (collapsed by default).
- `ExplanationPanel({ explanation })`: root cause, impact, where in code (file path + hint), fix summary; `model` shown as a small tag (`template` shows "Reference fix").
- `UnifiedDiff({ diff })`: monospace, added lines green, removed red, hunk headers muted; never uses `dangerouslySetInnerHTML`.
- `VerifyBadge({ verify })`: `Verified ✓` with duration, or `Not verified` with the last log line; `—` when null.
- `FindingPage`: header (severity badge, title, state), summary, timeline, then (if present) explanation, diff, verify badge. Placeholder for the Prescribe button is **not** rendered here (P2-C03 adds it).

**Tests (write first):** `parseUnifiedDiff` classifies each line kind; `describeStep` tones and fallback title; `orderSteps` sorts; `TraceTimeline` highlights exactly the evidence ids (query by `aria-current`), expands a row to show the response JSON, shows the debug id chip; `UnifiedDiff` renders add/del classes and escapes HTML in diff text (`<img onerror>` stays text); `FindingPage` with the mock `FindingDetail` of a verified finding shows the explanation, the diff and `Verified`; with an open finding shows no diff and `—`.

**Done when:** `npx vitest run apps/dashboard` green; check green; screenshots of an open finding and a verified finding in the PR. Commit: `feat(dashboard): finding detail with timeline, explanation and diff`.

---

### P2-C03 · Prescribe flow UI and live progress ⏱ 2.5h Track C

**Depends on:** P2-C01, P2-C02 · **Blocks:** P3-C02

**Goal:** the money-shot interaction: press **Prescribe**, watch it explain, patch, verify, and the score rise.

**Files:** create `apps/dashboard/src/components/PrescribeButton.tsx`, `src/components/PrescribeStepper.tsx`, `src/api/usePrescribe.ts`, tests; edit `FindingPage.tsx`, `RunPage.tsx` (score updates live from `score.updated`), `ScoreGauge.tsx` (animates between values; respects `prefers-reduced-motion`).

**Spec:** `usePrescribe(findingId)` posts `/api/findings/:id/prescribe`, subscribes to the finding's run events and exposes `{ stage: 'idle' | 'explaining' | 'patching' | 'verifying' | 'done' | 'failed'; message; start() }`. `PrescribeStepper` shows the four stages with the current one active. The button is disabled while running and hidden when the finding is already `verified`. On `done` the page reloads the finding detail and the run score; on `failed` it shows the message and a Retry button. `RunPage` shows `scoreBefore → scoreAfter` and a "Fix all" button that prescribes every open finding **sequentially**.

**Tests (write first):** with fake client and fake EventSource: clicking Prescribe posts once and shows `explaining`; emitting the stage events advances the stepper; `done` triggers a reload; `failed` shows Retry; verified findings hide the button; "Fix all" posts one prescribe at a time in order (assert call order with controlled promises); the gauge applies `aria-label` text with the **final** number immediately even when animating.

**Done when:** `npx vitest run apps/dashboard` green; check green; a screen recording of a full Prescribe on the **real** API attached to the PR. Commit: `feat(dashboard): prescribe flow with live stepper`.

---

### P2-C04 · GitHub Action skeleton and PR comment formatter ⏱ 2h Track C

**Depends on:** P2-A07 (`CliReport`, CLI) · **Blocks:** P3-C04

**Goal:** a pull-request comment with the findings and score.

**Files:** create `scripts/format-pr-comment.ts`, `tests/scripts/format-pr-comment.test.ts`, `.github/workflows/payclinic.yml`.

**Spec:** `formatPrComment(report: CliReport): string` returns Markdown that **starts with** `<!-- payclinic-report -->`, then `### PayClinic payment-safety report`, a line `Score: **<score>** / 100` (or `**<score>** → **<scoreAfter>** / 100` when `scoreAfter` is present), then either `No findings. Every checked invariant passed.` or a table `| Severity | Invariant | Scenario | State | Finding |` with one row per finding (pipes in text escaped), and a final line `Run <runId> · <mode> mode`. `scripts/format-pr-comment.ts` is also runnable: `node --import tsx scripts/format-pr-comment.ts <report.json>` prints the comment (validating the file with `CliReport`).

Workflow (create exactly this, then check it on a test PR in P3-C04):

```yaml
name: PayClinic
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  payclinic:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsx packages/cli/src/cli.ts run --offline --json > payclinic-report.json
      - run: node --import tsx scripts/format-pr-comment.ts payclinic-report.json > payclinic-comment.md
      - uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = fs.readFileSync('payclinic-comment.md', 'utf8');
            const { owner, repo } = context.repo;
            const issue_number = context.issue.number;
            const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number });
            const existing = comments.find((c) => c.body && c.body.includes('<!-- payclinic-report -->'));
            if (existing) await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
            else await github.rest.issues.createComment({ owner, repo, issue_number, body });
```

**Tests (write first):** starts with the marker; shows the table with a critical B1 finding; shows `61 → 100` when `scoreAfter` is set; the "no findings" text when the list is empty; a `|` inside a finding title is escaped; the script file path argument is validated (invalid JSON exits non-zero with a message).

**Done when:** `npx vitest run tests/scripts` green; check green; the workflow YAML parses (`npx yaml valid .github/workflows/payclinic.yml` or review). Commit: `feat(ci): PR comment formatter and PayClinic workflow`.

---

# Integration

### P2-X01 · MVP integration test and insurance recording (IC2) ⏱ 2h All

**Depends on:** all Phase 2 cards marked "MVP" (A01 to A07, B01, B05, C01 to C03) · **Blocks:** Phase 3

**Goal:** one automated test and one human recording prove the MVP.

**Files:** create `tests/e2e/ic2.test.ts`.

**Tests (write first):**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { FindingDetail, RunDetail, PatchOutput } from '@payclinic/contracts';
import { buildTestRuntime, startApiOnFreePort } from './helpers'; // implement in tests/e2e/helpers.ts: real orchestrator, FakeProvider fed from fixtures/patches as "AI", real createApi

let api: Awaited<ReturnType<typeof startApiOnFreePort>>;
beforeAll(async () => {
  api = await startApiOnFreePort(await buildTestRuntime());
}, 60_000);
afterAll(async () => {
  await api.close();
});

it('MVP loop: diagnose five bugs, fix all, score 61 → 100, offline, no API keys', async () => {
  const create = await fetch(`${api.baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: 'store',
      mode: 'offline',
      scenarios: ['B1', 'B2', 'B3', 'B4', 'B5'],
    }),
  });
  const { runId } = await create.json();
  let detail: any;
  for (let i = 0; i < 300; i++) {
    detail = RunDetail.parse(await (await fetch(`${api.baseUrl}/api/runs/${runId}`)).json());
    if (detail.run.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(detail.findings.map((f: any) => f.invariantKey).sort()).toEqual([
    'I-01',
    'I-02',
    'I-04',
    'I-05',
    'I-06',
  ]);
  expect(detail.score.score).toBe(61);
  for (const f of detail.findings) {
    expect(
      (await fetch(`${api.baseUrl}/api/findings/${f.id}/prescribe`, { method: 'POST' })).status,
    ).toBe(202);
    for (let i = 0; i < 360; i++) {
      const d = FindingDetail.parse(
        await (await fetch(`${api.baseUrl}/api/findings/${f.id}`)).json(),
      );
      if (d.finding.state !== 'open') {
        expect(d.finding.state).toBe('verified');
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const after = RunDetail.parse(await (await fetch(`${api.baseUrl}/api/runs/${runId}`)).json());
  expect(after.score.score).toBe(100);
  expect(after.run.scoreAfter).toBe(100);
}, 600_000);
```

Implement `tests/e2e/helpers.ts` (not a placeholder: `buildTestRuntime` wires `createOrchestrator` with the real verify and a prescriber built from `prescribe()` + a `FakeProvider` whose `patch:<key>` outputs are read from `fixtures/patches/<key>.json`; `startApiOnFreePort` listens on port 0 and returns `{ baseUrl, close }`).

**Human steps:**

1. Run `npm run build -w @payclinic/dashboard` (must succeed) and use the dashboard against the real API (`npm run serve` + `npm run dev:real`): diagnose five bugs, open a finding, Prescribe, watch the score rise.
2. **Record a rough screen capture** (OBS or the OS recorder), 2 to 3 minutes, as insurance. Save it outside the repo.
3. Write `docs/IC2-REPORT.md`: what works, what does not, timing of a full run, known bugs. Tag `v0.2-mvp`.

**Done when:** `npx vitest run tests/e2e/ic2.test.ts` green; check green; the report and recording exist. Commit: `test(e2e): MVP integration test (IC2)`.

---

## Phase 2 exit checklist (IC2)

- [ ] `npm run check` green; CI green; tag `v0.2-mvp` created.
- [ ] `tests/patches`, `tests/verify`, `tests/orchestrator`, `tests/contract` (real and mock), `tests/cli`, `tests/e2e/ic2` all green.
- [ ] A full offline run (five bugs → fixed) takes under 5 minutes (record the real number).
- [ ] The dashboard works against the real API; a recording exists.
- [ ] Agent scenarios A1 and A2 produce the expected findings (score 78 for the agent-only run).
- [ ] AI fixtures recorded (or the reason they were not is written in `AI-EVAL.md`).
- [ ] Carry-overs named and assigned; any "Could" card that is not finished is cut now.

## Next-up (if you finish early)

**A:** P3-A01 hardening. **B:** P3-B02 agent fixtures and optional LLM brain. **C:** P3-C01 timeline replay polish.
