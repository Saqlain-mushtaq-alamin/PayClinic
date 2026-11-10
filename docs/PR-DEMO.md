# Automated Pull Request Generation Guide 🚀

> **From Verified Sandbox Finding to Real GitHub Pull Request.**  
> _How PayClinic automatically patches vulnerable checkout integrations on your demo repositories._

---

## 🎯 Overview

Once PayClinic discovers an invariant violation (`Diagnose`), analyzes the root cause with Google Gemini, and proves the fix in an isolated temporary sandbox (`Prescribe`), it enables the **Open PR** action.

With one click from the dashboard (or via the REST API), PayClinic:

1. Clones your configured GitHub repository in memory.
2. Applies the verified exact-string patch to the vulnerable store source file.
3. Commits the changes to a dedicated fix branch (`payclinic/fix-<scenario>-<shortId>`).
4. Opens a detailed Pull Request on GitHub containing the root-cause diagnosis, the unified diff, the sandbox verification evidence, and security notes.

> [!IMPORTANT]
> **Use Demo / Fork Repositories Only**  
> Because patches are generated and verified against sandbox attack scenarios, the target repository should be a **test/demo repository or your own fork** (e.g., `your-username/PayClinic` or `your-username/my-store`), never a production repository with real customer checkout traffic.

---

## ⚙️ Configuration

You can configure GitHub integration either via the **Settings** page in the dashboard or via environment variables:

| Variable             | Description                                              | Example / Allowed Format  |
| -------------------- | -------------------------------------------------------- | ------------------------- |
| `GITHUB_TOKEN`       | GitHub Personal Access Token (classic) with `repo` scope | `ghp_1234567890abcdef...` |
| `GITHUB_REPO`        | Target GitHub repository (`owner/repo`)                  | `octocat/my-store`        |
| `GITHUB_BASE_BRANCH` | Base branch to branch off from (Default: `main`)         | `main` or `master`        |

### Setting up via the Dashboard:

1. Open the PayClinic Dashboard (`http://localhost:4000`).
2. Navigate to **Settings** ➔ **GitHub**.
3. Enter your Personal Access Token, repository name (`owner/repo`), and base branch.
4. Click **Save**, then click **Test connection** to confirm the token has write access to your repository.

> [!NOTE]
> If `GITHUB_TOKEN` or `GITHUB_REPO` is not configured, the dashboard's **Open PR** button gracefully displays a disabled tooltip: `GitHub is not configured`. Your GitHub credentials are encrypted at rest with AES-256-GCM and are never returned in plaintext by the API.

---

## 🔄 End-to-End Walkthrough

### 1. Diagnose & Prescribe Fix

1. Execute a diagnostic run against the store (e.g. `B2: Client-Supplied Price Tampering`).
2. Open the finding detail page (`/runs/:runId/findings/:findingId`).
3. Click **"Prescribe Fix"**.
4. Wait for the 4-stage stepper to complete:
   ```
   Explaining ➔ Patching ➔ Verifying ➔ Done
   ```
5. Confirm the finding displays the green **`verified`** badge.

### 2. Open the Pull Request

1. Once the finding is `verified`, the **"Open PR"** button illuminates in the top action bar.
2. Click **"Open PR"**.
3. PayClinic commits the fix and generates the pull request via GitHub's REST API.
4. The button transforms into a green link: **"View PR #X on GitHub"** with the live pull request URL.

---

## 🛡️ Security & Sandbox Safety Rules

Before any code is committed to GitHub, PayClinic enforces four strict security gates:

1. **Deterministic Verification Required**:
   A PR cannot be opened for an unverified finding (`PrNotAllowedError`). The patch must have already passed the scenario attack in the local sandbox.
2. **Directory Confinement**:
   Patches may only touch files inside `apps/buggy-store/src/` or the designated project source root. Modification of configuration files, CI scripts, or package locks is rejected.
3. **AST Security Denylist**:
   Patches containing dangerous constructs (`eval`, `Function`, `child_process`, `process`, `globalThis`, `__proto__`, `.constructor(`) are rejected before execution or commit.
4. **Token Isolation**:
   `GITHUB_TOKEN` is never sent to Gemini prompts, never logged in terminal traces, and never saved in SQLite run steps.
