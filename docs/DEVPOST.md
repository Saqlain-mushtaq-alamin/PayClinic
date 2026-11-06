# Devpost draft

Plain text for the Devpost submission form. Numbers are measured, not hoped
for: store score 61 → 100 with 5/5 bugs fixed and verified, agent score
78 → 100, offline diagnose of B1..B5 in about a second, prescribe+verify of a
single finding in under a second (see `docs/PERF.md`).

## Inspiration

Every checkout integration ships the same fear: money state that quietly goes
wrong. Double charges, wrong amounts, orders marked paid when PayPal said no.
Usually you find these bugs with a handful of integration tests — and the tests
only cover the paths someone remembered to test.

We wanted the opposite: a small set of **business invariants** that must hold
for _any_ trace — "one cart is never captured twice", "the captured amount
equals what the cart costs", "an order is paid if and only if PayPal said
COMPLETED" — and an engine that attacks the checkout, records everything, and
lets those invariants judge the result. And because finding a bug is only half
the work, we added an AI layer that explains the finding and proposes a patch —
but the patch only counts if the engine can **prove** it: same attack, clean
trace.

The same lens applies to AI shopping agents, which is this hackathon's new
attack surface: an agent with a payment tool can be talked into overspending by
a poisoned product description. So PayClinic also ships a spending firewall
that decides with code, not prompts.

## What it does

PayClinic runs three stages against a demo store (and an AI shopping agent):

1. **Diagnose** — scripted scenarios attack the checkout: double-click creates
   two orders for one cart (B1), the browser-supplied total is trusted (B2), a
   webhook is replayed and forged (B3), an order is marked paid before the
   capture result is checked (B4), a zero-decimal currency is sent with
   decimals (B5). Every HTTP step is recorded as immutable evidence. Nine pure
   invariants (I-01..I-09) read the trace and report findings: the store lands
   at **61/100**, the agent at **78/100**.
2. **Prescribe** — the AI layer explains each finding (root cause, impact,
   where in the code) and proposes a patch as exact-string edits. PayClinic
   then **verifies** the patch in a temp copy of the store: apply, restart,
   re-run the same attack, invariants must pass. All five store bugs fix and
   verify — **5/5, score 100** — and the whole offline loop is fast: diagnosing
   B1..B5 takes about 0.9 s, prescribing and verifying one finding about 0.7 s.
3. **Protect** — a spending firewall wraps the agent's payment tools. A prompt
   injection hidden in a product description tells the agent to overspend from
   a non-allowlisted merchant (A1); a runaway retry loop buys the same item
   five times (A2). With the firewall generated from the findings, both attacks
   are blocked — **78 → 100** — with every decision logged with its rule id.

The dashboard shows runs, findings, the recorded trace step-by-step, the AI
explanation and diff, the verify result, and the firewall decision log. From a
verified finding it can open a pull request with the fix on a demo repository.

Everything runs **offline with zero API keys**: a deterministic PayPal
simulator implements the Orders v2 subset, and AI outputs come from recorded
fixtures. Online mode with a real PayPal sandbox and a Gemini key is the same
code path — only the base URL and provider change.

## How we built it

- **TypeScript end to end**, strict mode, Node ≥ 20.6. Workspaces:
  `contracts` (frozen zod schemas), `core` (runner, trace proxy, invariants,
  score, verify loop, SQLite persistence, orchestrator), `sim` (PayPal
  simulator), `cli` (CLI + Fastify REST/SSE API), `ai`, `firewall`,
  `buggy-store`, `shopping-agent`, and a React + **AG Grid Community**
  dashboard.
- **The trace proxy** sits between the store and PayPal, records every
  request/response (redacting authorization headers and tokens), and can inject
  PayPal-Mock-Response headers so scenarios can force declines deterministically.
- **Invariants are pure functions** over the recorded trace plus declared cart
  ground truth; money is handled in minor units with bigint, never floats.
- **Patches are exact-string edits** (`file`, `search`, `replace`), not unified
  diffs — LLMs are reliable at "replace this exact text" and bad at hunk line
  numbers. The verify loop applies them to a copy in a temp directory, with a
  denylist and path checks before anything runs.
- **The AI layer** uses the Gemini API in JSON mode with schema validation and
  one retry, a disk cache, fixture and recording providers, and a template
  fallback so the pipeline never returns an unappliable patch.
- **The firewall** is a pure `evaluate()` (rule order R3 allowlist → R1
  per-transaction cap → R2 budget → R5 dedupe → R4 escalation) wrapped around
  the agent's pay tools; policies serialize to readable YAML.
- **CI**: every pull request runs typecheck, lint and ~445 tests; a separate
  workflow runs the offline pipeline through the real orchestrator, a bot posts
  the findings table as a PR comment, and the report is uploaded as an artifact.
  The demo deploys to Render from a blueprint (`render.yaml`).
- **Development process**: a card-based plan (`docs/plan/`) with
  tests-first cards, one branch per card, and a rule that AI-generated code
  never decides pass/fail. Built with AI coding agents (OpenCode) under that
  constraint.

## Challenges

- **Keeping the LLM out of the judgment seat.** It was tempting to let the
  model "confirm" fixes. We enforced the boundary structurally: invariants,
  score and the firewall are pure code; the AI only explains and proposes.
- **Determinism.** Tests and demos must not depend on wall-clock time, random
  ids, ports or the network. The simulator issues ids from counters
  (`ORD0001`, `CAP0001`), clocks are injected, servers listen on port 0.
- **Trustworthy patches.** Early designs used unified diffs; models kept
  getting hunk offsets wrong. Exact-string edits with an "exactly once" rule
  made failures loud and verification honest.
- **Making failure observable.** A declined capture that still marks the order
  paid (B4) taught us to record _state_ (merchant orders, webhook deliveries)
  alongside the HTTP trace, so invariants can check both.
- **Performance without cheating.** The first naive design booted a store
  process per scenario. Reusing one process, excluding `node_modules` from
  verify copies, and keeping everything in-memory on loopback brought the full
  offline diagnose down to under a second.

## Accomplishments

- **5/5 planted bugs** found by the invariants, explained by the AI layer,
  patched, and **proven fixed** by the verify loop: store score **61 → 100**.
- **Both agent attacks** (prompt injection, runaway retry) blocked by the
  spending firewall with logged decisions: agent score **78 → 100**.
- **Zero-key demo**: a stranger can clone, run two commands, and see the whole
  product offline; the same pipeline runs against the real PayPal sandbox in
  online mode.
- **~445 tests** across 74 files, all green in CI on every pull request, with
  the offline pipeline itself running in CI and its findings table posted as a
  PR comment.
- A deployed free-tier Render instance serving the API and dashboard from one
  process.

## What we learned

- **Invariants beat test cases for money state.** One invariant ("one capture
  per cart") catches bug classes that many point-tests miss, and it keeps
  working on code you did not write.
- **Verification is the product.** An AI-suggested patch is a hypothesis; the
  re-run in a temp copy is what turns it into a fix. This also made the AI
  layer easier to trust: bad proposals simply fail loudly.
- **Determinism is a feature, not a constraint.** Because everything is
  deterministic, CI, the demo, and the verify loop all run in seconds with no
  credentials — and the recorded fixtures make the "AI" part reproducible.
- **Treat model output as data.** Schema-validate everything, redact evidence,
  state in the prompt that content is untrusted — and keep a code-only fallback.

## What's next

- Browser-based buyer approval in online mode (Playwright approver) and card
  payments, completing the real-sandbox story.
- An MCP wrapper so the spending firewall can guard any agent framework's
  payment tools, not just our in-process agent.
- More scenarios and invariants (partial captures, multi-currency carts,
  disputes), and B6 (refund over-capture) in the demo path.
- The open-PR flow hardened for real forks, and a hosted demo with persistent
  storage beyond the free tier.
