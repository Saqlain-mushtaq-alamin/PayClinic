# Devpost Submission Form Draft

**Tagline:** Attack a PayPal checkout, prove what broke with pure invariants, let AI prescribe the fix — then prove the fix.

**Built With:**
`PayPal Orders v2 API`, `PayPal Sandbox`, `Google Gemini API (2.5 Flash)`, `TypeScript 5.6`, `Node.js`, `Fastify v4`, `React 18`, `Vite 5`, `AG Grid Community`, `SQLite (WAL mode)`, `Vitest v2`, `Zod`, `Better-Sqlite3`, `Render`

**Try-it Link (Live Demo):** `https://payclinic.onrender.com` _(Note: on Render free tier, initial cold start after idle takes ~50s)_  
**GitHub Repository:** `https://github.com/Saqlain-mushtaq-alamin/PayClinic` _(Public, MIT Licensed, zero secrets)_

---

## Inspiration

Every checkout integration ships with the same fear: money state quietly going wrong in production. Double charges, client-tampered amounts, orders marked paid when PayPal declined, or forged webhooks triggering unauthorized fulfillment. Most teams rely on a handful of integration tests that only cover the narrow paths someone remembered to write.

We wanted the exact opposite: a small set of **pure mathematical business invariants** that must hold for _any_ transaction trace:

- _"One cart is never captured twice"_
- _"The captured amount equals what the server calculated"_
- _"An order is marked paid if and only if PayPal returned COMPLETED"_
- _"Webhooks are cryptographically authenticated and idempotent"_

We built an engine that attacks the checkout in an isolated sandbox, records every HTTP step as immutable evidence, and lets pure invariant code pass or fail the integration. Because discovering a vulnerability is only half the battle, we added an AI prescription layer with Google Gemini that explains the failure and proposes targeted code patches. Crucially, the patch only counts if the engine can **prove** it: PayClinic re-runs the attack against the patched code inside an ephemeral sandbox before marking the finding verified.

The same principles protect autonomous AI shopping agents—the newest attack surface. An agent with payment tools can easily be manipulated by prompt injections in product descriptions. PayClinic synthesizes an enforceable runtime **spending firewall** (`policy.yaml`) that governs payment tools with deterministic code, not prompts.

---

## What it does

PayClinic operates across three automated stages:

1. **🩺 Diagnose** — Scripted attacks simulate real-world vulnerabilities against the store (`B1`–`B5`) and the AI agent (`A1`, `A2`):
   - `B1`: Double-click race conditions producing multiple captures.
   - `B2`: Client-side price tampering (trusting browser-supplied totals).
   - `B3`: Unverified and replayed PayPal webhook events.
   - `B4`: Premature fulfillment before verifying capture completion.
   - `B5`: Formatting errors in zero-decimal currencies (`JPY`).
     Every HTTP request and response is captured through a transparent recording proxy. Nine pure invariants (`I-01`..`I-09`) grade the trace: the store demo starts at **61/100**, and the agent at **78/100**.

2. **💊 Prescribe** — Google Gemini analyzes the trace and source code to produce structured root-cause explanations and targeted code patches. PayClinic then **proves** the patch inside an ephemeral sandbox (`.payclinic-tmp/`): applies the edit, starts the patched store, and re-executes the attack scenario. All five store vulnerabilities verify cleanly — **5/5 verified, score elevates from 61 ➔ 100**. Diagnosing all five bugs takes ~0.9s offline; prescribing and proving a fix takes ~0.7s.

3. **🛡️ Protect** — A runtime spending firewall wraps autonomous agent payment tools (`GuardedPayTools`). When a prompt injection hidden in a product description manipulates the agent into overspending (`A1`), or a runaway retry loop buys the same item repeatedly (`A2`), the firewall intercepts and blocks the tool calls before they reach the network. The agent score returns from **78 ➔ 100**, with every decision logged in real-time.

### Interactive Dashboard Features:

- **Real-Time Telemetry (SSE)**: Watch diagnostics stream live with zero page refreshes.
- **Segmented Animated Gauges**: Smooth visual score transitions between runs.
- **AG Grid Findings & Decision Logs**: High-density interactive data grids with filtering, sorting, and severity badges.
- **HTTP Trace Timeline & Replay**: Inspect every request, response, and PayPal debug ID with automatic credential masking.
- **Unified Diff Viewer**: Side-by-side and inline syntax-highlighted code patches.
- **One-Click GitHub Pull Requests**: Automatically create branches and open PRs with verified fixes.
- **Remote Store Scanner**: Scan external stores via reverse proxy URLs (`/paypal-proxy/:token/*`) protected by SSRF target guards.

---

## How we built it

- **TypeScript End-to-End**: Strict mode across 6 modular packages (`contracts`, `core`, `sim`, `cli`, `ai`, `firewall`) and 3 apps (`buggy-store`, `shopping-agent`, `dashboard`).
- **Transparent Trace Proxy**: In-process proxy capturing raw HTTP exchanges, injecting `PayPal-Mock-Response` headers for negative testing, and sanitizing authorization secrets before persistence.
- **Pure Invariant Code**: Evaluates immutable trace records with integer minor units (`bigint`), completely eliminating floating-point rounding bugs.
- **Deterministic Verification Loop**: Clones the target codebase into temporary isolation, runs an AST denylist check (blocking `eval`, `process`, `globalThis`), applies exact string replacements, and re-tests against the attack.
- **AI Diagnostics & Prescriptions**: Google Gemini (via `@google/genai` and `gemini-2.5-flash`) structured outputs, combined with offline fixture fallbacks for instant $0 zero-credential execution.
- **Declarative Spending Firewall**: Evaluates rule order (`R3 allowlist` ➔ `R1 transaction cap` ➔ `R2 session budget` ➔ `R5 dedupe window` ➔ `R4 approval escalation`) on agent payment tool invocations.
- **Comprehensive Test Suite**: **554 tests across 89 test suites** covering invariants, crypto, proxy routing, firewall evaluation, and UI interactions with 100% green CI.

---

## Challenges we overcame

- **Keeping the LLM out of the judge's seat**: It was tempting to let Gemini decide if a fix was good. We strictly forbade LLM pass/fail decisions: pure invariant code is the sole authority; AI only suggests and explains.
- **True Determinism**: Tests and demos cannot depend on unpredictable wall-clock time, random IDs, or open ports. The simulator uses monotonic sequence counters (`ORD0001`, `CAP0001`), clocks are injected, and processes bind to ephemeral port 0.
- **Trustworthy Code Patches**: Early prototypes attempted unified diffs, but LLMs frequently miscalculated hunk line offsets. We pioneered exact-string replacement tuples (`file`, `search`, `replace`) with strict "occurs exactly once" validation.
- **SSRF Hardening**: External store scanning required robust defense against DNS rebinding, internal subnets, and hex-encoded IPv4-mapped IPv6 evasions.

---

## Accomplishments that we're proud of

- **100% Automated Proof of Fixes**: 5/5 planted checkout vulnerabilities detected, explained, patched, and proven fixed by deterministic code (**61 ➔ 100**).
- **Novel Agent Guardrails**: Demonstrated a working spending firewall that stops real prompt injection attacks against autonomous shopping agents (**78 ➔ 100**).
- **Instant $0 Zero-Key Demo**: A judge or developer can clone the repo and run the full stack offline without entering API keys or spending money.
- **Production-Grade Engineering**: 554 tests, strict TypeScript, zero secret leaks across full git history, AG Grid integration, and clean Render deployment.

---

## What's next for PayClinic

- **Multi-Tenant Team Workspace**: Role-based access control (RBAC) and team projects for enterprise security teams.
- **Model Context Protocol (MCP) Server**: Expose the spending firewall as a universal MCP tool server to guard Claude Desktop, Cursor, and LangChain agents.
- **Passive Webhook Traffic Sniffer**: Continuous staging/production monitoring that evaluates live payment streams without active penetration testing.
