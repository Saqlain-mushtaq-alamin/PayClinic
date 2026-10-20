# START HERE: PayClinic agent kit

You have three developers, each driving a coding agent, building **PayClinic** for the PayPal AI Hackathon. This kit is what the agents (and you) work from.

## What is in the box

| Path                                 | What it is                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                          | Rules every agent reads before every task (copy to the repo root as is)                                                               |
| `docs/TECH_DESIGN.md`                | The mechanisms: process model, simulator, trace proxy, runner, invariants, verify loop, AI layer, firewall, DDL, API. Wins over cards |
| `docs/plan/00_INDEX_AND_WORKFLOW.md` | How to run an agent on a card, the status board, order of work, cut order                                                             |
| `docs/plan/PHASE_0…` to `PHASE_4…`   | One file per phase with the task cards (tests first, exact files, commit message)                                                     |
| `docs/CHANGELOG_FROM_V1.md`          | What changed from your first plan and why                                                                                             |
| `docs/TEAM.md`, `docs/SPONSORS.md`   | Templates to fill in on day one                                                                                                       |
| `packages/contracts/`                | **Real, tested code**: shared schemas, API and event contracts, golden traces, test builders                                          |
| `scripts/`                           | Spike script for the real sandbox, generators for golden traces and mock data                                                         |
| `fixtures/mock/mock-data.json`       | Ready mock data so Track C never waits                                                                                                |
| root configs, `.github/`             | TypeScript, Vitest, ESLint, Prettier, CI, CODEOWNERS                                                                                  |

## The first hour

1. Create the GitHub repo; copy this kit into it; `npm install && npm run check` (expect **17 passing tests**). This is card **P0-X01**.
2. All three: 90-minute call for **P0-X02** (review and freeze contracts v1, fill `docs/TEAM.md`).
3. Each: **P0-X03** (accounts and keys, your own). Then the spikes in **P0-X04** (humans, not agents).
4. Start Phase 1 cards in parallel: A01, B01, B03, C01 have no cross-track dependencies.

## Telling an agent to work (paste, replace the id)

```
Implement card <CARD-ID> from docs/plan/<PHASE FILE>.
First read AGENTS.md, then the card, then the TECH_DESIGN sections and contract files it names.
Check "Depends on" (stop and report if something is not merged). Write the tests first and show
them failing, then implement, then run `npm run check`. Touch only the files listed on the card.
Finish with the report format from AGENTS.md section 9. Do not start another card.
```

Review each card's diff yourself before merging; read **[HARD]** cards line by line.

## Dates

Today: Sun Oct 18. Phase 0: Oct 18 to 19. Phase 1: Oct 19 to 23. Phase 2: Oct 24 to 30 (MVP Wed Oct 28). Phase 3: Oct 31 to Nov 6 (freeze Fri Nov 6). Phase 4: Nov 7 to 10 (**submit Tue Nov 10**). Hard deadline Thu Nov 12, 12:00 PM PST.
