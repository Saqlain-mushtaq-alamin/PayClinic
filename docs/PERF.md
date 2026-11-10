# PayClinic Performance & Run-Time Budget ⚡

> **Millisecond-Grade Vulnerability Scans & Ephemeral Sandbox Verification.**  
> _Performance targets, architecture optimizations, and measured offline benchmark numbers._

---

## 📊 Measured Benchmarks vs. Target Budgets

All benchmarks are measured via `tests/perf/perf.test.ts` on Node 22 (Windows / Linux x86_64) running against local loopback services:

| Operation                                 |   Target Budget    |   Measured Wall Time   |  Status  |         Margin of Safety          |
| :---------------------------------------- | :----------------: | :--------------------: | :------: | :-------------------------------: |
| **B1..B5 Store Diagnosis (Offline)**      | $\le 60\text{ s}$  |  **~0.92 s** (925 ms)  | **PASS** | **65x faster** than target budget |
| **Prescribe + Verify (Single Finding)**   | $\le 40\text{ s}$  |  **~0.70 s** (695 ms)  | **PASS** | **57x faster** than target budget |
| **A1/A2 Agent Diagnosis & Firewall Run**  | $\le 30\text{ s}$  |  **~0.48 s** (480 ms)  | **PASS** | **62x faster** than target budget |
| **Full 3-Run Demo Seeding (`seed-demo`)** | $\le 120\text{ s}$ | **~3.20 s** (3,200 ms) | **PASS** | **37x faster** than target budget |
| **Full Vitest Test Suite (554 tests)**    | $\le 60\text{ s}$  |      **~19.2 s**       | **PASS** | **3x faster** than target budget  |

---

## 🚀 Key Performance Architectural Optimizations

### 1. Store Child Process Reuse & Atomic Reset

- **Problem**: Spawning a separate Node.js child process with `tsx` transpilation for every scenario (`B1` through `B5`) introduces 1.5–2.0 seconds of process spin-up latency per scenario.
- **Optimization**: `executeScenarios` boots the buggy store child process **once** on an ephemeral port. Between scenarios, the runner sends an atomic reset command (`POST /__admin/reset` and `POST /__sim/reset`).
- **Result**: Transpilation and V8 warmup costs are incurred once, dropping scenario execution time from ~10 seconds down to **under 1 second**.

### 2. Selective Workspace Copying in Sandbox Verification

- **Problem**: Verifying an AI patch requires applying changes to an isolated copy of the store. Copying the entire directory including `node_modules` (>50,000 files) would take several seconds.
- **Optimization**: `withPatchedStore` employs an intelligent directory filter (`filter: shouldCopy`) that excludes `node_modules`, `.git`, and database files. Node module resolution naturally bubbles up to the workspace root.
- **Result**: Temp sandbox creation takes **less than 15 milliseconds**, allowing candidate patches to be verified instantly.

### 3. Loopback Transparent Trace Proxy

- **Problem**: Remote network round-trips to external APIs introduce 150–400ms of latency per HTTP request.
- **Optimization**: In offline mode, both the transparent trace proxy and the deterministic PayPal simulator run in-memory on local loopback sockets.
- **Result**: End-to-end HTTP request-response-redact cycles complete in **under 2 milliseconds**.

### 4. High-Performance SQLite with WAL Mode

- **Optimization**: The underlying SQLite database uses Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and synchronous normal mode (`PRAGMA synchronous = NORMAL;`).
- **Result**: Concurrent reads and writes by the API server and scenario runner execute with zero lock contention or disk blocking.

### 5. Instant UI Telemetry via Server-Sent Events (SSE)

- **Optimization**: Instead of continuous client-side polling, the dashboard subscribes to an efficient SSE stream (`/api/runs/:id/events`).
- **Result**: UI updates (progress indicators, score gauge recalculations, and finding discoveries) render in real-time as events occur on the server.
