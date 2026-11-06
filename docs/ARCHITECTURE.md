# PayClinic architecture

This page summarizes `docs/TECH_DESIGN.md` §1 (the source of truth) and adds the
stage flow a reader needs first. If this file and TECH_DESIGN disagree,
TECH_DESIGN wins.

## The three stages

```
        ┌──────────────┐        ┌───────────────┐        ┌──────────────┐
        │  1 Diagnose  │ ─────▶ │  2 Prescribe  │ ─────▶ │  3 Protect   │
        └──────────────┘        └───────────────┘        └──────────────┘
   attack the target with     AI explains the finding   spending firewall in
   B1..B5 / A1..A2 scenarios, and proposes an exact-   front of the agent's
   record every HTTP step      string patch, then      pay tools blocks the
   as immutable evidence       PROVE it: apply in a    attacks (R1..R5) and
   and run pure invariants     temp copy, re-run the   the score returns to
   (I-01..I-09) → score        scenario, invariants    100 — decided by pure
   drops (61 / 78)             must pass → score 100   code, not by the LLM
```

Pass/fail **never** comes from an LLM. AI generates and explains; deterministic
code (invariants, verify loop, firewall `evaluate()`) decides.

## Process model (TECH_DESIGN §1)

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

- Everything the orchestrator starts uses **port 0** and reports the real port;
  fixed ports are only for long-running dev servers.
- Child processes are always killed in `finally` (SIGTERM, then SIGKILL).
- The trace proxy records every request/response (headers redacted) as steps —
  the evidence the invariants and the AI both read.

## Package map

| Package / app         | Role                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| `packages/contracts`  | frozen zod schemas and types shared by everything                       |
| `packages/core`       | runner, trace proxy, invariants, score, verify loop, db, orchestrator   |
| `packages/sim`        | deterministic PayPal Orders v2 simulator (ids from counters, no random) |
| `packages/cli`        | `payclinic` CLI, REST + SSE API, static dashboard hosting               |
| `packages/ai`         | Gemini provider, disk cache, fixture/recording providers, prompts       |
| `packages/firewall`   | policy engine (`evaluate` R1..R5), `GuardedPayTools`, policy YAML       |
| `apps/buggy-store`    | the demo store with the five planted bugs (B1..B5, B6 optional)         |
| `apps/shopping-agent` | agent loop, brains (scripted / LLM / recorded), guarded pay tools       |
| `apps/dashboard`      | React + AG Grid UI over the REST/SSE API                                |
| `scenarios/`          | the attack scenario functions B1..B6, A1, A2                            |

## Verify loop (why the fix is proven)

1. Copy `apps/buggy-store/` into `.payclinic-tmp/verify-<uuid>/` (excluding
   `node_modules` and databases).
2. Safety checks: at most 5 edits, every file inside `apps/buggy-store/src/`,
   `replace` ≤ 4000 chars, denylist (`child_process`, `eval(`, `process.env`,
   …) — any failure stops before anything runs.
3. Apply each exact-string edit; `search` must occur exactly once.
4. Start the patched copy and re-run the same scenario; invariants must pass.

The working tree is never touched by an AI patch.

## Firewall rule order (first hit decides)

R3 merchant allowlist → R1 per-transaction cap → R2 session budget →
R5 duplicate within window → R4 approval threshold (escalate) → allow.
Amounts compare in minor units; `sessionSpent` grows only after a successful
capture.
