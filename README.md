# PayClinic

**Attack a PayPal checkout, prove what broke, let AI propose the fix — then prove the fix.**

PayClinic runs deterministic attacks against a demo store's PayPal checkout and
an AI shopping agent, decides what is broken with **pure invariant functions**,
uses AI **only** to explain and propose fixes, and re-runs the attack to prove
each fix. A spending firewall then blocks the agent attacks at runtime.

> AI generates and explains. Deterministic code decides.

> [!WARNING]
> The vulnerabilities in `apps/buggy-store` (B1–B6) and the poisoned item in `apps/buggy-store/src/catalog.ts` are **intentional demo vulnerabilities** designed to demonstrate PayClinic's deterministic invariant scanner and AI prescription verification. Do not copy or deploy the buggy-store implementation to production.

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

## Tech Stack

- **Runtime & Language:** Node.js (>=20.6), TypeScript (v5.6, strict mode, ES modules).
- **Backend & APIs:** Fastify v4, Server-Sent Events (SSE), SQLite via `better-sqlite3` with WAL mode.
- **Frontend Dashboard:** React 18, Vite 5, AG Grid Community v32, Lucide React icons, dark theme styling.
- **Testing & Verification:** Vitest v2, `@testing-library/react`. 554 tests across 89 files.
- **PayPal Integration:** PayPal Orders v2 REST API, Webhooks v1 signature verification, Sandbox negative testing headers (`PayPal-Mock-Response`).
- **AI Integration:** Google Gemini API (`@google/genai`, `gemini-2.5-flash`), structured JSON outputs, zero-temperature deterministic prompts.

## Environment Variables

| Variable                | Description                 | Default                          | Allowed Values / Format                                                     |
| ----------------------- | --------------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `PAYCLINIC_MODE`        | Pipeline mode               | `offline`                        | `offline` (simulator + fixtures) \| `online` (live PayPal sandbox + Gemini) |
| `BUYER_APPROVER`        | Buyer approval method       | `sim`                            | `sim` (auto) \| `manual` (web browser) \| `playwright` \| `card`            |
| `AI_PROVIDER`           | AI diagnostic provider      | `fixture`                        | `fixture` (cached) \| `gemini` (live Google AI Studio) \| `fake`            |
| `AI_RECORD`             | Save Gemini outputs to disk | `0`                              | `0` \| `1`                                                                  |
| `PAYPAL_BASE_URL`       | Target PayPal URL           | `http://127.0.0.1:4010`          | `https://api-m.sandbox.paypal.com` (sandbox only, never live)               |
| `PAYPAL_CLIENT_ID`      | Sandbox Client ID           | `""`                             | PayPal Developer Sandbox App Client ID                                      |
| `PAYPAL_CLIENT_SECRET`  | Sandbox Secret              | `""`                             | PayPal Developer Sandbox App Client Secret                                  |
| `PAYPAL_BUYER_EMAIL`    | Sandbox Buyer Email         | `""`                             | Personal Sandbox test buyer email                                           |
| `PAYPAL_BUYER_PASSWORD` | Sandbox Buyer Password      | `""`                             | Personal Sandbox test buyer password                                        |
| `GEMINI_API_KEY`        | Google AI Studio Key        | `""`                             | Google AI Studio Gemini API Key                                             |
| `GEMINI_MODEL`          | Gemini Model ID             | `gemini-2.5-flash`               | `gemini-2.5-flash` \| `gemini-1.5-flash` \| `gemini-2.5-pro`                |
| `PAYCLINIC_ADMIN_TOKEN` | Admin protection token      | `""` (unauthenticated)           | Optional Bearer token protecting `/api/settings` and project writes         |
| `SETTINGS_SECRET`       | Encryption secret           | Auto-generated in `data/.secret` | 32+ character or 64 hex character AES-256-GCM secret                        |
| `GITHUB_TOKEN`          | GitHub PAT                  | `""`                             | Optional token for opening fix pull requests on demo repos                  |
| `API_PORT`              | Fastify REST/SSE API port   | `4000`                           | integer (default: 4000)                                                     |
| `SIM_PORT`              | Standalone simulator port   | `4010`                           | integer (default: 4010)                                                     |
| `MOCK_API_PORT`         | Mock server port            | `4001`                           | integer (default: 4001)                                                     |
| `DASHBOARD_PORT`        | Vite development port       | `5173`                           | integer (default: 5173)                                                     |
| `DB_PATH`               | SQLite database file        | `./data/payclinic.db`            | filesystem path                                                             |

## Meaningful PayPal Developer Platform Integration

PayClinic exercises core PayPal developer platform capabilities across all layers of the application:

1. **Orders v2 API (`/v2/checkout/orders`)**:
   - `POST /v2/checkout/orders`: Creates orders with currency validation, item breakdowns, and idempotency headers (`PayPal-Request-Id`).
   - `POST /v2/checkout/orders/:id/capture`: Authorizes and captures payments, testing capture status verification and double-capture defenses.
   - `GET /v2/checkout/orders/:id`: Queries authoritative order status from PayPal.
2. **Payments v2 API (`/v2/payments/captures/:id/refund`)**:
   - Handles partial and full refunds, verifying that refund amounts cannot exceed captured totals (`REFUND_AMOUNT_EXCEEDED`).
3. **Webhooks v1 Signature Verification (`/v1/notifications/verify-webhook-signature`)**:
   - Verifies asymmetric cryptographic signatures (`paypal-auth-assertion`, `paypal-transmission-sig`, `paypal-cert-url`) to detect forged webhooks and replay attacks before side-effects occur.
4. **Negative Testing & Simulation (`PayPal-Mock-Response`)**:
   - Injects mock application codes (e.g. `INSTRUMENT_DECLINED`) into real sandbox requests to prove store decline handling and recovery.
5. **Trace Proxy with Automated Secret Redaction (`packages/core/src/trace/`)**:
   - Transparent in-process proxy that logs every request/response with its `paypal-debug-id` while redacting authorization tokens and client secrets.

## Meaningful AI Integration (Gemini & Agent Firewall)

1. **Root-Cause Analysis (Explain)**:
   - When invariants fail, Google Gemini analyzes the normalized evidence trace, PayPal error structures, and relevant store source code to produce a structured explanation (`rootCause`, `impact`, `whereInCode`, `fixSummary`).
2. **Deterministic Patch Generation (Prescribe)**:
   - Gemini proposes targeted code fixes as exact search/replace tuples (`file`, `search`, `replace`).
   - All AI patches are subjected to an AST/safety check (`packages/core/src/verify/safety.ts`) that denies dangerous constructs (`eval`, `child_process`, `process`, `globalThis`, etc.).
3. **Verification Loop (Prove the Fix)**:
   - PayClinic never trusts AI blindly. It applies the patch inside an ephemeral sandbox directory (`.payclinic-tmp/`), re-runs the attack scenario, and confirms that pure invariants pass. A patch is marked `verified` only when deterministic code confirms it.
4. **AI Shopping Agent Spending Firewall (Protect)**:
   - When an autonomous shopping agent is manipulated by a prompt-injection attack in a product description (A1), PayClinic synthesizes an enforceable spending firewall policy (`policy.yaml`).
   - The pure code firewall intercepts tool calls at runtime, evaluating merchant allowlists (R3), transaction caps (R1), session budgets (R2), and deduplication windows (R5), neutralizing the attack before calls reach PayPal.
5. **Honest Operational Mode Labeling**:
   - The UI displays an explicit badge: `Offline demo` (using recorded fixtures and local simulator for $0 zero-credential review) vs `Live sandbox` (making live calls to Google AI Studio and PayPal Sandbox).

## Tech Stack

- **Runtime & Language:** Node.js (>=20.6), TypeScript (v5.6, strict mode, ES modules).
- **Backend & APIs:** Fastify v4, Server-Sent Events (SSE), SQLite via `better-sqlite3` with WAL mode.
- **Frontend Dashboard:** React 18, Vite 5, AG Grid Community v32, Lucide React icons, dark theme styling.
- **Testing & Verification:** Vitest v2, `@testing-library/react`. 554 tests across 89 files.
- **PayPal Integration:** PayPal Orders v2 REST API, Webhooks v1 signature verification, Sandbox negative testing headers (`PayPal-Mock-Response`).
- **AI Integration:** Google Gemini API (`@google/genai`, `gemini-2.5-flash`), structured JSON outputs, zero-temperature deterministic prompts.

## Environment Variables

| Variable | Description | Default | Allowed Values / Format |
|---|---|---|---|
| `PAYCLINIC_MODE` | Pipeline mode | `offline` | `offline` (simulator + fixtures) \| `online` (live PayPal sandbox + Gemini) |
| `BUYER_APPROVER` | Buyer approval method | `sim` | `sim` (auto) \| `manual` (web browser) \| `playwright` \| `card` |
| `AI_PROVIDER` | AI diagnostic provider | `fixture` | `fixture` (cached) \| `gemini` (live Google AI Studio) \| `fake` |
| `AI_RECORD` | Save Gemini outputs to disk | `0` | `0` \| `1` |
| `PAYPAL_BASE_URL` | Target PayPal URL | `http://127.0.0.1:4010` | `https://api-m.sandbox.paypal.com` (sandbox only, never live) |
| `PAYPAL_CLIENT_ID` | Sandbox Client ID | `""` | PayPal Developer Sandbox App Client ID |
| `PAYPAL_CLIENT_SECRET` | Sandbox Secret | `""` | PayPal Developer Sandbox App Client Secret |
| `PAYPAL_BUYER_EMAIL` | Sandbox Buyer Email | `""` | Personal Sandbox test buyer email |
| `PAYPAL_BUYER_PASSWORD` | Sandbox Buyer Password | `""` | Personal Sandbox test buyer password |
| `GEMINI_API_KEY` | Google AI Studio Key | `""` | Google AI Studio Gemini API Key |
| `GEMINI_MODEL` | Gemini Model ID | `gemini-2.5-flash` | `gemini-2.5-flash` \| `gemini-1.5-flash` \| `gemini-2.5-pro` |
| `PAYCLINIC_ADMIN_TOKEN` | Admin protection token | `""` (unauthenticated) | Optional Bearer token protecting `/api/settings` and project writes |
| `SETTINGS_SECRET` | Encryption secret | Auto-generated in `data/.secret` | 32+ character or 64 hex character AES-256-GCM secret |
| `GITHUB_TOKEN` | GitHub PAT | `""` | Optional token for opening fix pull requests on demo repos |
| `API_PORT` | Fastify REST/SSE API port | `4000` | integer (default: 4000) |
| `SIM_PORT` | Standalone simulator port | `4010` | integer (default: 4010) |
| `MOCK_API_PORT` | Mock server port | `4001` | integer (default: 4001) |
| `DASHBOARD_PORT` | Vite development port | `5173` | integer (default: 5173) |
| `DB_PATH` | SQLite database file | `./data/payclinic.db` | filesystem path |

## Meaningful PayPal Developer Platform Integration

PayClinic exercises core PayPal developer platform capabilities across all layers of the application:

1. **Orders v2 API (`/v2/checkout/orders`)**:
   - `POST /v2/checkout/orders`: Creates orders with currency validation, item breakdowns, and idempotency headers (`PayPal-Request-Id`).
   - `POST /v2/checkout/orders/:id/capture`: Authorizes and captures payments, testing capture status verification and double-capture defenses.
   - `GET /v2/checkout/orders/:id`: Queries authoritative order status from PayPal.
2. **Payments v2 API (`/v2/payments/captures/:id/refund`)**:
   - Handles partial and full refunds, verifying that refund amounts cannot exceed captured totals (`REFUND_AMOUNT_EXCEEDED`).
3. **Webhooks v1 Signature Verification (`/v1/notifications/verify-webhook-signature`)**:
   - Verifies asymmetric cryptographic signatures (`paypal-auth-assertion`, `paypal-transmission-sig`, `paypal-cert-url`) to detect forged webhooks and replay attacks before side-effects occur.
4. **Negative Testing & Simulation (`PayPal-Mock-Response`)**:
   - Injects mock application codes (e.g. `INSTRUMENT_DECLINED`) into real sandbox requests to prove store decline handling and recovery.
5. **Trace Proxy with Automated Secret Redaction (`packages/core/src/trace/`)**:
   - Transparent in-process proxy that logs every request/response with its `paypal-debug-id` while redacting authorization tokens and client secrets.

## Meaningful AI Integration (Gemini & Agent Firewall)

1. **Root-Cause Analysis (Explain)**:
   - When invariants fail, Google Gemini analyzes the normalized evidence trace, PayPal error structures, and relevant store source code to produce a structured explanation (`rootCause`, `impact`, `whereInCode`, `fixSummary`).
2. **Deterministic Patch Generation (Prescribe)**:
   - Gemini proposes targeted code fixes as exact search/replace tuples (`file`, `search`, `replace`).
   - All AI patches are subjected to an AST/safety check (`packages/core/src/verify/safety.ts`) that denies dangerous constructs (`eval`, `child_process`, `process`, `globalThis`, etc.).
3. **Verification Loop (Prove the Fix)**:
   - PayClinic never trusts AI blindly. It applies the patch inside an ephemeral sandbox directory (`.payclinic-tmp/`), re-runs the attack scenario, and confirms that pure invariants pass. A patch is marked `verified` only when deterministic code confirms it.
4. **AI Shopping Agent Spending Firewall (Protect)**:
   - When an autonomous shopping agent is manipulated by a prompt-injection attack in a product description (A1), PayClinic synthesizes an enforceable spending firewall policy (`policy.yaml`).
   - The pure code firewall intercepts tool calls at runtime, evaluating merchant allowlists (R3), transaction caps (R1), session budgets (R2), and deduplication windows (R5), neutralizing the attack before calls reach PayPal.
5. **Honest Operational Mode Labeling**:
   - The UI displays an explicit badge: `Offline demo` (using recorded fixtures and local simulator for $0 zero-credential review) vs `Live sandbox` (making live calls to Google AI Studio and PayPal Sandbox).

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

## Data Privacy & AI Disclosure

- **AI Diagnostics:** When running diagnostics in online mode (`AI_PROVIDER=gemini`), sanitized checkout trace steps and relevant store source code are sent to Google Gemini via the Gemini API to analyze root causes and propose fixes.
- **Secret Redaction:** All sensitive credentials—including PayPal client secrets, OAuth bearer tokens, webhook assertion signatures, and admin tokens—are automatically masked with `***` prior to storage, display, or transmission to external models.
- **Pull Request Automation:** When clicking **Open PR**, PayClinic uses your configured GitHub Personal Access Token to commit fix patches and open a pull request on your designated repository. Your GitHub token is never stored in plaintext in the database or returned via the API.
- **Public Deployment Security:** On public deployments (such as Render), setting `PAYCLINIC_ADMIN_TOKEN` secures the `/api/settings` and project mutation endpoints behind HTTP Bearer token authentication.

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
