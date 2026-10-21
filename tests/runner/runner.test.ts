import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startSim } from '@payclinic/sim';
import {
  buildContext,
  createManualApprover,
  createRecordedHttp,
  createRecorder,
  createSimApprover,
  startStore,
  startTraceProxy,
  type RecordedHttp,
} from '@payclinic/core';

const repo = join(__dirname, '../..');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});
let n = 0;
const recorder = () =>
  createRecorder({
    runId: 'r',
    newId: () => `s${++n}`,
    now: () => new Date('2026-10-18T10:00:00Z'),
  });

describe('startStore', () => {
  it('starts the real store, answers requests and stops', async () => {
    const sim = await startSim();
    cleanup.push(sim.close);
    const store = await startStore({
      sourceDir: join(repo, 'apps/buggy-store'),
      paypalBaseUrl: sim.url,
    });
    const res = await fetch(`${store.url}/api/products`);
    expect(res.status).toBe(200);
    await store.stop();
    await expect(fetch(`${store.url}/api/products`)).rejects.toThrow();
  });
  it('rejects quickly with a useful message when the store crashes on boot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crash-'));
    cleanup.push(async () => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/server.ts'), "throw new Error('boom');");
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    await expect(
      startStore({ sourceDir: dir, paypalBaseUrl: 'http://127.0.0.1:1' }),
    ).rejects.toThrow(/exited/);
  });
});

describe('recorded http + sim approver', () => {
  it('records a runner step and labels the approval', async () => {
    const sim = await startSim();
    cleanup.push(sim.close);
    const rec = recorder();
    rec.setScenario('scn');
    const proxy = await startTraceProxy({ target: sim.url, recorder: rec });
    cleanup.push(() => proxy.stop());
    const store = await startStore({
      sourceDir: join(repo, 'apps/buggy-store'),
      paypalBaseUrl: proxy.url,
    });
    cleanup.push(store.stop);
    const http = createRecordedHttp({ recorder: rec, baseUrl: store.url });
    const created = await http.request(
      'POST',
      '/api/orders',
      { cartId: 'c1', items: [{ sku: 'tee-001', qty: 1 }] },
      { label: 'Customer clicks Pay' },
    );
    expect(created.status).toBe(201);
    const approver = createSimApprover({ simUrl: sim.url, http });
    await approver.approve(created.body.orderId, created.body.approveUrl);
    const steps = rec.steps();
    expect(steps.map((s) => s.actor)).toEqual(['runner', 'store', 'store', 'runner']);
    expect(steps.at(-1)!.label).toBe('Buyer approves in PayPal');
    expect(steps.every((s) => s.requestHeaders.authorization !== 'Bearer SIM-TOKEN')).toBe(true);
  });
  it('does not throw on HTTP errors', async () => {
    const sim = await startSim();
    cleanup.push(sim.close);
    const rec = recorder();
    rec.setScenario('scn');
    const http = createRecordedHttp({ recorder: rec, baseUrl: sim.url });
    const r = await http.request('GET', '/v2/checkout/orders/NOPE');
    expect(r.status).toBe(404);
  });
});

describe('scenario context', () => {
  it('records checkout, approval and capture, and returns declared ground truth', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown; label?: string }> = [];
    const http: RecordedHttp = {
      async request(method, path, body, opts) {
        calls.push({ method, path, body, ...(opts?.label ? { label: opts.label } : {}) });
        if (path === '/api/orders') {
          return {
            status: 201,
            body: { orderId: 'O1', merchantOrderId: 'M1', approveUrl: 'http://sim/approve/O1' },
            stepId: 's1',
          };
        }
        return { status: 200, body: { status: 'paid' }, stepId: 's2' };
      },
    };
    const approved: Array<{ orderId: string; approveUrl: string }> = [];
    const ctx = buildContext({
      runId: 'r',
      scenarioKey: 'B1',
      storeUrl: 'http://store',
      catalog: [],
      http,
      approver: {
        async approve(orderId, approveUrl) {
          approved.push({ orderId, approveUrl });
        },
      },
      chaos: { mockNext: () => undefined, clear: () => undefined },
    });

    const cart = {
      id: 'cart-1',
      items: [{ sku: 'tee-001', qty: 1 }],
      currency: 'USD' as const,
      expectedTotal: '25.00',
    };
    ctx.declareCart(cart);
    ctx.declareForgedDelivery('d-forged');

    const created = await ctx.checkout({ cartId: cart.id, items: cart.items, clientTotal: '1.00' });
    expect(created).toMatchObject({ status: 201, orderId: 'O1', merchantOrderId: 'M1' });
    await ctx.approve('O1');
    expect(approved).toEqual([{ orderId: 'O1', approveUrl: 'http://sim/approve/O1' }]);
    expect((await ctx.capture('O1')).status).toBe(200);

    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/api/orders',
        body: { cartId: 'cart-1', items: [{ sku: 'tee-001', qty: 1 }], clientTotal: '1.00' },
        label: 'Customer clicks Pay',
      },
      {
        method: 'POST',
        path: '/api/orders/O1/capture',
        body: {},
        label: 'Customer returns; store captures',
      },
    ]);
    expect(ctx.getDeclared()).toEqual({ carts: [cart], forgedDeliveryIds: ['d-forged'] });
  });

  it('asks the manual approver for the approve URL', async () => {
    let asked = '';
    const approver = createManualApprover({
      ask: async (url) => {
        asked = url;
      },
    });
    await approver.approve('O1', 'http://sim/approve/O1');
    expect(asked).toBe('http://sim/approve/O1');
  });
});
