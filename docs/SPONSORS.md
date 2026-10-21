# Rules and sponsor decisions (fill in during spike S0, by Mon Oct 19)

Source pages: Devpost Rules tab, FAQ, sponsor prize pages. Summarize requirements **in your own words** and link the page.

## Hackathon rules checklist

- [x] Eligibility for Bangladesh, and how prizes are paid out: Eligible. Devpost/PayPal rules exclude only OFAC comprehensively sanctioned countries (Cuba, Iran, North Korea, Syria, Russia, Crimea, Brazil, Quebec). Bangladesh is eligible. Cash prizes paid via wire transfer or PayPal directly through Devpost to team members.
- [x] Team rules (max size, all three registered and added to the Devpost team, prize split): 3 members (Md Al Amin, Rifat Sarkar, Tamim Syeedur). All 3 registered on Devpost and added to the project submission team. Prize split equally among team members.
- [x] "New project" rule (what must have been started after the opening date): Code developed during hackathon window. Clean commit history, scaffold and features built incrementally according to Phase 0-4 roadmap.
- [x] Repo requirements (public, license type): Public GitHub repository (https://github.com/Saqlain-mushtaq-alamin/PayClinic) with standard MIT License.
- [x] Video requirements (length, platform, public/unlisted, branding rules): Max 3:00 minute video hosted on YouTube (public or unlisted). Covers problem, live demo of attack -> invariant detection -> AI explain & patch -> verify loop proof, and firewall policy enforcement.
- [x] Working demo or testing instructions for judges: Dual mode: 100% deterministic offline mode (runs with zero credentials via `npm test` and local simulator) + live hosted demo on Render. Comprehensive README instructions for judges.
- [x] AI-tool disclosure rules: Explicitly disclose Gemini (Google AI Studio) for explanation and patch generation, plus coding assistants used during development. Document that pure invariant code decides pass/fail, not LLMs.
- [x] Trademark rules for the project name and video (PayPal, sponsors): State project is an independent submission for the PayPal AI Hackathon; follow PayPal logo usage guidelines; do not impersonate PayPal official software.
- [x] Submission cutoff in our time zone (Thu Nov 12, 12:00 PM PST = about 2:00 AM Fri Nov 13 in Dhaka): confirmed? Yes, confirmed. Team target submission is Tue Nov 10, 2026 (ahead of deadline).

## Sponsor prizes: decision per prize

| Sponsor  | Requirement (own words)                                                                | Natural fit in PayClinic                             | Decision (pursue / skip) | Evidence we must show                                                                                      |
| -------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| AG Grid  | Integrate AG Grid with interactive data displays, sorting, filtering, custom renderers | Findings grid and decision log use AG Grid Community | pursue                   | Live AG Grid in `apps/dashboard` displaying invariant findings, severity badges, and firewall decision log |
| APIMatic | Integrate APIMatic SDKs or OpenAPI metadata for API consumption/validation             | PayPal API context for the AI layer                  | pursue                   | APIMatic / PayPal API spec definitions fed into prompt evidence builders for accurate patch generation     |
| Render   | Deploy functioning web application / backend on Render platform                        | Free-tier deployment of the offline demo             | pursue                   | `render.yaml` configuration in repo and live running deployment link on Render                             |
| Channel3 | Integrate Channel3 commerce catalog/feed tools                                         | None                                                 | skip                     | N/A                                                                                                        |
| Bryntum  | Integrate Bryntum scheduling/Gantt components                                          | None                                                 | skip                     | N/A                                                                                                        |

## Blocking issues (tell the team the same day)

- None. All eligibility criteria, sponsor requirements, and tool stacks are fully aligned with the technical design.
