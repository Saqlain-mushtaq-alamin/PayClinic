import { z } from 'zod';
import {
  Actor,
  FindingState,
  FirewallAction,
  InvariantKey,
  RuleId,
  RunMode,
  RunStatus,
  RunTarget,
  ScenarioKey,
  ScenarioStatus,
  Severity,
} from './enums';

/** Money is ALWAYS a decimal string (never a float), e.g. "25.00" or "1200" for JPY. */
export const MoneyString = z.string().regex(/^\d+(\.\d+)?$/, 'money must be a decimal string');
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
export const IsoTimestamp = z.string().datetime({ offset: true });

// ───────────────────────── Catalog / store domain ─────────────────────────

export const Product = z.object({
  sku: z.string(),
  name: z.string(),
  description: z.string(),
  price: MoneyString,
  currency: CurrencyCode,
  merchantId: z.string(),
});
export type Product = z.infer<typeof Product>;

export const CartItem = z.object({ sku: z.string(), qty: z.number().int().positive() });
export type CartItem = z.infer<typeof CartItem>;

/** Ground truth declared by the runner: what this cart SHOULD cost. */
export const Cart = z.object({
  id: z.string(),
  items: z.array(CartItem).min(1),
  currency: CurrencyCode,
  expectedTotal: MoneyString,
});
export type Cart = z.infer<typeof Cart>;

export const MerchantOrder = z.object({
  id: z.string(),
  cartId: z.string(),
  paypalOrderId: z.string().nullable(),
  status: z.enum(['created', 'paid', 'failed']),
  paid: z.boolean(),
  capturedTotal: MoneyString,
  refundedTotal: MoneyString,
});
export type MerchantOrder = z.infer<typeof MerchantOrder>;

/** `applied` = number of side effects (ledger credits) this delivery caused. */
export const WebhookDelivery = z.object({
  deliveryId: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  applied: z.number().int().nonnegative(),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

export const AgentIntent = z.object({
  skus: z.array(z.string()).min(1),
  maxQtyPerSku: z.number().int().positive(),
  budget: MoneyString,
  perTxnCap: MoneyString,
  currency: CurrencyCode,
});
export type AgentIntent = z.infer<typeof AgentIntent>;

export const AgentPurchase = z.object({
  orderId: z.string(),
  merchantId: z.string(),
  sku: z.string(),
  qty: z.number().int().positive(),
  amount: MoneyString,
  /** epoch milliseconds when the purchase succeeded */
  atMs: z.number().int().nonnegative(),
});
export type AgentPurchase = z.infer<typeof AgentPurchase>;

export const AgentRunState = z.object({
  intent: AgentIntent,
  allowedMerchants: z.array(z.string()),
  dedupeWindowSec: z.number().int().positive(),
  purchases: z.array(AgentPurchase),
});
export type AgentRunState = z.infer<typeof AgentRunState>;

/** Everything an invariant may look at besides the trace. */
export const RunState = z.object({
  carts: z.array(Cart),
  merchantOrders: z.array(MerchantOrder),
  webhookDeliveries: z.array(WebhookDelivery),
  forgedDeliveryIds: z.array(z.string()),
  agent: AgentRunState.optional(),
});
export type RunState = z.infer<typeof RunState>;

// ───────────────────────── Trace ─────────────────────────

export const Step = z.object({
  id: z.string(),
  runId: z.string(),
  scenarioId: z.string(),
  /** order in which requests STARTED within the scenario, from 0 */
  seq: z.number().int().nonnegative(),
  actor: Actor,
  label: z.string().optional(),
  method: z.string(),
  url: z.string(),
  /** Authorization / secret headers MUST be replaced by "***" before storing. */
  requestHeaders: z.record(z.string()),
  requestBody: z.unknown(),
  responseStatus: z.number().int(),
  responseHeaders: z.record(z.string()),
  responseBody: z.unknown(),
  paypalDebugId: z.string().optional(),
  durationMs: z.number().nonnegative(),
  timestamp: IsoTimestamp,
});
export type Step = z.infer<typeof Step>;

// ───────────────────────── Run / findings ─────────────────────────

export const Run = z.object({
  id: z.string(),
  target: RunTarget,
  mode: RunMode,
  scenarioKeys: z.array(ScenarioKey),
  status: RunStatus,
  startedAt: IsoTimestamp,
  completedAt: IsoTimestamp.optional(),
  scoreBefore: z.number().min(0).max(100).optional(),
  scoreAfter: z.number().min(0).max(100).optional(),
  error: z.string().optional(),
});
export type Run = z.infer<typeof Run>;

export const ScenarioResult = z.object({
  id: z.string(),
  runId: z.string(),
  key: ScenarioKey,
  status: ScenarioStatus,
  startedAt: IsoTimestamp.optional(),
  finishedAt: IsoTimestamp.optional(),
  error: z.string().optional(),
});
export type ScenarioResult = z.infer<typeof ScenarioResult>;

export const InvariantResult = z.object({
  key: InvariantKey,
  passed: z.boolean(),
  severity: Severity,
  message: z.string(),
  evidenceStepIds: z.array(z.string()),
  details: z.record(z.unknown()).optional(),
});
export type InvariantResult = z.infer<typeof InvariantResult>;

export const Finding = z.object({
  id: z.string(),
  runId: z.string(),
  scenarioKey: ScenarioKey,
  invariantKey: InvariantKey,
  severity: Severity,
  state: FindingState,
  title: z.string(),
  summary: z.string(),
  evidenceStepIds: z.array(z.string()),
  createdAt: IsoTimestamp,
});
export type Finding = z.infer<typeof Finding>;

export const Explanation = z.object({
  findingId: z.string(),
  rootCause: z.string(),
  impact: z.string(),
  whereInCode: z.object({ file: z.string(), hint: z.string() }),
  fixSummary: z.string(),
  model: z.string(),
  createdAt: IsoTimestamp,
});
export type Explanation = z.infer<typeof Explanation>;

/** Exact-string edit. `search` MUST occur exactly once in the file. */
export const PatchEdit = z.object({
  /** path relative to repo root, MUST start with "apps/buggy-store/src/" */
  file: z.string().startsWith('apps/buggy-store/src/'),
  search: z.string().min(1),
  replace: z.string(),
});
export type PatchEdit = z.infer<typeof PatchEdit>;

export const TestFile = z.object({
  /** file name only, e.g. "b1.regression.test.ts" */
  path: z.string().regex(/^[\w.-]+\.test\.ts$/),
  content: z.string().min(1),
});
export type TestFile = z.infer<typeof TestFile>;

export const Patch = z.object({
  id: z.string(),
  findingId: z.string(),
  edits: z.array(PatchEdit).min(1).max(5),
  /** unified diff DERIVED from edits, for display and PRs. Never used to apply. */
  diff: z.string(),
  testFile: TestFile.optional(),
  source: z.enum(['ai', 'template']),
  model: z.string().optional(),
  rationale: z.string().optional(),
  createdAt: IsoTimestamp,
});
export type Patch = z.infer<typeof Patch>;

export const VerifyResult = z.object({
  patchId: z.string(),
  applied: z.boolean(),
  started: z.boolean(),
  invariantPassed: z.boolean(),
  /** null = no test file, or tests were not run */
  testsPassed: z.boolean().nullable(),
  verified: z.boolean(),
  durationMs: z.number().nonnegative(),
  log: z.array(z.string()),
  rerunStepIds: z.array(z.string()),
});
export type VerifyResult = z.infer<typeof VerifyResult>;

export const ScorePenalty = z.object({
  invariantKey: InvariantKey,
  severity: Severity,
  points: z.number(),
});
export const Score = z.object({
  score: z.number().min(0).max(100),
  penalties: z.array(ScorePenalty),
  unresolvedCount: z.number().int().nonnegative(),
  resolvedCount: z.number().int().nonnegative(),
});
export type Score = z.infer<typeof Score>;

// ───────────────────────── Firewall ─────────────────────────

export const Policy = z.object({
  version: z.literal(1),
  currency: CurrencyCode,
  perTransactionCap: MoneyString.optional(),
  sessionBudget: MoneyString.optional(),
  merchantAllowlist: z.array(z.string()).optional(),
  approvalThreshold: MoneyString.optional(),
  duplicateWindowSec: z.number().int().positive().optional(),
});
export type Policy = z.infer<typeof Policy>;

export const GuardRequest = z.object({
  tool: z.literal('create_order'),
  merchantId: z.string(),
  sku: z.string(),
  qty: z.number().int().positive(),
  amount: MoneyString,
  currency: CurrencyCode,
});
export type GuardRequest = z.infer<typeof GuardRequest>;

export const GuardHistory = z.object({
  sessionSpent: MoneyString,
  recentPurchases: z.array(
    z.object({ merchantId: z.string(), sku: z.string(), qty: z.number().int(), atMs: z.number() }),
  ),
  nowMs: z.number().int().nonnegative(),
});
export type GuardHistory = z.infer<typeof GuardHistory>;

export const FirewallDecision = z.object({
  id: z.string(),
  runId: z.string(),
  action: FirewallAction,
  /** null only when action === 'allow' */
  ruleId: RuleId.nullable(),
  reason: z.string(),
  request: GuardRequest,
  ts: IsoTimestamp,
});
export type FirewallDecision = z.infer<typeof FirewallDecision>;

// ───────────────────────── AI structured outputs ─────────────────────────

export const ExplainOutput = z.object({
  rootCause: z.string().min(10),
  impact: z.string().min(10),
  whereInCode: z.object({ file: z.string(), hint: z.string() }),
  fixSummary: z.string().min(10),
});
export type ExplainOutput = z.infer<typeof ExplainOutput>;

export const PatchOutput = z.object({
  edits: z.array(PatchEdit).min(1).max(5),
  testFile: TestFile.optional(),
  rationale: z.string(),
});
export type PatchOutput = z.infer<typeof PatchOutput>;

export const PolicyOutput = z.object({ policy: Policy, rationale: z.string() });
export type PolicyOutput = z.infer<typeof PolicyOutput>;

export const VariationOutput = z.object({
  variations: z
    .array(
      z.object({
        scenarioKey: ScenarioKey,
        title: z.string(),
        params: z.object({ currency: CurrencyCode, items: z.array(CartItem).min(1) }),
      }),
    )
    .max(5),
});
export type VariationOutput = z.infer<typeof VariationOutput>;

// ───────────────────────── Golden traces (test fixtures) ─────────────────────────

export const GoldenTrace = z.object({
  name: z.string(),
  scenarioKey: ScenarioKey,
  description: z.string(),
  steps: z.array(Step),
  state: RunState,
  /** exact set of invariants that MUST fail on this trace (empty = healthy) */
  expectedFailingInvariants: z.array(InvariantKey),
});
export type GoldenTrace = z.infer<typeof GoldenTrace>;
