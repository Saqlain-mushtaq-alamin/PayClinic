# PayClinic

**Attack a PayPal checkout, prove what broke, let AI propose the fix — then prove the fix.**

PayClinic runs deterministic attacks against a demo store's PayPal checkout and
an AI shopping agent, decides what is broken with **pure invariant functions**,
uses AI **only** to explain and propose fixes, and re-runs the attack to prove
each fix. A spending firewall then blocks the agent attacks at runtime.

> AI generates and explains. Deterministic code decides.

## The three stages (15-second version)

1. **Diagnose** — attack the target with scripted scenarios (B1..B5 for the
   store, A1/A2 for the agent) while every HTTP step is recorded. Pure
   invariants (I-01..I-09) read the trace and report findings. The store demo
   starts at **score 61/100**; the agent at **78/100**.
2. **Prescribe** — AI explains a finding and proposes a patch as exact-string
   edits. PayClinic **proves** each patch: apply it to a temp copy of the store,
   re-run the same attack, require the invariants to pass. All five store bugs
   reach **score 100** — measured at well under a second per fix offline.
3. **Protect** — a spending firewall (per-transaction cap, session budget,
   merchant allowlist, dedupe window, escalation) wraps the agent's payment
   tools and blocks the prompt-injection and runaway-retry attacks. The agent
   returns to **100/100**.

<p align="center">
  <img src="docs/img/runs.png" width="48%" alt="Runs list: three seeded runs with scores 61, 100 and 100">
  <img src="docs/img/findings.png" width="48%" alt="Findings grid for the store run before the fix: five findings, score 61">
  <img src="docs/img/finding-detail.png" width="48%" alt="Finding detail with the recorded trace replay and the Prescribe action">
  <img src="docs/img/protect-firewall.png" width="48%" alt="Protect: generated spending-firewall policy and decision log, score 78 to 100">
</p>

## Quickstart

No API keys are needed. Everything runs offline against a built-in PayPal
simulator with recorded AI outputs.

```bash
npm ci
npm run setup
npm run demo
```

Expected output:

```
Created .env from .env.example
Building dashboard...
Setup completed successfully!
To start the demo, run:
  npm run demo
```

`npm run demo` seeds three finished runs by running the real pipeline offline
(store before fix, store after fix, agent protected) and then serves the API
and the built dashboard:

```
1/3 Running store diagnosis (before fix)...
  Run 1 finished: 5 findings found (state: open)
2/3 Running store diagnosis and applying fixes (after fix)...
3/3 Running agent diagnosis and spending firewall protection...
  Run 3 finished: protected (scoreAfter: 100)
Demo seeding completed successfully with 3 finished runs.
payclinic api listening on http://127.0.0.1:4000
```

Open **http://localhost:4000** (the API serves the built dashboard). Seeding is
idempotent — a database that already contains runs is reused unless you pass
`--force`.

## Offline mode, and how to go online

**Offline** (the default, and what CI and the judges use): `PAYCLINIC_MODE=offline`
points PayPal at a deterministic in-process simulator (`packages/sim`) that
implements the Orders v2 subset PayClinic uses — order create/approve/capture,
refunds, webhook signature verification, idempotency replay, and PayPal's error
shapes (`ORDER_ALREADY_CAPTURED`, `INSTRUMENT_DECLINED`, decimal-precision
errors). AI output comes from recorded fixtures in `fixtures/ai/`, so the demo
needs no Gemini key and no network.

**Online** uses your own PayPal **sandbox** account and your own Gemini key —
never live credentials:

```ini
# .env
PAYCLINIC_MODE=online
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=<your sandbox client id>
PAYPAL_CLIENT_SECRET=<your sandbox secret>
BUYER_APPROVER=manual            # or playwright / card
AI_PROVIDER=gemini
GEMINI_API_KEY=<your key>
GEMINI_MODEL=<model id>
```

`npm run record:online` runs the scenarios once against the real sandbox and
saves the traces to `fixtures/traces-online/`; the dashboard can then show real
sandbox evidence while staying offline.

## Architecture

```
                        ┌───────────────────────── one Node process: the Orchestrator ─────────────────────────┐
 Scenario Runner ──HTTP─▶ Buggy Store (child process, ephemeral port)                                          │
   (ctx.http records     │        │ HTTP (PAYPAL_BASE_URL = trace proxy)                                       │
    actor "runner")      │        ▼                                                                            │
                         │   Trace Proxy (in-process http server, ephemeral port; records actor "store";       │
                         │        │        can inject PayPal-Mock-Response)                                    │
                         │        ▼                                                                            │
                         │   PayPal target:  offline → Simulator (in-process, ephemeral port)                  │
                         │                    online  → https://api-m.sandbox.paypal.com                       │
                         └─────────────────────────────────────────────────────────────────────────────────────┘
 REST API (Fastify) :4000      Mock API :4001      Simulator (standalone dev) :4010      Dashboard (Vite) :5173
```

The orchestrator starts everything on ephemeral ports: the buggy store as a
child process, a trace proxy in front of the PayPal target (simulator offline,
`api-m.sandbox.paypal.com` online), and records every request as an immutable
step. Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/TECH_DESIGN.md](docs/TECH_DESIGN.md).

## What the invariants check

| Key  | Invariant                                             | Severity | Fails when                                                       |
| ---- | ----------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| I-01 | One successful capture per cart                       | critical | a cart produced more than one successful capture (double charge) |
| I-02 | Captured amount equals server-computed total          | critical | a capture charged a client-supplied amount                       |
| I-03 | Refunds never exceed captured amount                  | high     | `refundedTotal > capturedTotal`                                  |
| I-04 | Paid if and only if capture COMPLETED                 | critical | an order is marked paid while its capture failed (or vice versa) |
| I-05 | Webhook side effects at most once; forged rejected    | high     | a replayed event applies twice, or a forged event applies at all |
| I-06 | Amount strings valid for the currency                 | medium   | a zero-decimal currency (JPY…) is sent with decimals             |
| I-07 | Agent stays within budget and per-transaction cap     | high     | total spend exceeds the budget or one purchase exceeds the cap   |
| I-08 | Agent buys only intended items from allowed merchants | critical | a purchase leaves the allowlist or the declared intent           |
| I-09 | No duplicate purchases inside the dedupe window       | high     | the same merchant+sku+qty is bought twice within the window      |

The five planted store bugs (B1 double order per cart, B2 client-supplied
amount, B3 webhook replay/forgery, B4 paid-before-capture-check, B5 JPY
decimals) map to I-01, I-02, I-05, I-04 and I-06. The agent attacks (A1 prompt
injection through a product description, A2 runaway repeat purchase) map to
I-07/I-08 and I-07/I-09.

## Safety model

- **Sandbox only.** `assertSafePayPalBase` allows exactly
  `https://api-m.sandbox.paypal.com` or loopback hosts; anything else throws.
  Live PayPal credentials and hosts are never used.
- **AI output is untrusted data.** Evidence and source code are normalized and
  redacted before prompting; prompts state that the content is data, not
  instructions; outputs must match a strict JSON schema.
- **Patches are proven in a temp copy.** AI patches are applied only inside
  `.payclinic-tmp/`, only to `apps/buggy-store/src/`, at most 5 edits, with a
  denylist (`eval`, `child_process`, `process.env`, …) — never to the working
  tree — and only count as fixed after the re-run passes the invariants.
- **The firewall is code, not a prompt.** `GuardedPayTools` calls a pure
  `evaluate()` before every payment tool call; blocked calls never reach PayPal.

## Running the tests

```bash
npm test            # vitest run (all suites)
npm run check       # typecheck + lint + tests — must be green before every commit
npx vitest run tests/core    # one area
npx vitest run -t "blocks a purchase over the per-transaction cap (R1)"   # one test
```

CI runs `npm run check` on every pull request, and a second workflow runs the
offline pipeline through the real orchestrator, posts the findings table as a
PR comment, and uploads the report as an artifact.

## Project structure

```
packages/contracts      shared zod schemas and types (frozen v1)
packages/core           runner, trace proxy, invariants, score, verify, db, orchestrator
packages/sim            deterministic PayPal simulator
packages/cli            payclinic CLI, REST + SSE API, static dashboard hosting
packages/ai             Gemini provider, disk cache, fixture/recording providers
packages/firewall       policy engine, GuardedPayTools, policy YAML
apps/buggy-store        the demo store with the planted bugs
apps/shopping-agent     agent loop, brains, guarded pay tools
apps/dashboard          React + AG Grid dashboard
scenarios/              attack scenario functions B1..B6, A1, A2
fixtures/               traces, AI outputs, reference patches, agent transcripts
docs/                   TECH_DESIGN, ARCHITECTURE, DEVPOST, spikes, plan
```

## Tools disclosure

PayClinic is an independent submission to the PayPal AI Hackathon; it is not
official PayPal software.

- **Built with AI coding agents** (OpenCode) for planning, implementation and
  review; all pass/fail decisions are made by deterministic invariant code, not
  by an LLM.
- **Gemini API** (Google AI Studio) powers the product's explain/prescribe
  features when `AI_PROVIDER=gemini`; the offline demo uses recorded outputs.
- **PayPal Sandbox** is the online-mode target; the offline demo uses a local
  simulator implementing the same Orders v2 subset.
- **AG Grid Community** renders the findings grid and the firewall decision log.
- **Render** hosts the free-tier demo deployment (`render.yaml`).
- Sponsor tools evaluated and not used: APIMatic, Channel3, Bryntum.

## License

MIT.

## Known limitations

- The offline demo's AI explanations and patches are **recorded fixtures**, not
  live model calls; live Gemini calls need your own key and are never required
  for the demo, CI, or judging.
- The agent brain in offline/CI mode is a **deterministic scripted brain**, not
  an LLM; the LLM brain is optional and off by default.
- The API and dashboard are a local demo: SQLite storage, no authentication, no
  multi-user support. Do not expose it publicly beyond the Render demo.
- B6 (refund over-capture) is optional and not part of the demo path.
- The open-PR flow commits to a **demo repository you configure** via
  `GITHUB_TOKEN`/`GITHUB_REPO`; it is not wired to this repository.
- On Render's free tier the first request after idle can take about a minute
  (cold start); the demo video does not depend on the hosted instance.
