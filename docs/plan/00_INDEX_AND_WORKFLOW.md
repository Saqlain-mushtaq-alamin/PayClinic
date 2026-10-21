# PayClinic Agent Plan: Index and Workflow

**Today:** Sun Oct 18, 2026. **Feature freeze:** Fri Nov 6. **Submit:** Tue Nov 10. **Hard deadline:** Thu Nov 12, 12:00 PM PST.
Three developers (Tracks **A** Engine, **B** Brain & Agent, **C** Experience & Delivery), each driving their own coding agent, in parallel.

## 1. How the files fit together

| File                        | Purpose                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md` (repo root)     | Rules every agent reads before every task                                                                                      |
| `docs/TECH_DESIGN.md`       | The mechanisms: simulator, runner, invariants, verify loop, DDL, API. **Wins over cards** if they disagree                     |
| `packages/contracts/`       | Real, frozen v1 types (zod) + golden traces + test builders (already written and tested)                                       |
| `docs/plan/PHASE_0_…md`     | Setup, contracts freeze, accounts, human spikes (Oct 18 to 19)                                                                 |
| `docs/plan/PHASE_1_…md`     | Foundations: simulator, store, proxy, runner, invariants, AI providers, firewall engine, dashboard on mocks (Oct 19 to 23)     |
| `docs/plan/PHASE_2_…md`     | The merchant loop and the MVP: verify loop, prescribe, API, dashboard detail, agent attacks (Oct 24 to 30; **MVP Wed Oct 28**) |
| `docs/plan/PHASE_3_…md`     | Protect flow, wow features (CI comment, open PR), deploy, freeze (Oct 31 to Nov 6)                                             |
| `docs/plan/PHASE_4_…md`     | Polish, bug bash, video, submission (Nov 7 to 10)                                                                              |
| `docs/CHANGELOG_FROM_V1.md` | What changed from the first plan and why                                                                                       |

## 2. The loop for every card (what you tell your agent)

Paste this, replacing the card id:

```
Implement card <CARD-ID> from docs/plan/<PHASE FILE>.
First read AGENTS.md, then the card, then the TECH_DESIGN sections and contract files it names.
Check "Depends on" (stop and report if something is not merged). Write the tests first and show
them failing, then implement, then run `npm run check`. Touch only the files listed on the card.
Finish with the report format from AGENTS.md section 9. Do not start another card.
```

**Human review of every card (5 minutes):** read the diff for the files in the card only; run `npm run check`; confirm no placeholders (`grep -rn "TODO\|{ \.\.\. }" <changed files>`); merge. Cards tagged **[HARD]** deserve a careful read of the code, not only the tests.

## 3. Card anatomy

```
### <ID> · <title>   [HARD?]   ⏱ <hours>   Track <A|B|C>
Depends on: <card ids>        Blocks: <card ids>
Goal / Read / Files / Spec / Tests / Done when / Pitfalls
```

- **Files** lists everything the card may create or edit. Anything else is off limits.
- **Tests** contains real code, or an exact list of assertions when the code would be long. Tests come first.
- **Done when** is a runnable command plus the commit message.
- Card size is 1 to 3 hours. If a card feels bigger, **stop and report**; do not improvise a split.

## 4. Order of work and dependencies

```
P0 (all) ─▶ P1-A01 ─┬▶ P1-A02 sim ─┬▶ P1-A04 store ─▶ P1-A06 store process+approvers ─▶ P1-A07 scenarios+diagnose ─┐
                    ├▶ P1-A03 db   │                    ▲                                                         ├▶ P1-A09 e2e smoke (IC1)
                    ├▶ P1-A05 proxy ─────────────────────┘                                                         │
                    └▶ P1-A08 invariants I-01,02,04 ───────────────────────────────────────────────────────────────┘
        P0 ─▶ P1-B01 AI providers ─▶ P1-B02 prompts+explain/patch      P1-B03 firewall engine      P1-B04 agent skeleton (after A04)
        P0 ─▶ P1-C01 mock API ─▶ P1-C02 dashboard skeleton ─▶ P1-C03 design system                   P1-B05 agent invariants (after A08)
```

Everything in Phase 2 depends on **IC1** (Phase 1 exit). Tracks never wait for each other during Phase 1 except where a card names a dependency.

## 5. Status board (copy into GitHub Projects; tick when merged)

### Phase 0: Oct 18 to 19

- [x] P0-X01 Install the kit and verify the scaffold (all)
- [x] P0-X02 Review and freeze contracts v1 (all)
- [x] P0-X03 Accounts and credentials (each)
- [x] P0-X04 Human spikes S1 to S5 (A: S1, S2, S5; B: S3, S4; C: S0)
- [x] P0-C01 Repo hygiene, CODEOWNERS, board, branch protection (C)

### Phase 1: Oct 19 to 23

- [ ] P1-A01 Config, sandbox guard, money helpers
- [ ] P1-A02 PayPal simulator [HARD]
- [ ] P1-A03 SQLite layer and repositories
- [ ] P1-A04 Buggy store with planted bugs [HARD]
- [ ] P1-A05 Trace proxy and recorder [HARD]
- [ ] P1-A06 Store process launcher, buyer approvers, scenario context
- [ ] P1-A07 Scenarios B1, B2, B4 and the diagnose pipeline [HARD]
- [ ] P1-A08 Invariant framework with I-01, I-02, I-04
- [ ] P1-A09 End-to-end smoke test (IC1)
- [ ] P1-B01 AI providers, cache, retries
- [ ] P1-B02 Evidence normalization, prompts, explain and patch generation
- [ ] P1-B03 Firewall engine R1 to R5
- [ ] P1-B04 Agent skeleton: PayTools, brains, run loop
- [ ] P1-B05 Agent invariants I-07, I-08, I-09
- [ ] P1-C01 Mock API server with SSE
- [ ] P1-C02 Dashboard skeleton with AG Grid
- [ ] P1-C03 Design system and states
- [ ] P1-C04 Rules and sponsor research, Render hello-world (human + agent)

### Phase 2: Oct 24 to 30 (MVP Oct 28)

- [ ] P2-A01 Scenario B3, webhook chaos, I-05
- [ ] P2-A02 Scenario B5, I-06, I-03 and optional B6
- [ ] P2-A03 Verify loop [HARD]
- [ ] P2-A04 Reference patches B1 to B5 and CI proof [HARD]
- [ ] P2-A05 Orchestrator: diagnose, prescribe, score
- [ ] P2-A06 REST API and SSE
- [ ] P2-A07 CLI and offline fixture recording
- [ ] P2-A08 PlaywrightApprover and online recording
- [ ] P2-B01 Prescribe pipeline with fallbacks
- [ ] P2-B02 Patch evaluation harness and AI fixtures
- [ ] P2-B03 Agent scenarios A1 and A2
- [ ] P2-B04 GuardedPayTools and decision log
- [ ] P2-B05 Policy generation and YAML
- [ ] P2-B06 AI scenario variations (Should)
- [ ] P2-C01 API client, SSE hook, switch mock to real
- [ ] P2-C02 Finding detail: timeline, explanation, diff viewer
- [ ] P2-C03 Prescribe flow UI and live progress
- [ ] P2-C04 GitHub Action skeleton and PR comment formatter
- [ ] P2-X01 MVP integration test (IC2)

### Phase 3: Oct 31 to Nov 6 (freeze Fri Nov 6)

- [ ] P3-A01 Hardening: timeouts, cleanup, port safety
- [ ] P3-A02 Fresh-clone setup and seed
- [ ] P3-A03 Run-time budget and performance
- [ ] P3-B01 Protect pipeline
- [ ] P3-B02 Agent fixtures and optional LLM brain
- [ ] P3-B03 AI-layer injection hardening tests
- [ ] P3-C01 Timeline replay polish
- [ ] P3-C02 Policy view and decision log UI, Protect flow UI
- [ ] P3-C03 Open-PR backend and button
- [ ] P3-C04 GitHub Action end to end
- [ ] P3-C05 Render deployment
- [ ] P3-C06 README and Devpost draft
- [ ] P3-X01 Full demo-path test (IC3) and freeze (IC4)

### Phase 4: Nov 7 to 10

- [ ] P4-X01 Bug bash matrix
- [ ] P4-A01 Fresh-clone test
- [ ] P4-C01 Demo video
- [ ] P4-C02 Devpost submission
- [ ] P4-X02 Final verification and submit

## 6. Rules about cards and time

- **Human-only cards** (accounts, spikes, recording, submitting) are marked `[HUMAN]`. Do not give them to an agent.
- If a card is late by more than half a day, tell the team immediately. Rebalancing rule: a free member takes the next card from the most loaded track (see "Next-up" in each phase).
- **Cut order if time runs out** (cut from the top): bring-your-own-URL, exportable report, AI scenario variations (P2-B06), open-PR (P3-C03), GitHub Action (P3-C04), A2 attack, timeline polish. **Never cut:** simulator, invariants, verify loop, offline mode, score, demo video.

## 7. Model guidance (short)

Use your strongest model for **[HARD]** cards, the contract review, and integration debugging. Cheaper models are fine for the rest **because** the cards give exact signatures and tests. If an agent produces something that passes tests but you do not understand it on a **[HARD]** card, ask it to explain before merging.
