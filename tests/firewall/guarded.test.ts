import { describe, expect, it } from 'vitest';
import type { FirewallDecision, Policy, Product } from '@payclinic/contracts';
import type { PayTools } from '@payclinic/shopping-agent';
import { fromMinor, toMinor } from '@payclinic/core';
import { GuardedPayTools } from '@payclinic/firewall';

const T = Date.UTC(2026, 0, 1, 0, 0, 0);

const catalog: Product[] = [
  {
    sku: 'tee-001',
    name: 'Logo Tee',
    description: 'A tee',
    price: '25.00',
    currency: 'USD',
    merchantId: 'demo-store',
  },
  {
    sku: 'mug-001',
    name: 'Logo Mug',
    description: 'A mug',
    price: '20.00',
    currency: 'USD',
    merchantId: 'demo-store',
  },
  {
    sku: 'promo-099',
    name: 'Promo Bundle',
    description: 'A promo',
    price: '9.90',
    currency: 'USD',
    merchantId: 'sketchy-deals',
  },
];

function fakeTools(o: { capture?: 'COMPLETED' | 'FAILED' } = {}) {
  const created: { merchantId: string; sku: string; qty: number }[] = [];
  const captured: string[] = [];
  let counter = 0;

  const tools: PayTools = {
    searchProducts: async () => catalog,
    createOrder: async (args) => {
      created.push({ ...args });
      const product = catalog.find((entry) => entry.sku === args.sku);
      if (!product) return { error: `unknown product ${args.sku}` };
      counter += 1;
      return {
        orderId: `O${counter}`,
        amount: fromMinor(
          toMinor(product.price, product.currency) * BigInt(args.qty),
          product.currency,
        ),
        currency: product.currency,
      };
    },
    captureOrder: async (orderId) => {
      captured.push(orderId);
      return o.capture === 'FAILED'
        ? { status: 'FAILED', error: 'declined' }
        : { status: 'COMPLETED' };
    },
  };

  return { tools, created, captured };
}

function makeIds(): () => string {
  let next = 0;
  return () => `decision-${(next += 1)}`;
}

function guard(
  inner: PayTools,
  policy: Policy,
  o: {
    now?: () => number;
    newId?: () => string;
    onDecision?: (d: FirewallDecision) => void;
    onEscalate?: (d: FirewallDecision) => Promise<boolean>;
  } = {},
): GuardedPayTools {
  return new GuardedPayTools(inner, policy, {
    runId: 'run-1',
    catalog,
    now: o.now ?? (() => T),
    newId: o.newId ?? makeIds(),
    onDecision: o.onDecision,
    onEscalate: o.onEscalate,
  });
}

describe('GuardedPayTools', () => {
  it('passes an allowed order through and logs one allow decision', async () => {
    const fake = fakeTools();
    const decisions: FirewallDecision[] = [];
    const tools = guard(
      fake.tools,
      {
        version: 1,
        currency: 'USD',
        merchantAllowlist: ['demo-store'],
        perTransactionCap: '30.00',
      },
      { onDecision: (d) => decisions.push(d) },
    );

    const result = await tools.createOrder({
      merchantId: 'demo-store',
      sku: 'tee-001',
      qty: 1,
    });

    expect(result).toEqual({ orderId: 'O1', amount: '25.00', currency: 'USD' });
    expect(fake.created).toEqual([{ merchantId: 'demo-store', sku: 'tee-001', qty: 1 }]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ runId: 'run-1', action: 'allow', ruleId: null });
  });

  it('blocks a merchant that is not on the allowlist (R3) without calling the inner tools', async () => {
    const fake = fakeTools();
    const decisions: FirewallDecision[] = [];
    const tools = guard(
      fake.tools,
      { version: 1, currency: 'USD', merchantAllowlist: ['demo-store'] },
      { onDecision: (d) => decisions.push(d) },
    );

    const result = await tools.createOrder({
      merchantId: 'sketchy-deals',
      sku: 'promo-099',
      qty: 10,
    });

    expect(result).toEqual({
      error: 'blocked by firewall: R3 Merchant sketchy-deals is not on the allowlist',
    });
    expect(fake.created).toHaveLength(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: 'block', ruleId: 'R3' });
  });

  it('counts session spend only from completed captures (R2)', async () => {
    const policy: Policy = { version: 1, currency: 'USD', sessionBudget: '40.00' };

    const completed = fakeTools();
    const completedTools = guard(completed.tools, policy);
    await completedTools.createOrder({ merchantId: 'demo-store', sku: 'tee-001', qty: 1 });
    expect(await completedTools.captureOrder('O1')).toEqual({ status: 'COMPLETED' });
    expect(
      await completedTools.createOrder({ merchantId: 'demo-store', sku: 'mug-001', qty: 1 }),
    ).toMatchObject({ error: expect.stringContaining('blocked by firewall: R2') });

    const failed = fakeTools({ capture: 'FAILED' });
    const failedTools = guard(failed.tools, policy);
    await failedTools.createOrder({ merchantId: 'demo-store', sku: 'tee-001', qty: 1 });
    expect(await failedTools.captureOrder('O1')).toMatchObject({ status: 'FAILED' });
    const afterFailed = await failedTools.createOrder({
      merchantId: 'demo-store',
      sku: 'mug-001',
      qty: 1,
    });
    expect(afterFailed).not.toHaveProperty('error');
    expect(failed.created).toHaveLength(2);
  });

  it('blocks a duplicate inside the window after a completed capture (R5)', async () => {
    const fake = fakeTools();
    let nowMs = T;
    const decisions: FirewallDecision[] = [];
    const tools = guard(
      fake.tools,
      { version: 1, currency: 'USD', duplicateWindowSec: 600 },
      { now: () => nowMs, onDecision: (d) => decisions.push(d) },
    );

    await tools.createOrder({ merchantId: 'demo-store', sku: 'tee-001', qty: 1 });
    await tools.captureOrder('O1');

    nowMs = T + 599_000;
    const inside = await tools.createOrder({ merchantId: 'demo-store', sku: 'tee-001', qty: 1 });
    expect(inside).toMatchObject({ error: expect.stringContaining('blocked by firewall: R5') });
    expect(decisions.at(-1)).toMatchObject({ action: 'block', ruleId: 'R5' });

    nowMs = T + 601_000;
    const outside = await tools.createOrder({ merchantId: 'demo-store', sku: 'tee-001', qty: 1 });
    expect(outside).not.toHaveProperty('error');
    expect(decisions.at(-1)).toMatchObject({ action: 'allow', ruleId: null });
  });

  it('blocks above the approval threshold when no human approves (R4)', async () => {
    const fake = fakeTools();
    const decisions: FirewallDecision[] = [];
    const tools = guard(
      fake.tools,
      { version: 1, currency: 'USD', approvalThreshold: '20.00' },
      { onDecision: (d) => decisions.push(d) },
    );

    const result = await tools.createOrder({
      merchantId: 'demo-store',
      sku: 'tee-001',
      qty: 1,
    });

    expect(result).toMatchObject({
      error: expect.stringMatching(/^blocked pending approval: R4 /),
    });
    expect(fake.created).toHaveLength(0);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ action: 'escalate', ruleId: 'R4' });
  });

  it('continues after a human approves an escalation and logs both decisions', async () => {
    const fake = fakeTools();
    const decisions: FirewallDecision[] = [];
    const escalated: FirewallDecision[] = [];
    const tools = guard(
      fake.tools,
      { version: 1, currency: 'USD', approvalThreshold: '20.00' },
      {
        onDecision: (d) => decisions.push(d),
        onEscalate: async (d) => {
          escalated.push(d);
          return true;
        },
      },
    );

    const result = await tools.createOrder({
      merchantId: 'demo-store',
      sku: 'tee-001',
      qty: 1,
    });

    expect(result).toEqual({ orderId: 'O1', amount: '25.00', currency: 'USD' });
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toMatchObject({ action: 'escalate', ruleId: 'R4' });
    expect(decisions.map((d) => d.action)).toEqual(['escalate', 'allow']);
    expect(decisions[1]).toMatchObject({
      action: 'allow',
      ruleId: null,
      reason: 'Approved by human after escalation (R4)',
    });
  });

  it('returns an error and logs no decision for an unknown product', async () => {
    const fake = fakeTools();
    const decisions: FirewallDecision[] = [];
    const tools = guard(
      fake.tools,
      { version: 1, currency: 'USD', merchantAllowlist: ['demo-store'] },
      { onDecision: (d) => decisions.push(d) },
    );

    expect(
      await tools.createOrder({ merchantId: 'demo-store', sku: 'missing-001', qty: 1 }),
    ).toEqual({ error: 'unknown product missing-001' });
    expect(fake.created).toHaveLength(0);
    expect(decisions).toHaveLength(0);
  });

  it('stamps every decision with the run id, a unique id and the injected clock', async () => {
    const fake = fakeTools();
    const decisions: FirewallDecision[] = [];
    let nowMs = T;
    const tools = guard(
      fake.tools,
      { version: 1, currency: 'USD' },
      { now: () => nowMs, newId: makeIds(), onDecision: (d) => decisions.push(d) },
    );

    await tools.createOrder({ merchantId: 'demo-store', sku: 'tee-001', qty: 1 });
    nowMs = T + 1_000;
    await tools.createOrder({ merchantId: 'demo-store', sku: 'mug-001', qty: 1 });

    expect(decisions.map((d) => d.id)).toEqual(['decision-1', 'decision-2']);
    expect(new Set(decisions.map((d) => d.id)).size).toBe(2);
    expect(decisions.every((d) => d.runId === 'run-1')).toBe(true);
    expect(decisions[0]?.ts).toBe(new Date(T).toISOString());
    expect(decisions[1]?.ts).toBe(new Date(T + 1_000).toISOString());
    expect(decisions.every((d) => new Date(d.ts).toISOString() === d.ts)).toBe(true);
  });
});
