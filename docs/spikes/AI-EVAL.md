# AI-EVAL: Patch Evaluation Harness & Offline Fixtures

Date / who: Sun Oct 25, 2026 / Track B (Brain & Agent)

## Goal

Measure how reliably the model explains and produces verified patches for merchant scenarios B1..B5, and record validated outputs as offline fixtures (`fixtures/ai/explain.B*.json`, `fixtures/ai/patch.B*.json`) so offline test runs and demos can replay real AI output without requiring live Gemini API credentials.

## Evaluation Harness (`scripts/eval-patches.ts`)

The evaluation script runs offline diagnosis across merchant scenarios B1 through B5, feeds evidence steps into `prescribe()` using `RecordingProvider` wrapped around `GeminiProvider`, and tests the AI patch in isolation using `createVerify`.

```bash
GEMINI_API_KEY=... GEMINI_MODEL=gemini-2.5-pro npx tsx scripts/eval-patches.ts
```

## Results

```
Scenario | AI Patch | Verified | Attempts | Time (s) | Fallback
---------+----------+----------+----------+----------+---------
B1       | yes      | yes      | 1        | 1.4      | no
B2       | yes      | yes      | 1        | 0.9      | no
B3       | yes      | yes      | 1        | 2.2      | no
B4       | yes      | yes      | 1        | 1.5      | no
B5       | yes      | yes      | 1        | 1.1      | no
AI verified: 5/5
```

## Summary

- **Total Scenarios Evaluated**: 5 (B1, B2, B3, B4, B5)
- **AI Patches Produced**: 5/5 (100%)
- **AI Patches Verified**: 5/5 (100%)
- **Fallback Template Used**: 0/5
- **Exit Code**: 0 (>= 4/5 required)

All 5 merchant scenarios produce valid explanations conforming to `ExplainOutput` and verified patches conforming to `PatchOutput`. All fixtures are committed under `fixtures/ai/` and guarded continuously in CI by `tests/ai/fixtures-verify.test.ts`.
