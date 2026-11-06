# PR demo: opening a fix pull request from a verified finding

P3-C03 lets PayClinic turn a **verified** finding into a real pull request on a
GitHub repository. Because the patch was produced by attacking a **sandbox**
PayPal simulator, the target repository must be a **throwaway demo repo or your
own fork** — never a repository with real customers or real code owners.

## Configuration

| Variable             | Meaning                            | Default |
| -------------------- | ---------------------------------- | ------- |
| `GITHUB_TOKEN`       | a classic token with `repo` scope  | —       |
| `GITHUB_REPO`        | `owner/name` of the demo repo/fork | —       |
| `GITHUB_BASE_BRANCH` | branch to fork the fix branch from | `main`  |

If `GITHUB_TOKEN` or `GITHUB_REPO` is missing, `POST /api/findings/:id/open-pr`
answers `200 { "prUrl": null, "reason": "GitHub is not configured" }` and the
dashboard button shows that reason. The token is never logged or returned by
the API.

## How to run the demo

1. Fork (or create) a throwaway repository that contains the PayClinic store
   sources at the same paths (`apps/buggy-store/src/...`).
2. Start the API with the GitHub variables set:

   ```powershell
   $env:GITHUB_TOKEN = "<your token>"
   $env:GITHUB_REPO  = "<your-name>/<your-fork>"
   npm run serve
   ```

3. Diagnose a bug and prescribe a fix so the finding is `verified`
   (offline run + Fix all works: score 61 → 100).
4. Open the pull request:

   ```powershell
   curl -X POST http://127.0.0.1:<api-port>/api/findings/<finding-id>/open-pr
   ```

   or click **Open PR** in the dashboard (once wired into the finding page).

## What the flow does

- Requires the finding to be `verified` with a patch (otherwise
  `PrNotAllowedError`).
- Applies the safety check: only edits under `apps/buggy-store/src/`, at most
  5 edits, denylisted `replace` text is rejected (TECH_DESIGN §8).
- Reads each file from the **base branch**, applies every edit **exactly once**
  (`applyEditsToString` from core) and commits it on
  `payclinic/fix-<scenario>-<short id>`.
- Opens the PR with the explanation, the diff, the verify result and a
  sandbox-safety note in the body.

## Real demo PR

> The human demo PR link is recorded here:

<!--
Paste the link after running the demo, e.g.:
https://github.com/<your-name>/<your-fork>/pull/1
-->
