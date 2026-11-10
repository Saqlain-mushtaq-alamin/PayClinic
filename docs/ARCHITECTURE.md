# PayClinic System Architecture 🩺⚡

> **Pure Invariant Verification, Transparent Trace Proxies, and Autonomous Agent Spending Firewalls.**  
> _The architectural blueprint for the PayClinic payment-safety scanner._

---

## 🏛️ Core Design Principles

1. **AI Generates and Explains. Deterministic Code Decides.**  
   Pass/fail status, security scores, and invariant checks never come from an LLM. Invariants are pure mathematical functions that evaluate immutable HTTP traces.
2. **Prove the Fix Before Trusting It.**  
   An AI-generated patch is untrusted code. It is compiled and executed exclusively inside an ephemeral sandbox against the original attack scenario. Only when deterministic code confirms the invariant passes is a patch marked `verified`.
3. **Defense in Depth for Autonomous Agents.**  
   AI shopping agents are protected by a deterministic spending firewall (`policy.yaml`) that wraps payment tools and evaluates allowlists, caps, budgets, and deduplication windows before tool calls can reach the network.
4. **Zero-Live-Secret Boundary.**  
   Live PayPal credentials and hostnames are banned by runtime guards (`assertSafePayPalBase`). All traces, payloads, and logs automatically redact credentials and authorization tokens at the proxy boundary.

---

## 🔄 The Three-Stage Architecture

```mermaid
flowchart LR
    subgraph Stage1["1. DIAGNOSE"]
        A1["Attack Scenarios<br>(B1-B6, A1-A2)"]
        A2["Transparent Trace Proxy<br>(Port 0 / Redacts Secrets)"]
        A3["Pure Invariants Engine<br>(I-01 .. I-09)"]
        A4["Baseline Safety Score<br>(Score: 61 / 78)"]
        A1 --> A2 --> A3 --> A4
    end

    subgraph Stage2["2. PRESCRIBE"]
        B1["Gemini Root-Cause Analysis<br>(Structured JSON Explanation)"]
        B2["Targeted Patch Synthesis<br>(Exact Search/Replace)"]
        B3["Ephemeral Sandbox Verify<br>(.payclinic-tmp/verify-*)"]
        B4["Verified Proof & PR<br>(Score: 100)"]
        A4 --> B1 --> B2 --> B3 --> B4
    end

    subgraph Stage3["3. PROTECT"]
        C1["Spending Firewall Policy<br>(policy.yaml)"]
        C2["Runtime Tool Guard<br>(GuardedPayTools)"]
        C3["Intercept & Block Attacks<br>(Rules R1 .. R5)"]
        C4["Audit Log & Clean Score<br>(Score: 100)"]
        A4 --> C1 --> C2 --> C3 --> C4
    end
```

---

## 🖥️ Process & Networking Topology

PayClinic runs as a coordinated single-process orchestrator managing ephemeral child processes:

```mermaid
graph TD
    Client["Client / Judge Browser<br>(React Dashboard :5173 / :4000)"]
    API["Fastify REST & SSE Server<br>(Port 4000)"]
    Orchestrator["Orchestrator Core<br>(Node.js ES Modules)"]

    subgraph IsolatedExecution["Isolated Execution"]
        StoreProcess["Buggy Store Child Process<br>(apps/buggy-store / Ephemeral Port)"]
        TraceProxy["In-Process Trace Proxy<br>(Ephemeral Port / Secret Redaction)"]
        TargetEngine{"Target Engine"}
        SimEngine["PayPal Simulator<br>(Deterministic Orders v2 / Webhooks)"]
        LiveSandbox["PayPal Developer Sandbox<br>(api-m.sandbox.paypal.com)"]
    end

    subgraph VerificationSandbox["Verification Sandbox"]
        TempCopy["Ephemeral Workspace<br>(.payclinic-tmp/verify-uuid/)"]
    end

    Client -->|REST & SSE Events| API
    API --> Orchestrator
    Orchestrator -->|Spawn / Manage| StoreProcess
    Orchestrator -->|HTTP Scenarios| StoreProcess
    StoreProcess -->|PAYPAL_BASE_URL| TraceProxy
    TraceProxy --> TargetEngine
    TargetEngine -->|Offline Mode| SimEngine
    TargetEngine -->|Online Mode| LiveSandbox
    Orchestrator -->|Verify Patch| TempCopy
```

### Key Architectural Traits:

- **Ephemeral Port Binding (Port 0)**: Child processes (store, simulator, proxy) are allocated random OS ports during execution to eliminate port collisions and permit concurrent testing.
- **Process Cleanup Guarantees**: All child processes and HTTP listener sockets are cleaned up inside robust `finally` blocks (`SIGTERM` followed by `SIGKILL` on timeout).
- **In-Memory Trace Proxy**: Intercepts HTTP traffic between the merchant store and PayPal, capturing request/response bodies, status codes, timestamps, and PayPal debug IDs into SQLite.

---

## 📦 Monorepo Workspace Architecture

```
packages/
├── contracts/          # Shared zod schemas, TypeScript types, and test builders
├── core/               # Orchestrator, runner, trace proxy, invariants, verify sandbox
├── sim/                # Pure deterministic PayPal simulator (Orders v2, Webhooks, Mock Responses)
├── cli/                # payclinic CLI entry point, Fastify API server, static UI host
├── ai/                 # Gemini API integration, prompt templates, fixture cache
└── firewall/           # Spending firewall engine, GuardedPayTools, YAML policy validator

apps/
├── buggy-store/        # Planted vulnerability demo store (B1-B6)
├── shopping-agent/     # Autonomous AI agent loop with PayTools & prompt injection harnesses
└── dashboard/          # React 18 + Vite 5 + AG Grid dark-themed developer UI

scenarios/              # Deterministic attack scenarios (B1-B6, A1, A2)
fixtures/               # Golden trace captures, AI explanation fixtures, reference diffs
```

---

## 🔬 Deterministic Invariant Engine (`packages/core/src/invariants`)

PayClinic evaluates 9 pure invariant functions against the recorded trace:

```typescript
export interface InvariantResult {
  passed: boolean;
  severity?: 'critical' | 'high' | 'medium';
  finding?: InvariantFinding;
}

export type InvariantFn = (trace: TraceRecord) => InvariantResult;
```

### Invariant Catalog:

- **`I-01` Single Capture per Cart (`critical`, -20 pts)**: Ensures that for any shopping cart session, at most one successful `orders/:id/capture` occurs.
- **`I-02` Authoritative Price Integrity (`critical`, -20 pts)**: Verifies that the captured order amount equals the server-calculated sum of catalog items, preventing client price tampering.
- **`I-03` Non-Negative Refund Bounds (`high`, -12 pts)**: Verifies that cumulative refunded amounts never exceed captured amounts (`refundedTotal <= capturedTotal`).
- **`I-04` Strict Payment State Synchronization (`critical`, -20 pts)**: Ensures a store order is marked `PAID` if and only if PayPal returned `status === 'COMPLETED'`.
- **`I-05` Webhook Cryptographic Verification (`high`, -12 pts)**: Rejects forged webhooks and duplicate webhook replay deliveries.
- **`I-06` Currency Conformance (`medium`, -8 pts)**: Rejects decimal amounts for zero-decimal currencies (JPY) and malformed ISO-4217 strings.
- **`I-07` Agent Spending Ceilings (`high`, -12 pts)**: Enforces per-transaction caps and session budgets on agent tool actions.
- **`I-08` Agent Intent & Merchant Allowlists (`critical`, -20 pts)**: Enforces that agent tool calls stay within allowed merchant domains and declared product items.
- **`I-09` Temporal Deduplication Window (`high`, -12 pts)**: Blocks duplicate agent purchases of the same SKU within a 60-second window.

---

## 🧪 Ephemeral Sandbox Verification Pipeline (`packages/core/src/verify`)

When Gemini prescribes a code patch, PayClinic subjects the fix to rigorous verification:

```mermaid
sequenceDiagram
    autonumber
    participant Orch as Orchestrator
    participant AI as Gemini AI Provider
    participant Guard as AST Safety Denylist
    participant Disk as .payclinic-tmp/
    participant Runner as Scenario Runner

    Orch->>AI: Send trace evidence & source file
    AI-->>Orch: Return search/replace patch tuples
    Orch->>Guard: Evaluate patch AST safety
    Note over Guard: Denies eval(), process, child_process, globalThis
    Guard-->>Orch: Patch Approved
    Orch->>Disk: Copy apps/buggy-store into temp directory
    Orch->>Disk: Apply exact string replacements
    Orch->>Runner: Boot patched store on ephemeral port
    Runner->>Runner: Re-execute same attack scenario
    Runner-->>Orch: Return verified trace & invariants pass
    Orch->>Disk: Clean up temporary sandbox directory
    Orch-->>Orch: Mark finding VERIFIED & update score to 100
```

---

## 🛡️ Autonomous Agent Spending Firewall (`packages/firewall`)

For AI shopping agents, PayClinic intercepts payment tool calls at runtime using a declarative spending firewall policy:

```mermaid
flowchart TD
    ToolCall["Agent calls capture_order(merchant, amount, currency, items)"] --> R3{"R3: Merchant Allowlist"}
    R3 -- Unauthorized --> BlockR3["BLOCK: Untrusted merchant domain"]
    R3 -- Allowed --> R1{"R1: Transaction Cap"}
    R1 -- Exceeded --> BlockR1["BLOCK: Exceeds per-transaction limit"]
    R1 -- Allowed --> R2{"R2: Session Budget"}
    R2 -- Exceeded --> BlockR2["BLOCK: Cumulative budget exhausted"]
    R2 -- Allowed --> R5{"R5: Dedupe Window"}
    R5 -- Duplicate within 60s --> BlockR5["BLOCK: Duplicate purchase in window"]
    R5 -- Clean --> R4{"R4: High-Value Threshold"}
    R4 -- Exceeds Threshold --> Escalate["ESCALATE: Require human authorization"]
    R4 -- Within Normal Limits --> Allow["ALLOW: Forward call to PayPal"]
```

---

## 🔒 Security & SSRF Target Guard

PayClinic includes enterprise-grade guardrails for remote project scanning:

1. **DNS Pinning & Private IP Blocking**:
   `packages/core/src/runner/target-guard.ts` resolves remote domains and denies requests to:
   - Loopback (`127.0.0.0/8`, `::1`)
   - Private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
   - Cloud metadata endpoints (`169.254.169.254`)
   - IPv4-mapped IPv6 hex addresses (`::ffff:7f00:1`, `::ffff:a9fe:a9fe`)
2. **Redirect Control**: Recorded HTTP clients use `redirect: 'manual'` to prevent open-redirect SSRF evasions.
3. **Encrypted Storage**: Sensitive settings are encrypted at rest with AES-256-GCM using keys stored in `data/.secret`.
4. **Header Redaction**: `SECRET_HEADERS` filters out `authorization`, `paypal-auth-assertion`, `x-payclinic-admin`, and API keys before traces reach SQLite or external LLMs.
