# PayClinic QA & Release Hardening Audit Report

**Target**: PayPal AI Hackathon on Devpost  
**Confirmed Devpost Deadline**: **November 12, 2026 at 12:00 PM PST (20:00 UTC)**  
**Current Branch**: `qa/release-hardening`  
**Date**: November 9, 2026  
**Auditor**: Senior QA Engineer, Security Reviewer & Release Manager  

---

## Executive Summary

PayClinic is an automated payment-safety scanner built on the **Diagnose -> Prescribe -> Protect** pattern. It uses pure invariant functions to evaluate checkout security, uses AI to explain root causes and generate fixes/firewalls, and re-runs sandboxed attacks to deterministically verify resolution.

This audit establishes the **Phase 0 Baseline** prior to release hardening. The core engine and test suite are functionally strong (529 tests passing), with clean TypeScript compilation and zero leaked credentials in git history. However, several critical gaps must be addressed before Devpost submission:
1. **Missing Open-Source License** (`LICENSE` missing at repo root).
2. **Missing A1/A2 Explain Fixtures** (`fixtures/ai/explain.A1.json`, `fixtures/ai/explain.A2.json`).
3. **Undeclared (Phantom) Workspace Dependencies** across `@payclinic/cli`, `@payclinic/core`, and `@payclinic/mock-api`.
4. **Code Formatting Out of Sync** (238 files failing `format:check`).
5. **Dev-dependency CVEs** (14 vulnerabilities reported by `npm audit`).

---

## 1. Repo Tree & File Integrity Audit

### Specific File Verification Checklist
| File / Directory | Expected | Status | Notes |
| :--- | :--- | :--- | :--- |
| `README.md` | Required | **FOUND** | Present at repo root |
| `LICENSE` | Required | **MISSING** | **P0 Blocker**: Critical for public open-source submission |
| `tsconfig.json` | Required | **FOUND** | Present at repo root |
| Vitest config(s) | Required | **FOUND** | `vitest.config.ts` |
| `.env.example` | Required | **FOUND** | All secret variables blank |
| `scripts/setup.ts` | Required | **FOUND** | Present |
| `scripts/seed-demo.ts` | Required | **FOUND** | Present |
| `scripts/record-online.ts` | Required | **FOUND** | Present |
| `scripts/record-agent.ts` | Required | **FOUND** | Present |
| `apps/buggy-store/src/{server,app,db}.ts` | Required | **FOUND** | All present |
| `packages/cli/src/{api,serve,report}.ts` | Required | **FOUND** | All present |
| `packages/core/src/db/repos.ts` | Required | **FOUND** | Present |
| `packages/core/src/db/projects-repo.ts` | Required | **FOUND** | Present |
| `packages/core/src/orchestrator/orchestrator.ts` | Required | **FOUND** | Present |
| `packages/core/src/trace/*` | Required | **FOUND** | `proxy.ts`, `recorder.ts`, `redact.ts` |
| `packages/core/src/runner/playwright-approver.ts` | Required | **FOUND** | Present |
| `packages/core/src/runner/adapter-check.ts` | Required | **FOUND** | Present |
| `packages/core/src/invariants/index.ts` | Required | **FOUND** | Present |
| `apps/dashboard/src/styles.css` | Required | **FOUND** | Present |
| `apps/dashboard/src/test-setup.ts` | Required | **FOUND** | Present |
| `apps/dashboard/src/context/DashboardContext.tsx` | Required | **FOUND** | Present |
| `apps/dashboard/src/api/hooks.ts` | Required | **FOUND** | Present |
| `apps/dashboard/src/api/useProtect.ts` | Required | **FOUND** | Present |
| `packages/contracts/src/types.ts` | Required | **FOUND** | Present |
| `fixtures/ai/explain.B1.json` - `B5.json` | Required | **FOUND** | B1, B2, B3, B4, B5 present |
| `fixtures/ai/explain.A1.json` | Required | **MISSING** | **P1 Defect**: Missing fixture for Agent scenario A1 |
| `fixtures/ai/explain.A2.json` | Required | **MISSING** | **P1 Defect**: Missing fixture for Agent scenario A2 |
| Workspace `package.json` (11 packages) | Required | **FOUND** | All 11 package manifests present |

---

## 2. Baseline Verification Commands & Evidence

### A. TypeScript Typecheck
- **Command**: `npm run typecheck`
- **Result**: **PASS** (Exit code: 0)
- **Output**:
  ```text
  > typecheck
  > tsc --noEmit -p tsconfig.json
  ```

### B. ESLint
- **Command**: `npm run lint`
- **Result**: **PASS** (Exit code: 0; 0 errors, 35 warnings)
- **Summary**: All 35 warnings are `@typescript-eslint/no-explicit-any` (primarily in test mocks and database row typings). No blocking lint errors.

### C. Prettier Format Check
- **Command**: `npm run format:check`
- **Result**: **FAIL** (Exit code: 1)
- **Summary**: 238 files differ from Prettier formatting standard. Needs `npm run format` across the monorepo.

### D. Full Vitest Test Suite
- **Command**: `npm test` (with loopback permissions for local mock fastify/proxy servers)
- **Result**: **PASS** (Exit code: 0)
- **Output Summary**:
  ```text
  Test Files  87 passed (87)
       Tests  529 passed | 1 skipped (530)
    Duration  19.10s
  ```
- **Skipped Test**:
  - `tests/agent/brains.test.ts > recorded fixtures > a1-llm.json replays as a valid AgentAction transcript` (uses `it.runIf(existsSync(FIXTURE))` — skipped because `fixtures/agent/a1-llm.json` is generated only when running the online LLM recording script).

### E. Monorepo Production Build
- **Command**: `npm run build` (`npm run build -w @payclinic/dashboard`)
- **Result**: **PASS** (Exit code: 0)
- **Output Summary**: Vite production build succeeded in 6.02s:
  - `dist/index.html` (0.41 kB)
  - `dist/assets/index-*.css` (46.14 kB)
  - `dist/assets/index-*.js` (2,070.68 kB)

### F. Security Audit (`npm audit`)
- **Command**: `npm audit`
- **Result**: **14 vulnerabilities** found (10 moderate, 2 high, 2 critical)
  - Critical: `tinypool` (Prototype pollution gadget in worker options / RCE)
  - High: `zod` (<4.6.6 memory exhaustion vulnerability)
  - Moderate: `@vitest/mocker`, `esbuild` / `vite`, `minimatch`

---

## 3. Undeclared (Phantom) Workspace Dependencies

A scan of all `import` statements across packages identified undeclared dependencies that rely on root hoisting:

1. **`packages/cli`**:
   - Uses `zod`
   - Uses `@payclinic/sim`
   - Uses `@payclinic/ai`
   - Uses `@payclinic/firewall`
   - Uses `@payclinic/shopping-agent`
   - *Status*: Undeclared in `packages/cli/package.json`.
2. **`packages/core`**:
   - Uses `zod` (in `config.ts`, `adapter-check.ts`)
   - Uses `@payclinic/sim` (in `orchestrator.ts`, `execute-scenarios.ts`)
   - *Status*: Undeclared in `packages/core/package.json`.
   - *Architecture Note*: `@payclinic/sim` also depends on `@payclinic/core` for `toMinor`/`fromMinor`/`CURRENCY_EXPONENT`, forming a circular dependency if declared directly.
3. **`mocks/api`**:
   - Uses `type { z } from 'zod'`
   - *Status*: Undeclared in `mocks/api/package.json`.
4. **`apps/dashboard`**:
   - Uses `vitest` in unit test files under `src/`
   - *Status*: Undeclared in `apps/dashboard/package.json` devDependencies.

---

## 4. Security & Secret Leak Audit

### Full Git History Audit
- **Command**: Full git commit log and diff search across all commits (`git log --all`).
- **Patterns Checked**:
  - PayPal Client ID / Secret (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`)
  - Google Gemini API Keys (`AIzaSy...`)
  - GitHub Personal Access Tokens (`ghp_...`, `github_pat_...`)
  - `SETTINGS_SECRET` string literals
  - Committed database files (`*.db`, `*.db-journal`, `*.db-wal`)
  - `.secret` files
- **Result**: **0 secrets found in git history**.

### Local Working Tree Audit
- `.env`: Present on disk and confirmed gitignored; all credentials are blank placeholders.
- `data/.secret`: Auto-generated on first run with file mode `0600`; strictly gitignored.
- `data/payclinic.db*`: SQLite database files strictly gitignored.
- Sandbox safety checks: `assertSafePayPalBase` verified in core paths.

---

## 5. Prioritized Action Plan (P0 / P1 / Backlog)

### P0 (Must fix immediately for Hackathon compliance)
1. **Add `LICENSE` file** (MIT License or standard hackathon open-source license) to root.
2. **Declare Phantom Workspace Dependencies**:
   - Add missing dependencies to `packages/cli/package.json`, `packages/core/package.json`, and `mocks/api/package.json`.
   - Resolve `@payclinic/core` <-> `@payclinic/sim` dependency relationship.
3. **Add Missing Fixtures**:
   - Create `fixtures/ai/explain.A1.json` and `fixtures/ai/explain.A2.json` matching the `ExplainOutput` schema for prompt/explain compatibility on agent scenarios.

### P1 (Release Quality & Hygiene)
1. **Run `npm run format`** to bring all 238 files into Prettier compliance and ensure `npm run format:check` passes in CI.
2. **Review dependency vulnerabilities (`npm audit`)**: Upgrade packages where non-breaking fixes exist.
3. **Link & Accessibility Audit**: Verify all external documentation links, Devpost links, and video URLs.

### Backlog (P2 / Post-Submission)
1. Dashboard bundle size optimization (code-splitting large chunks > 500 kB).
2. Clean up `@typescript-eslint/no-explicit-any` warnings in test helpers and repos.
