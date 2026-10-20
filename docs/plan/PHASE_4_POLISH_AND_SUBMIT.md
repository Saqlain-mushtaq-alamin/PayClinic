# Phase 4: Polish, bug bash, video, submission (Sat Nov 7 to Tue Nov 10)

**Rule:** no new features. Only fixes, polish, the video, and the submission. Buffer: Wed Nov 11 to Thu Nov 12 (hard deadline Thu Nov 12, 12:00 PM PST, about 2:00 AM Fri Nov 13 in Dhaka). **Submit on Tue Nov 10.**

**Exit criteria:** submitted on Devpost with a public repo, public video under 3 minutes, working README, all three members on the team; every link verified from a logged-out browser; tag `v1.0-submitted`.

---

### P4-X01 · Bug bash matrix `[HUMAN + agents for fixes]` ⏱ 4h All (Sat Nov 7)

**Goal:** every person tests the **other two** tracks' work, and fixes are small and safe.

**Procedure:**

1. Each person takes the two tracks they did **not** build and works through the matrix below on a **fresh clone** (not their dev checkout). Record each row as PASS / FAIL with a note in `docs/BUGBASH.md`.
2. Every FAIL becomes a GitHub issue with: steps, expected, actual, screenshot, severity (**blocker** / **major** / **minor**).
3. Fix blockers and majors first. Each fix is one card-sized agent task: "Fix issue #N: write a failing test first, then the smallest change, run `npm run check`." Minor issues are fixed only if trivial.

| #   | Check                                                                                                   | A tests | B tests | C tests |
| --- | ------------------------------------------------------------------------------------------------------- | ------- | ------- | ------- |
| 1   | `npm ci && npm run setup && npm run demo` works with no keys                                            | C       | A       | B       |
| 2   | Dashboard shows three demo runs on first load                                                           | B       | C       | A       |
| 3   | Diagnose B1..B5 from the UI: five findings, score 61                                                    | C       | A       | B       |
| 4   | Open each finding: timeline highlights evidence; debug id visible; replay works                         | B       | C       | A       |
| 5   | Prescribe each finding: stepper advances, finding becomes verified, score rises to 100                  | C       | A       | B       |
| 6   | "Fix all" works and the score ends at 100                                                               | B       | C       | A       |
| 7   | Agent run: diagnose A1+A2 (score 78), Protect (score 100), policy YAML shown, decision log shows blocks | C       | A       | B       |
| 8   | CLI: `npm run payclinic -- run --json` output is valid; `--fix` reaches 100                             | B       | C       | A       |
| 9   | Network off (airplane mode) after setup: the demo still works                                           | A       | B       | C       |
| 10  | Refresh mid-run and mid-prescribe: UI recovers (no blank page, no stuck spinner)                        | C       | A       | B       |
| 11  | Error paths: stop the API while the dashboard is open → clear error with Retry                          | B       | C       | A       |
| 12  | Keyboard only: tab through runs, findings, buttons; focus visible                                       | C       | A       | B       |
| 13  | Dark and light mode both readable; mobile width 390 px not broken                                       | A       | B       | C       |
| 14  | `.env` is not tracked; `git log -p` and `git grep -i "secret\|token\|password"` show no credentials     | B       | C       | A       |
| 15  | Fresh clone from the **public** repo URL (logged-out) works                                             | C       | A       | B       |

**Done when:** `docs/BUGBASH.md` has all rows; no open blocker or major issues. Commit per fix: `fix: <issue title> (#N)`.

---

### P4-A01 · Fresh-clone test `[HUMAN]` ⏱ 1h Track A (someone else verifies)

**Depends on:** P3-A02, P4-X01 · **Blocks:** P4-X02

1. On a **clean machine, container or new user account** with only Node installed: `bash scripts/fresh-clone-check.sh <repo-url>`.
2. Record the elapsed time (target under 10 minutes) and any prompt you had to guess.
3. A person who did **not** write the README repeats it by following the README only.
4. Fix any gap in the README or the scripts.

**Done when:** the script exits 0 and the second person reproduces it. Commit: `docs: fresh-clone verified`.

---

### P4-C01 · Demo video `[HUMAN]` ⏱ 5h Track C leads (Sun Nov 8, redo Mon Nov 9 if needed)

**Goal:** under 3 minutes (**hard limit 3:00**), public on the platform the rules require, captions on.

**Preparation (Sat Nov 7):**

- [ ] Re-read the Devpost video requirements from `docs/SPONSORS.md` (length, platform, any branding rules).
- [ ] Use the **demo database** (`npm run demo` after `--force` seed) and a clean browser profile at 1920×1080, zoom 110%, notifications off.
- [ ] Pre-run everything once so caches are warm; know the exact clicks.
- [ ] Use **one narrator** with a decent microphone in a quiet room; write the script word for word; rehearse until it fits 2:45.
- [ ] Have a **fallback recording** (the IC2 insurance capture, updated) in case a live run fails on camera.
- [ ] Never show `.env`, tokens or the PayPal client secret; check each frame.

**Script (target 2:45):**

| Time      | Beat           | On screen                                                                                               | Narration idea                                                                                                |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | **Hook**       | Customer charged twice (B1 timeline highlight) then an agent buying 10 items it was tricked into buying | "Payment bugs stay silent until real money disappears. Now AI agents can spend it too."                       |
| 0:20–0:40 | **What it is** | Dashboard, tagline: Diagnose · Prescribe · Protect                                                      | "PayClinic attacks a PayPal integration in the sandbox, proves what is broken, fixes it, and proves the fix." |
| 0:40–1:20 | **Diagnose**   | Press Diagnose; scenarios run live; five red findings; score **61**                                     | "Hard invariants decide pass or fail, not an AI opinion."                                                     |
| 1:20–1:55 | **Prescribe**  | Open B1; replay the timeline; AI explanation; diff; press Prescribe; stepper → verified; score rises    | "The AI writes the fix. PayClinic re-runs the same attack. Green means proven."                               |
| 1:55–2:25 | **Protect**    | Agent run; poisoned product; generated policy; re-run → **blocked by R3**; score **100**                | "The same findings become a spending firewall."                                                               |
| 2:25–2:45 | **Impact**     | PR comment in GitHub; fix PR; closing score                                                             | "Run it on every pull request. Make payments, and agents, safe before money moves."                           |

**After recording:** captions reviewed; upload to the required platform; test the link logged out; add the link to `docs/DEVPOST.md`.

**Done when:** the video is public, ≤ 3:00, the link works logged out, and the team has watched it twice. Commit: `docs: demo video link`.

---

### P4-C02 · Devpost submission `[HUMAN]` ⏱ 2h Track C (Mon Nov 9 draft, Tue Nov 10 submit)

**Checklist (tick every item; everyone reviews before pressing submit):**

- [ ] All three members are on the Devpost team and have accepted.
- [ ] Project name, tagline, short description.
- [ ] Long description from `docs/DEVPOST.md` (Inspiration, What it does, How we built it, Challenges, Accomplishments, What we learned, What's next), numbers verified against the latest run.
- [ ] "Built with" tags: PayPal APIs, Gemini, TypeScript, React, AG Grid, SQLite, Fastify, Vitest, Render (only what you really use).
- [ ] Public GitHub URL; repo has LICENSE, README, no secrets in history (`git log -p | grep -i "client_secret\|api_key"` shows nothing real).
- [ ] Demo video link (public, under 3:00).
- [ ] Try-it link (Render URL) **and** the note that offline mode needs no keys; cold-start warning.
- [ ] Screenshots: dashboard with findings, finding with timeline, verified diff, agent Protect with block decisions, PR comment.
- [ ] Sponsor prize selections exactly as decided in `docs/SPONSORS.md` (AG Grid, APIMatic, Render) **with the evidence each requires**.
- [ ] AI-tool disclosure statement if the rules require it.
- [ ] Testing instructions for judges (the README Quickstart, copied).
- [ ] Submitted by **Tue Nov 10**; confirmation email received; every link re-checked from a logged-out browser.

**Done when:** Devpost shows the project as submitted. Commit: `docs: submission record`.

---

### P4-X02 · Final verification and tag `[HUMAN]` ⏱ 1h All (Tue Nov 10, after submitting)

1. Open the submission page logged out; click every link.
2. Clone the public repo to a new directory and run the Quickstart one last time.
3. Confirm `main` equals the commit referenced in the Devpost text; tag it:

```bash
git tag v1.0-submitted && git push --tags
```

4. Do **not** merge anything to `main` after this except a documented critical fix (then re-test the Quickstart and update the tag note).

**Buffer days (Wed Nov 11 to Thu Nov 12):** answer judge questions, fix only critical issues, rest. No features.

---

## Contingency table (if something breaks late)

| Problem                                | Fallback                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Render deploy flaky                    | Local-only demo + the video; say "run locally with two commands" in the Devpost text                                 |
| Open-PR or Action not working          | Show the diff and a manual PR in the video; cut the claim from the text                                              |
| AI patches fail verification           | The reference patches are the fallback by design; recorded AI fixtures still replay; state this honestly in the text |
| LLM agent will not be fooled on camera | Use the scripted or recorded brain; say it is a recorded run                                                         |
| Sandbox outage during recording        | Offline mode (simulator) is the demo; show the saved real traces from `fixtures/traces-online/` if you have them     |
| A teammate is unavailable              | The backups listed in `docs/TEAM.md`; the cut order in `00_INDEX_AND_WORKFLOW.md`                                    |
| Video over 3:00                        | Cut the Impact beat to one sentence; drop the replay beat to 5 seconds                                               |
