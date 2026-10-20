# Phase 0: Setup, contracts freeze, accounts, human spikes

**Dates:** Sun Oct 18 to Mon Oct 19. **Goal:** everyone has the same working repo, the contracts are frozen, accounts exist, and the three risky unknowns are answered **by humans** before agents build on them.
**Exit criteria:** `npm run check` is green on `main`; tag `contracts-v1` exists; each member has sandbox + AI keys; `docs/spikes/S1..S5.md` filled in; `BUYER_APPROVER` for online mode decided.

---

### P0-X01 · Install the kit and verify the scaffold `[HUMAN]` ⏱ 0.5h All

**Depends on:** none · **Blocks:** everything

1. Create the GitHub repo (public, MIT license). Copy the contents of this kit into it (root files, `docs/`, `packages/contracts/`, `scripts/`, `tests/`, `fixtures/`, `.github/`).
2. `npm install && npm run check`.
3. **Expected:** typecheck passes, lint passes (2 warnings about `any` in `tests/contracts` are fine), `npm test` shows **17 passing tests**.
4. Push to `main`. Confirm the GitHub Actions run is green.

**Done when:** CI is green on `main` and every member can run `npm run check` locally. Commit message: `chore: import PayClinic kit`.

---

### P0-X02 · Review and freeze contracts v1 `[HUMAN]` ⏱ 1.5h All (together, one call)

**Depends on:** P0-X01 · **Blocks:** all Phase 1 cards

The contracts are written. Your job is to **read them and challenge them now**, because after the freeze every change costs a coordination round.

Checklist, tick each on the call:

- [ ] Read `packages/contracts/src/types.ts` top to bottom. Does every field you will need exist? (A: Step, RunState, Finding, VerifyResult. B: Policy, GuardRequest, GuardHistory, FirewallDecision, AI outputs. C: RunDetail, FindingDetail, Score, RunEvent.)
- [ ] Read `api.ts` and `events.ts`. Does every screen C plans have an endpoint?
- [ ] Read `docs/TECH_DESIGN.md` sections 1 to 8 aloud. Raise anything unclear **now**.
- [ ] Open the four golden traces in `packages/contracts/src/samples/traces/`. Walk through `b1-duplicate-order.json` and check it matches how you imagine the store and the proxy behave.
- [ ] Agree the daily sync time and write it into `docs/TEAM.md` (names, GitHub usernames, tracks, sync time).

If a change is needed: make it in **one PR to `packages/contracts`**, update the sample/test, get both other members to approve, merge, then continue. After this call, tag:

```bash
git tag contracts-v1 && git push --tags
```

**Done when:** the tag exists and `docs/TEAM.md` is committed. Commit: `docs: team file and contracts v1 freeze`.

---

### P0-X03 · Accounts and credentials `[HUMAN]` ⏱ 1h Each member

**Depends on:** none

Each member separately (so test data and rate limits never collide):

1. **PayPal Developer** account → Dashboard → Apps & Credentials → Sandbox → create an app. Note client id and secret.
2. Sandbox → Testing Tools → Sandbox Accounts: make sure you have one **Business** (merchant) and one **Personal** (buyer) account. Note the buyer email and password.
3. **Google AI Studio** → create an API key (your own project). Note the key.
4. Copy `.env.example` to `.env` and fill the values. `.env` must never be committed (it is git-ignored; verify with `git status`).
5. Check which Gemini model has the best free limits for you: AI Studio → rate limits page. Write the model id in `.env` as `GEMINI_MODEL`.

**Done when:** `.env` is filled locally and `git status` does not list it.

---

### P0-X04 · Human spikes `[HUMAN]` ⏱ 4h total A: S1, S2, S5 · B: S3, S4 · C: S0

**Why humans:** each spike answers a question the plan depends on. An agent cannot decide this for you. Write each answer in `docs/spikes/<id>.md` using the template at the end of this card, then commit.

**S0 (C): Rules and sponsors.** Read the Devpost Rules tab, FAQ, and the sponsor pages (AG Grid, APIMatic, Render). Fill the checklist in `docs/SPONSORS.md`: eligibility for Bangladesh and payout, team rules and all three members added to the Devpost team, license requirement, video requirements, what each sponsor prize needs, AI-tool disclosure, submission cutoff in your time zone. **If anything blocks you, tell the team today.**

**S1 (A): Can you talk to the real sandbox?**

```bash
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npx tsx scripts/spikes/s1-sandbox-order.ts
# open the printed approval link, log in with the SANDBOX buyer account, approve, then:
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npx tsx scripts/spikes/s1-sandbox-order.ts --capture <ORDER_ID>
```

Record: HTTP statuses, `paypal-debug-id`, whether the order approval link works, how long it takes.

**S2 (A): How will online mode approve orders automatically?** (the riskiest unknown). Try in this order and stop at the first that works reliably 3 times in a row:

1. **playwright**: write a throw-away script with Playwright that opens the approval link, logs in with the buyer account and clicks approve/continue. Note whether PayPal shows bot checks, 2FA or CAPTCHA.
2. **card**: check if your sandbox app can create orders with a `payment_source.card` using a sandbox test card (this needs the advanced card capability on the sandbox business account).
3. **manual**: a human clicks approve while recording fixtures (always works).
   Decision: set `BUYER_APPROVER` to `playwright`, `card`, or `manual` in `docs/spikes/S2.md`. **Offline mode never depends on this** (it uses `sim`), so a failed S2 costs nothing except "real" recordings being manual.

**S3 (B): Gemini limits.**

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models/$GEMINI_MODEL:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Reply with the JSON {\"ok\":true}"}]}],"generationConfig":{"responseMimeType":"application/json"}}'
```

Run it 20 times in a row (loop with `sleep 1`). Record: how many succeeded, when HTTP 429 appeared, the best model id. Write the limits shown in the AI Studio console.

**S4 (B): PayPal Agent Toolkit.** In 30 minutes: follow the PayPal Agent Toolkit / MCP docs, run it against your sandbox app, list which tools exist, and try creating an order. Record: works / does not work, tool names, any confirmation behavior. **Decision:** the plan uses our own thin `PayTools` over the Orders API (TECH_DESIGN §10); the Toolkit is an optional adapter only if S4 worked easily.

**S5 (A): negative-testing header.**

```bash
... npx tsx scripts/spikes/s1-sandbox-order.ts --capture <APPROVED_ORDER_ID> --mock INSTRUMENT_DECLINED
```

Record whether the sandbox returns the decline for create/capture/refund calls.

**Template for `docs/spikes/<id>.md`:**

```
# <ID> result
Date / who:
What I tried (exact commands):
What happened (statuses, ids, timings):
Decision:
What this changes in the plan (if anything):
```

**Done when:** all six files exist and `BUYER_APPROVER` for online mode is decided. Commit: `docs: spike results`.

---

### P0-C01 · Repo hygiene, board, branch protection `[HUMAN]` ⏱ 1h C

**Depends on:** P0-X01

1. Replace `@member-a/b/c` in `.github/CODEOWNERS` with the real GitHub usernames.
2. GitHub → Settings → Branches → protect `main`: require the **CI** check to pass; require a PR review **only** for changes touching `packages/contracts` (use a CODEOWNERS-based rule or enforce by team agreement).
3. Create a GitHub Project board with the status board from `00_INDEX_AND_WORKFLOW.md` section 5 (one issue per card; title = card id + title).
4. Add the agent runner configuration your tool needs so that `AGENTS.md` is read automatically (for OpenCode: confirm the rules-file name in its docs; if it expects `AGENTS.md` at the repo root nothing else is needed).

**Done when:** a test PR from a branch named `c/test` triggers CI and merges once green. Delete the branch afterwards.
