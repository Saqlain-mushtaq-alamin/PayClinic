# Performance and Run-Time Budget

PayClinic performance targets and measured offline benchmark numbers.

## Targets vs Measured

| Operation                               | Target Budget     | Measured Wall Time   | Status |
| :-------------------------------------- | :---------------- | :------------------- | :----- |
| **B1..B5 diagnose offline**             | $\le 60\text{ s}$ | ~**0.92 s** (925 ms) | PASS   |
| **Prescribe + verify (single finding)** | $\le 40\text{ s}$ | ~**0.70 s** (695 ms) | PASS   |

_Measurements taken via `tests/perf/perf.test.ts` using vitest and node 22 on Windows._

## Performance Optimizations

1. **Store Process Reuse**:
   - `executeScenarios` boots the buggy store child process once before executing merchant scenarios (`B1`..`B5`).
   - Scenarios communicate over the existing running process; state is cleanly reset between runs via `POST /__admin/reset` and `POST /__sim/reset`.
   - The startup and transpilation cost of `tsx` is incurred only once rather than once per scenario.

2. **Exclusion of `node_modules` in Verification**:
   - When verifying candidate fixes in `withPatchedStore`, directory copying excludes `node_modules` and database files (`filter: shouldCopy`).
   - Symlinks or shared parent resolution avoid copying tens of thousands of files, keeping temp workspace creation nearly instantaneous (< 20 ms).

3. **Offline Invariant Evaluation**:
   - Trace proxy and simulator run in-memory on loopback ports, removing all internet dependency and remote PayPal round-trip latency.
   - Prescribe fixture provider reads pre-recorded outputs directly from disk with deterministic verification.
