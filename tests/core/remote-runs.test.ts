import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Explanation } from '@payclinic/contracts';
import { createApi } from '@payclinic/cli';
import {
  createOrchestrator,
  createProjectsRepo,
  createRepos,
  encrypt,
  loadConfig,
  openDb,
  type Database,
  type ProjectsRepo,
  type Repos,
} from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

describe('Remote Runs (Phase 6)', () => {
  let db: Database;
  let repos: Repos;
  let projectsRepo: ProjectsRepo;
  let bus: EventEmitter;
  let apiServer: ReturnType<typeof createApi>;
  let apiBaseUrl: string;
  let fakeStoreServer: Server;
  let fakeStoreUrl: string;
  const adminSecret = 'remote-secret-999';
  const proxyToken = 'remote-token-phase6';

  beforeEach(async () => {
    // Set allow private targets for local test servers
    process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS = '1';

    db = openDb(':memory:');
    repos = createRepos(db);
    projectsRepo = createProjectsRepo(db);
    bus = new EventEmitter();

    projectsRepo.insertProject({
      id: 'remote-proj-1',
      name: 'Custom Remote Shopify',
      kind: 'remote',
      baseUrl: 'http://127.0.0.1:0', // will update after fakeStore starts
      adminSecretEncrypted: encrypt(adminSecret),
      proxyToken,
    });

    const orch = createOrchestrator({
      repos,
      projectsRepo,
      config: loadConfig({}),
      scenarios: SCENARIOS,
      repoRoot: process.cwd(),
      storeSourceDir: '',
      prescriber: async () => ({ explanation: {} as unknown as Explanation, patches: [] }),
      newId: () => `id-${Math.random().toString(36).slice(2, 9)}`,
      now: () => new Date(),
      bus,
    });

    apiServer = createApi({
      repos,
      projectsRepo,
      config: loadConfig({}),
      bus,
      orchestrator: orch,
    });

    const apiAddress = await apiServer.listen({ port: 0, host: '127.0.0.1' });
    apiBaseUrl = apiAddress;
  });

  afterEach(async () => {
    delete process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS;
    if (fakeStoreServer) {
      await new Promise<void>((resolve) => fakeStoreServer.close(() => resolve()));
    }
    await apiServer.close();
  });

  it('rejects agent scenarios (A1, A2) or agent target for remote projects', () => {
    const orch = createOrchestrator({
      repos,
      projectsRepo,
      config: loadConfig({}),
      scenarios: SCENARIOS,
      repoRoot: process.cwd(),
      storeSourceDir: '',
      prescriber: async () => ({ explanation: {} as unknown as Explanation, patches: [] }),
      newId: () => 'id-1',
      now: () => new Date(),
      bus,
    });

    // Attempting target: 'agent'
    expect(() =>
      orch.startRun({
        projectId: 'remote-proj-1',
        target: 'agent',
        mode: 'offline',
        scenarios: ['A1'],
      }),
    ).toThrow(/Remote projects only support store scenarios/);

    // Attempting store target with A1 scenario
    expect(() =>
      orch.startRun({
        projectId: 'remote-proj-1',
        target: 'store',
        mode: 'offline',
        scenarios: ['A1'],
      }),
    ).toThrow(/Remote projects only support store scenarios/);
  });

  it('enforces run lock: only one run per remote project at a time', () => {
    const isolatedDb = openDb(':memory:');
    const isolatedRepos = createRepos(isolatedDb);
    const isolatedProjectsRepo = createProjectsRepo(isolatedDb);
    isolatedProjectsRepo.insertProject({
      id: 'remote-proj-lock',
      name: 'Lock Test Store',
      kind: 'remote',
      baseUrl: 'http://127.0.0.1:9999',
      proxyToken: 'lock-token',
    });

    const orch = createOrchestrator({
      repos: isolatedRepos,
      projectsRepo: isolatedProjectsRepo,
      config: loadConfig({}),
      scenarios: SCENARIOS,
      repoRoot: process.cwd(),
      storeSourceDir: '',
      prescriber: async () => ({ explanation: {} as unknown as Explanation, patches: [] }),
      newId: () => `id-${Math.random().toString(36).slice(2, 9)}`,
      now: () => new Date(),
      bus,
    });

    // Start first run
    const firstRunId = orch.startRun({
      projectId: 'remote-proj-lock',
      target: 'store',
      mode: 'offline',
      scenarios: ['B1'],
    });
    expect(firstRunId).toBeTruthy();

    // Start second run for same remote project -> must throw with clear error
    expect(() =>
      orch.startRun({
        projectId: 'remote-proj-lock',
        target: 'store',
        mode: 'offline',
        scenarios: ['B1'],
      }),
    ).toThrow(/A run is already active or queued for project 'Lock Test Store'/);
  });

  it('runs against a local fake compatible site and finds B1 and B2 findings', async () => {
    const orders = new Map<string, Record<string, unknown>>();
    const paypalProxyUrl = `${apiBaseUrl}/paypal-proxy/${proxyToken}`;

    // Create fake store with B1 (double charge on duplicate order) and B2 (amount tampering) bugs
    fakeStoreServer = createServer(async (req, res) => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';

      // Admin state
      if (url === '/__admin/state') {
        const auth = req.headers['x-payclinic-admin'];
        if (auth !== adminSecret) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'unauthorized' }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({
            merchantOrders: Array.from(orders.values()),
            webhookDeliveries: [],
          }),
        );
      }

      // Admin reset
      if (url === '/__admin/reset') {
        const auth = req.headers['x-payclinic-admin'];
        if (auth !== adminSecret) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'unauthorized' }));
        }
        orders.clear();
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }

      // Products catalog
      if (url === '/api/products') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify([
            {
              sku: 'tee-001',
              name: 'Classic Tee',
              description: 'Cotton t-shirt',
              price: '25.00',
              currency: 'USD',
              merchantId: 'merchant-1',
            },
            {
              sku: 'mug-003',
              name: 'Ceramic Mug',
              description: 'Coffee mug',
              price: '12.00',
              currency: 'USD',
              merchantId: 'merchant-1',
            },
            {
              sku: 'jp-pen-01',
              name: 'Gel Pen',
              description: 'Imported pen',
              price: '1200',
              currency: 'JPY',
              merchantId: 'merchant-1',
            },
          ]),
        );
      }

      // Create order
      if (url === '/api/orders' && method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body || '{}');

        // B2 bug: if clientTotal is sent, store uses clientTotal instead of 25.00
        const total = parsed.clientTotal ?? '25.00';
        const cartId = parsed.cartId ?? 'default-cart';

        // Call PayPal proxy
        const paypalRes = await fetch(`${paypalProxyUrl}/v2/checkout/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [
              {
                custom_id: cartId,
                amount: { currency_code: 'USD', value: total },
              },
            ],
          }),
        });
        const paypalOrder = (await paypalRes.json()) as {
          id?: string;
          links?: Array<{ rel?: string; href?: string }>;
        };
        const paypalId = paypalOrder.id ?? `sim-ord-${orders.size + 1}`;

        orders.set(paypalId, {
          id: `mo-${orders.size + 1}`,
          cartId,
          paypalOrderId: paypalId,
          status: 'created',
          paid: false,
          capturedTotal: '0.00',
          refundedTotal: '0.00',
          total,
        });

        const approveLink =
          paypalOrder.links?.find((l) => l.rel === 'approve')?.href ??
          `http://127.0.0.1/__sim/orders/${paypalId}/approve`;

        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({
            merchantOrderId: `mo-${orders.size}`,
            orderId: paypalId,
            approveUrl: approveLink,
          }),
        );
      }

      // Capture order
      if (url.startsWith('/api/orders/') && url.endsWith('/capture') && method === 'POST') {
        const parts = url.split('/');
        const orderId = parts[3] ?? '';
        const order = orders.get(orderId);
        if (!order) {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'not found' }));
        }

        // Call PayPal proxy to capture
        const paypalRes = await fetch(
          `${paypalProxyUrl}/v2/checkout/orders/${order.paypalOrderId}/capture`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          },
        );
        const captureData = (await paypalRes.json()) as Record<string, unknown>;

        order.status = 'paid';
        order.paid = true;
        order.capturedTotal = order.total ?? '25.00';

        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, status: 'COMPLETED', ...captureData }));
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => fakeStoreServer.listen(0, '127.0.0.1', resolve));
    const port = (fakeStoreServer.address() as AddressInfo).port;
    fakeStoreUrl = `http://127.0.0.1:${port}`;

    projectsRepo.updateProject('remote-proj-1', {
      baseUrl: fakeStoreUrl,
    });

    // Create run for B1 and B2
    const res = await apiServer.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        projectId: 'remote-proj-1',
        target: 'store',
        mode: 'offline',
        scenarios: ['B1', 'B2'],
      },
    });

    expect(res.statusCode).toBe(202);
    const { runId } = res.json();

    let run = repos.getRun(runId);
    while (run?.status === 'queued' || run?.status === 'running') {
      await new Promise((r) => setTimeout(r, 100));
      run = repos.getRun(runId);
    }

    expect(run?.status).toBe('completed');

    // Findings verification: B1 -> I-01, B2 -> I-02
    const findings = repos.listFindings(runId);
    expect(findings.length).toBe(2);

    const findingKeys = findings.map((f) => `${f.scenarioKey}:${f.invariantKey}`).sort();
    expect(findingKeys).toEqual(['B1:I-01', 'B2:I-02']);

    // Check Run detail returns projectName
    const detailRes = await apiServer.inject({
      method: 'GET',
      url: `/api/runs/${runId}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.run.projectName).toBe('Custom Remote Shopify');

    // Check Run summary returns projectName
    const listRes = await apiServer.inject({
      method: 'GET',
      url: '/api/runs',
    });
    expect(listRes.statusCode).toBe(200);
    const summaries = listRes.json();
    const runSummary = summaries.find((s: { id: string }) => s.id === runId);
    expect(runSummary.projectName).toBe('Custom Remote Shopify');
  });

  it('handles an incompatible remote site with scenario error without crashing', async () => {
    // Incompatible store that throws 500 on order creation
    fakeStoreServer = createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/api/products') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify([
            {
              sku: 'tee-001',
              name: 'Tee',
              description: 'Tee',
              price: '25.00',
              currency: 'USD',
              merchantId: 'm1',
            },
          ]),
        );
      }
      if (url === '/__admin/reset') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      // Incompatible site returns 500 on admin state
      if (url === '/__admin/state') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Incompatible store 500' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => fakeStoreServer.listen(0, '127.0.0.1', resolve));
    const port = (fakeStoreServer.address() as AddressInfo).port;
    fakeStoreUrl = `http://127.0.0.1:${port}`;

    projectsRepo.updateProject('remote-proj-1', {
      baseUrl: fakeStoreUrl,
    });

    const res = await apiServer.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        projectId: 'remote-proj-1',
        target: 'store',
        mode: 'offline',
        scenarios: ['B1'],
      },
    });

    expect(res.statusCode).toBe(202);
    const { runId } = res.json();

    let run = repos.getRun(runId);
    while (run?.status === 'queued' || run?.status === 'running') {
      await new Promise((r) => setTimeout(r, 100));
      run = repos.getRun(runId);
    }

    const scenarios = repos.listScenarios(runId);
    expect(run?.status).toBe('completed');

    // Scenario should be recorded as error, not crash
    expect(scenarios.length).toBe(1);
    expect(scenarios[0]!.status).toBe('error');
    expect(scenarios[0]!.error).toMatch(/500/);
  });
});
