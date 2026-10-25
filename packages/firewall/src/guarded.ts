import type {
  FirewallDecision,
  GuardHistory,
  GuardRequest,
  Policy,
  Product,
} from '@payclinic/contracts';
import type { PayTools } from '@payclinic/shopping-agent';
import { fromMinor, toMinor } from '@payclinic/core';
import { firewallEngine } from './engine';

interface PendingOrder {
  merchantId: string;
  sku: string;
  qty: number;
  amount: string;
}

interface RecentPurchase {
  merchantId: string;
  sku: string;
  qty: number;
  atMs: number;
}

type EvaluatedDecision = Omit<FirewallDecision, 'id' | 'runId' | 'ts'>;

export interface GuardedPayToolsOptions {
  runId: string;
  catalog: Product[];
  now: () => number;
  newId: () => string;
  onDecision?: (decision: FirewallDecision) => void;
  onEscalate?: (decision: FirewallDecision) => Promise<boolean>;
}

/** Wraps PayTools with the spending firewall and records every decision. */
export class GuardedPayTools implements PayTools {
  private readonly inner: PayTools;
  private readonly policy: Policy;
  private readonly options: GuardedPayToolsOptions;
  private readonly pending = new Map<string, PendingOrder>();
  private readonly recentPurchases: RecentPurchase[] = [];
  private sessionSpentMinor = 0n;

  constructor(inner: PayTools, policy: Policy, options: GuardedPayToolsOptions) {
    this.inner = inner;
    this.policy = policy;
    this.options = options;
  }

  /** Product search does not spend money, so it passes through unchanged. */
  searchProducts(query?: string): Promise<Product[]> {
    return this.inner.searchProducts(query);
  }

  /** Evaluates the policy before creating an order and remembers allowed orders. */
  async createOrder(a: {
    merchantId: string;
    sku: string;
    qty: number;
  }): Promise<{ orderId: string; amount: string; currency: string } | { error: string }> {
    const product = this.options.catalog.find((entry) => entry.sku === a.sku);
    if (!product) return { error: `unknown product ${a.sku}` };

    const amount = fromMinor(
      toMinor(product.price, product.currency) * BigInt(a.qty),
      product.currency,
    );
    const request: GuardRequest = {
      tool: 'create_order',
      merchantId: a.merchantId,
      sku: a.sku,
      qty: a.qty,
      amount,
      currency: product.currency,
    };
    const history: GuardHistory = {
      sessionSpent: fromMinor(this.sessionSpentMinor, this.policy.currency),
      recentPurchases: this.recentPurchases,
      nowMs: this.options.now(),
    };

    const decision = this.record(firewallEngine.evaluate(request, this.policy, history));

    if (decision.action === 'block') {
      return { error: `blocked by firewall: ${decision.ruleId} ${decision.reason}` };
    }

    if (decision.action === 'escalate') {
      const approve = this.options.onEscalate ?? (async () => false);
      if (!(await approve(decision))) {
        return { error: `blocked pending approval: ${decision.ruleId} ${decision.reason}` };
      }
      this.record({
        action: 'allow',
        ruleId: null,
        reason: 'Approved by human after escalation (R4)',
        request,
      });
    }

    const result = await this.inner.createOrder(a);
    if ('orderId' in result) {
      this.pending.set(result.orderId, {
        merchantId: a.merchantId,
        sku: a.sku,
        qty: a.qty,
        amount,
      });
    }
    return result;
  }

  /** Only a completed capture counts toward session spend and duplicates. */
  async captureOrder(orderId: string): Promise<{ status: 'COMPLETED' | 'FAILED'; error?: string }> {
    const result = await this.inner.captureOrder(orderId);
    if (result.status === 'COMPLETED') {
      const order = this.pending.get(orderId);
      if (order) {
        this.sessionSpentMinor += toMinor(order.amount, this.policy.currency);
        this.recentPurchases.push({
          merchantId: order.merchantId,
          sku: order.sku,
          qty: order.qty,
          atMs: this.options.now(),
        });
      }
    }
    return result;
  }

  private record(evaluated: EvaluatedDecision): FirewallDecision {
    const decision: FirewallDecision = {
      id: this.options.newId(),
      runId: this.options.runId,
      action: evaluated.action,
      ruleId: evaluated.ruleId,
      reason: evaluated.reason,
      request: evaluated.request,
      ts: new Date(this.options.now()).toISOString(),
    };
    this.options.onDecision?.(decision);
    return decision;
  }
}
