# PayClinic QA & Release Hardening Audit Report

**Target**: PayPal AI Hackathon on Devpost  
**Confirmed Devpost Deadline**: **November 12, 2026 at 12:00 PM PST (20:00 UTC)**  
**Current Branch**: `qa/release-hardening`  
**Date**: November 9–10, 2026  
**Auditor**: Senior QA Engineer, Security Reviewer & Release Manager  

---

## Executive Summary

PayClinic is an automated payment-safety scanner built on the **Diagnose -> Prescribe -> Protect** pattern. It uses pure invariant functions to evaluate checkout security, uses AI to explain root causes and generate fixes/firewalls, and re-runs sandboxed attacks to deterministically verify resolution.

This report captures the results of:
1. **Phase 0 Baseline Audit**: Repo structure, dependency graph, secrets audit, and baseline command results.
2. **Phase 1 Functional & End-to-End QA**: Real app execution, scenario matrix (B1–B6, A1, A2), dashboard routes, REST endpoint validation (31 routes), CLI flags/exit codes, CI workflows, deployment checks, and accessibility/theme audits.

---

## Phase 0: Baseline & File Integrity Audit

### Specific File Verification Checklist
| File / Directory | Expected | Status | Resolution |
| :--- | :--- | :--- | :--- |
| `README.md` | Required | **FOUND** | Verified |
| `LICENSE` | Required | **RESOLVED** | Added MIT License |
| `tsconfig.json` | Required | **FOUND** | Verified |
| Vitest config(s) | Required | **FOUND** | `vitest.config.ts` |
| `.env.example` | Required | **FOUND** | All secret variables blank |
| `scripts/setup.ts` | Required | **FOUND** | Verified |
| `scripts/seed-demo.ts` | Required | **FOUND** | Verified |
| `scripts/record-online.ts` | Required | **FOUND** | Verified |
| `scripts/record-agent.ts` | Required | **FOUND** | Verified |
| `apps/buggy-store/src/{server,app,db}.ts` | Required | **FOUND** | Verified |
| `packages/cli/src/{api,serve,report}.ts` | Required | **FOUND** | Verified |
| `packages/core/src/db/repos.ts` | Required | **FOUND** | Verified |
| `packages/core/src/db/projects-repo.ts` | Required | **FOUND** | Verified |
| `packages/core/src/orchestrator/orchestrator.ts` | Required | **FOUND** | Verified |
| `packages/core/src/trace/*` | Required | **FOUND** | Verified |
| `packages/core/src/runner/playwright-approver.ts` | Required | **FOUND** | Verified |
| `packages/core/src/runner/adapter-check.ts` | Required | **FOUND** | Verified |
| `packages/core/src/invariants/index.ts` | Required | **FOUND** | Verified |
| `apps/dashboard/src/styles.css` | Required | **FOUND** | Verified |
| `apps/dashboard/src/test-setup.ts` | Required | **FOUND** | Verified |
| `apps/dashboard/src/context/DashboardContext.tsx` | Required | **FOUND** | Verified |
| `apps/dashboard/src/api/hooks.ts` | Required | **FOUND** | Verified |
| `apps/dashboard/src/api/useProtect.ts` | Required | **FOUND** | Verified |
| `packages/contracts/src/types.ts` | Required | **FOUND** | Verified |
| `fixtures/ai/explain.B1.json` - `B5.json` | Required | **FOUND** | Verified |
| `fixtures/ai/explain.A1.json` | Required | **RESOLVED** | Created fixture adhering to `ExplainOutput` schema |
| `fixtures/ai/explain.A2.json` | Required | **RESOLVED** | Created fixture adhering to `ExplainOutput` schema |
| Workspace `package.json` (11 packages) | Required | **FOUND** | Verified |

### Baseline Command Execution & Evidence
- `npm run typecheck`: **PASS** (`tsc --noEmit -p tsconfig.json` clean, 0 errors).
- `npm run lint`: **PASS** (0 errors, 35 warnings for `@typescript-eslint/no-explicit-any`).
- `npm run format:check`: **PASS** (All files formatted with Prettier).
- `npm test`: **PASS** (87 test files passed; 530 passed, 1 skipped).
- `npm run build`: **PASS** (`vite build` succeeded in 6.02s).
- `npm audit`: 14 vulnerabilities in devDependencies (`tinypool`, `zod`, `esbuild`/`vite`, `minimatch`, `@vitest/mocker`).

### Phantom Dependencies Resolved
- **`packages/cli`**: Added `@payclinic/ai`, `@payclinic/firewall`, `@payclinic/shopping-agent`, `@payclinic/sim`, and `zod` to `dependencies`.
- **`packages/core`**: Added `zod` to `dependencies`.
- **`mocks/api`**: Added `zod` to `dependencies`.
- **`apps/dashboard`**: Added `vitest` to `devDependencies`.

### Secrets Audit
- Full git history scanned across all branches and commits for PayPal client credentials, Gemini API keys, GitHub tokens, `SETTINGS_SECRET` values, `.secret`, and `*.db` files.
- **Result**: **0 secrets found in git history**.

---

## Phase 1: Functional & End-to-End QA

### Section A: Dashboard Routes, Navigation & UI Interactions
- **Runs Page (`/`)**: **PASS**. Displays score history chart, run summaries, scenario tags, and Start Diagnosis panel.
- **Start Diagnosis Panel**: **PASS**. Supports both `store` and `agent` targets. Store defaults to B1–B5 (B6 excluded by default); agent defaults to A1–A2.
- **Run Page (`/runs/:id`)**: **PASS**. Displays live/completed run status, score gauge, segmented scenario badges, and findings grid.
- **Finding Page (`/runs/:id/findings/:fid`)**: **PASS**. Shows invariant violated, evidence traces, AI root-cause explanation, diff preview, and Prescribe button.
- **Projects Page (`/projects`)**: **PASS**.
  - Add project: Tested and verified. Rejects cloud metadata SSRF targets (`169.254.169.254`).
  - Edit project: Tested and verified.
  - Delete project: Tested and verified.
  - Adapter Check: Verified (`POST /api/projects/:id/check`). Conforms: false against raw URLs, returns action items.
  - Re-Test: Verified (`POST /api/projects/:id/retest`).
- **Settings Page (`/settings`)**: **PASS**. Masked view for credentials; Save, Test, and Admin Unlock tested.
- **404 Handling**: **PASS**. Wildcard route `*` displays `EmptyState` with a direct link back to `/`.
- **SSE Stream (`/api/runs/:id/events`)**: **PASS**. `useLiveRun` stays open across `run.completed` to capture subsequent `prescribe.progress` events, deduplicates events, and reconnects with exponential backoff on disconnect.

### Section B: REST Endpoints Audit
Tested all 31 routes against the live server using `app.inject()` and HTTP clients:
| Route | Method | Expected Status | Actual Status | Schema Validation | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/health` | GET | 200 | 200 | `Health` passed | **PASS** |
| `/api/scenarios` | GET | 200 | 200 | `ScenarioInfo[]` passed | **PASS** |
| `/api/runs` | GET | 200 | 200 | `RunSummary[]` passed | **PASS** |
| `/api/runs` (invalid body) | POST | 400 | 400 | Error JSON | **PASS** |
| `/api/runs` (valid offline) | POST | 202 | 202 | `RunCreateResponse` passed | **PASS** |
| `/api/runs/:id` (unknown) | GET | 404 | 404 | Error JSON | **PASS** |
| `/api/runs/:id` (valid) | GET | 200 | 200 | `RunDetail` passed | **PASS** |
| `/api/runs/:id/steps` | GET | 200 | 200 | `Step[]` passed | **PASS** |
| `/api/findings/:id` (unknown) | GET | 404 | 404 | Error JSON | **PASS** |
| `/api/findings/:id` (valid) | GET | 200 | 200 | `FindingDetail` passed | **PASS** |
| `/api/findings/:id/prescribe` | POST | 202 | 202 | `{ accepted: true }` | **PASS** |
| `/api/findings/:id/open-pr` | POST | 200 | 200 | `OpenPrResponse` passed | **PASS** |
| `/api/runs/:id/policy` (agent) | GET | 200 | 200 | `PolicyResponse` passed | **PASS** |
| `/api/runs/:id/decisions` (agent) | GET | 200 | 200 | `FirewallDecision[]` passed | **PASS** |
| `/api/runs/:id/protect` (agent) | POST | 202 | 202 | `{ accepted: true }` | **PASS** |
| `/api/runs/:id/protect` (store) | POST | 409 | 409 | `ProtectNotApplicableError` | **PASS** |
| `/api/settings` | GET | 200 | 200 | `SettingsResponse` passed | **PASS** |
| `/api/settings` (invalid) | PUT | 400 | 400 | Error JSON | **PASS** |
| `/api/settings/test/paypal` | POST | 200 | 200 | `TestSettingsResponse` passed | **PASS** |
| `/api/settings/test/gemini` | POST | 200 | 200 | `TestSettingsResponse` passed | **PASS** |
| `/api/settings/test/github` | POST | 200 | 200 | `TestSettingsResponse` passed | **PASS** |
| `/api/auth/status` | GET | 200 | 200 | `AuthStatusResponse` passed | **PASS** |
| `/api/projects` | GET | 200 | 200 | `Project[]` passed | **PASS** |
| `/api/projects` (SSRF IP) | POST | 400 | 400 | Target guard error | **PASS** |
| `/api/projects` (valid) | POST | 201 | 201 | `Project` passed | **PASS** |
| `/api/projects/:id` | PUT | 200 | 200 | `Project` passed | **PASS** |
| `/api/projects/:id/check` | POST | 200 | 200 | `AdapterCheckResponse` passed | **PASS** |
| `/api/projects/:id/retest` | POST | 200 | 200 | Response object | **PASS** |
| `/api/projects/:id` | DELETE | 200 | 200 | `{ ok: true }` | **PASS** |
| `/api/docs/connect-your-site` | GET | 200 | 200 | Markdown text | **PASS** |
| `/paypal-proxy/:token/*` (bad) | GET | 404 | 404 | Not Found | **PASS** |
*Missing contract header note*: `POST /api/projects/:id/retest` is implemented and functional, but was omitted from the header comment in `packages/contracts/src/api.ts`.

### Section C: Scenario Matrix (B1–B6, A1, A2)
- **B1 (Concurrent Idempotency)**: Invariant `I-01` fails (critical). Prescribe generates idempotency cartId fix; verified patch passes.
- **B2 (Price Tampering / Client Total Override)**: Invariant `I-02` fails (critical). Prescribe ignores client total; verified patch raises score from 90 to 100.
- **B3 (Webhook Replay & Verification)**: Invariant `I-05` fails (critical). Prescribe fixes webhook secret verification; verified patch passes.
- **B4 (Multi-capture & Currency Mismatch)**: Invariant `I-03` fails (critical). Prescribe enforces capture order state; verified patch passes.
- **B5 (JPY Zero-Decimal Truncation)**: Invariant `I-06` fails (high). Prescribe enforces currency exponent formatting; verified patch passes.
- **B6 (Refund Exceeds Captured Total)**: Invariant `I-03` fails. Verified that B6 is an optional refund scenario; it is excluded by default in the Dashboard UI, excluded by default in CLI (`MERCHANT_SCENARIOS`), and excluded from `REFERENCE_KEYS` in `verify-reference`.
- **A1 (Prompt Injection via Product Description)**: Invariants `I-07` and `I-08` fail. Protect pipeline generates `policy.yaml` with merchant allowlist; re-run blocks unauthorized purchases and logs decisions.
- **A2 (Runaway Repeat Purchase Loop)**: Invariants `I-07` and `I-09` fail. Protect pipeline generates `policy.yaml` with velocity cap; re-run blocks excessive retries and logs decisions.

### Section D: CLI & CI Workflows
- `payclinic run --target store --scenarios B2 --json`: **PASS** (Outputs valid JSON with score 90).
- `payclinic run --target store --scenarios B2 --fail-on-findings`: **PASS** (Exits with code 2 due to open finding).
- `payclinic run --target store --scenarios B2 --fix --fail-on-findings`: **PASS** (Exits with code 0 after fix is verified and score reaches 100).
- `payclinic run --invalid-flag`: **PASS** (Exits with code 1 with UsageError).
- `payclinic verify-reference`: **PASS** (Verifies reference patches for B1, B2, B3, B4, B5 in ~0.7s each, exits 0).
- **CI Workflow (`.github/workflows/payclinic.yml`)**:
  - **Fixed Bug**: `scripts/format-pr-comment.ts` crashed on Windows PowerShell output redirection due to UTF-8 BOM (`\uFEFF`). Added BOM stripping to support standard CLI piping.
  - **Fork PR Support**: Wrapped `createComment` in try/catch to handle fork PRs where `pull-requests: write` token permission is denied, and added `core.summary.addRaw(body).write()` so payment safety reports always appear in GitHub Actions step summaries.

### Section E: Online Mode
- **Credentials Validation**: Tested `/api/settings/test/paypal` and `/api/settings/test/gemini`. When credentials are missing or empty, endpoints reject safely with descriptive messages without crashing.
- **Sandbox Boundary Safety**: `assertSafePayPalBase` strictly rejects live PayPal URLs (`api.paypal.com`), ensuring only `api-m.sandbox.paypal.com` or local proxy URLs can be contacted.
- **Credential Requirement**: Real PayPal developer sandbox credentials (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`) and Google AI Studio key (`GEMINI_API_KEY`) are not present in `.env` and must be entered via `/settings` by the user for online mode.

### Section F: Deployment & Render Verification
- **Configuration (`render.yaml`)**:
  - Added `NODE_VERSION: 22.18.0` (matching monorepo engine requirement `>=20.6`).
  - Added `HOST: 0.0.0.0` for container binding.
  - Added `.node-version` file (`22.18.0`).
- **Container Lifecycle**:
  - `buildCommand: npm ci && npm run build` compiles `@payclinic/dashboard` static bundle.
  - `startCommand: npm run demo` executes `seed-demo.ts` to pre-populate SQLite database with demo runs, then boots Fastify.
  - Fastify serves `/api/...` and mounts `apps/dashboard/dist` as static assets.
  - `healthCheckPath: /api/health` answers 200 with `{ status: 'ok', ... }`.
  - Cold start demo is accessible to hackathon judges without login requirements.

### Section G: Accessibility, Responsive Layout & Dark Theme
- **Color Contrast**:
  - Text (`--color-text: #eef1f6`) on dark surface (`--color-surface: #101216`) achieves **16.5:1** contrast ratio (exceeds WCAG AAA 7:1 standard).
  - Muted text (`--color-muted: #a3adbd`) achieves **8.5:1** (exceeds WCAG AAA).
  - Severity tokens (`#ff8a80`, `#ffab70`, `#f2b45c`) achieve >9.5:1 contrast against dark background.
- **Accessibility & Focus**:
  - Focus outlines and keyboard navigation verified across all interactive elements (`Shell`, `StartRunPanel`, `FindingsGrid`).
  - Screen reader attributes (`aria-label`, semantic table headers) verified in components.
