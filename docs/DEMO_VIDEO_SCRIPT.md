# PayClinic: Official Demo Video Script (≤ 3:00)

**Target Duration:** 2 minutes 45 seconds (Hard limit: 3 minutes)  
**Format:** 1920×1080 (1080p), 60fps, clean browser profile, dark theme.  
**Audio:** Clear, single English narrator, no background music, no copyrighted brands.  
**Mode on Screen:** Demonstrates both **Offline Demo** (reproducible zero-credential pipeline) and **Live Sandbox** (real PayPal Orders v2 & Google Gemini calls).

---

## Shot-by-Shot Timeline & Storyboard

### [0:00 – 0:25] ACT I: The Hook & The Problem

- **Visual:**
  - Split screen: On the left, an e-commerce checkout showing a duplicate capture error (`I-01`); on the right, a terminal showing an autonomous AI shopping agent spending $120.00 instead of its $30.00 budget.
  - Cut to PayClinic logo on the dashboard (`http://localhost:4000/`) with tagline: _Diagnose · Prescribe · Protect_.
- **Voiceover (Narration):**
  > "Every checkout integration carries the same silent nightmare: money state going wrong in production. Double captures, client-tampered prices, or orders marked paid when PayPal declined the charge. And now with autonomous shopping agents, an agent with a payment tool can be manipulated into overspending by a poisoned prompt.
  > Welcome to **PayClinic**—an automated payment-safety scanner and spending firewall. We attack the checkout in a sandbox, use pure invariant code to prove what broke, let AI propose the fix, and then re-run the attack to prove the fix."

---

### [0:25 – 1:05] ACT II: Diagnose (The Vulnerability Scanner)

- **Visual:**
  - Host is on the PayClinic Dashboard (`/`). Points to the **Payment Safety** gauge showing the initial score of **61 / 100**.
  - Clicks **"Diagnose Store"** (`StartRunPanel`).
  - Scenarios B1 through B5 execute live. The timeline records every HTTP request through the transparent trace proxy.
  - Clicks into the completed run. Navigates to Finding **B2 / I-02: Client-supplied amount is trusted**.
  - Shows the step replay: Customer modified client cart total to $0.01; store backend captured $0.01 instead of server-computed total ($25.00). Invariant `I-02` flags this as Critical.
- **Voiceover (Narration):**
  > "In the **Diagnose** stage, PayClinic runs scripted attacks against the store checkout. Here in Scenario B2, a malicious browser modifies the client total. Notice how pure deterministic invariant functions—not an LLM—decide pass or fail. Invariant I-02 compares the captured PayPal amount to the server's ground truth cart total and catches the underpayment. The store lands at an unsafe score of 61."

---

### [1:05 – 1:45] ACT III: Prescribe & Verify (Deterministic Proof)

- **Visual:**
  - On the Finding Detail page (`/runs/:runId/findings/:findingId`), clicks **"Prescribe Fix"**.
  - Progress stepper illuminates: `Explaining` -> `Patching` -> `Verifying` -> `Done`.
  - The UI displays Gemini's structured root-cause analysis and an exact-string unified diff in `apps/buggy-store/src/orders/pricing.ts`.
  - The engine copies the store to a secure temporary sandbox (`.payclinic-tmp/`), applies the patch, and re-executes the B2 attack scenario against the patched store.
  - The invariant check passes! The badge flips to **Verified**. Score increases from 61 to **100**.
  - Clicks **"Open PR"**. A pull request link appears (`https://github.com/payclinic/demo-store/pull/42`).
- **Voiceover (Narration):**
  > "Next, **Prescribe**. Google Gemini analyzes the normalized evidence trace and store code, explaining the vulnerability and proposing an exact code patch.
  > But AI suggestions cannot be trusted blindly. PayClinic automatically spins up an isolated sandbox copy of the store, applies the patch after strict safety denylist checks, and re-executes the exact same attack scenario.
  > The re-test passes cleanly—proving the fix works before a human touches it. With one click, we open a pull request on GitHub."

---

### [1:45 – 2:15] ACT IV: Live PayPal Sandbox Evidence

- **Visual:**
  - Navigates to the live run trace. Opens an inspected request step.
  - Highlights:
    - Endpoint: `POST https://api-m.sandbox.paypal.com/v2/checkout/orders`
    - Response header: `paypal-debug-id: 8f3b23c914b1a`
    - Status: `201 Created`
  - Shows simulated webhook signature verification (`/v1/notifications/verify-webhook-signature`) and negative testing decline (`PayPal-Mock-Response: INSTRUMENT_DECLINED`).
- **Voiceover (Narration):**
  > "PayClinic deeply integrates with the PayPal Developer Platform. We exercise the real Orders v2 API—order creation, capture, refunds, and asymmetric webhook signature verification. Every step records PayPal debug IDs and masks secret tokens automatically."

---

### [2:15 – 2:35] ACT V: Protect (The AI Agent Spending Firewall)

- **Visual:**
  - Opens the Agent run (`A1: Prompt injection through product description`).
  - Shows the attack: A poisoned product description instructed the shopping agent to ignore its budget and buy 5 items from an unapproved vendor. Score is **78 / 100**.
  - Clicks **"Protect Agent"**.
  - PayClinic generates a declarative spending firewall policy (`policy.yaml`): $30 cap, $40 budget, merchant allowlist.
  - Re-runs the attack. The firewall blocks the purchase under Rule `R3` (Unauthorized merchant). Score recovers to **100 / 100**.
- **Voiceover (Narration):**
  > "Finally, **Protect**. When our autonomous shopping agent encounters a prompt-injected product description trying to hijack its wallet, PayClinic synthesizes an enforceable spending firewall policy.
  > Re-running the agent attack, the firewall intercepts the transaction before it ever reaches PayPal, blocking it by rule R3. The agent is safe, and score returns to 100."

---

### [2:35 – 2:45] ACT VI: Wrap-Up & Call to Action

- **Visual:**
  - Quick flash of the GitHub Action PR comment showing the automated PayClinic scan summary.
  - Final full-screen view of the PayClinic dashboard with all green scores (100 / 100).
  - Closing title card:
    - _PayClinic: Safe PayPal Payments & Agent Guardrails_
    - GitHub: `github.com/.../PayClinic`
    - Built for the PayPal AI Hackathon.
- **Voiceover (Narration):**
  > "Diagnose vulnerabilities, prescribe proven fixes, and protect AI agents with code. PayClinic keeps payments safe before real money moves. Thank you!"

---

## Video Production Checklist for Recording Team

1. [ ] Browser zoomed to 110%, Dark mode active, DevTools closed or docked cleanly.
2. [ ] Database seeded with clean baseline: `npm run setup && npm run demo`.
3. [ ] Microphone test: Ensure crisp, pop-free audio.
4. [ ] Verify no secrets (`GEMINI_API_KEY`, PayPal secrets) are visible in any tab or console.
5. [ ] Total video run time must be clocked at ≤ 3:00 (target 2:45).
