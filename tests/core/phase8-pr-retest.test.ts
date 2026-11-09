import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Finding, Patch, Run, Step } from '@payclinic/contracts';
import { createApi } from '@payclinic/cli';
import { PrNotAllowedError, createOpenPr, type GitHubLike } from '../../packages/cli/src/open-pr';
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

class FakeGitHubClient implements GitHubLike {
  refs = new Map<string, string>([['heads/main', 'base-sha-123']]);
  files = new Map<string, string>([
    ['src/orders.ts', 'export function createOrder() { return 100; }\n'],
  ]);
  createdBranches: Array<{ branch: string; sha: string }> = [];
  committedFiles: Array<{ path: string; branch: string; content: string }> = [];
  pullRequest: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body: string;
  } | null = null;

  async getRef(params: { ref: string }): Promise<{ data: { object: { sha: string } } }> {
    const sha = this.refs.get(params.ref);
    if (!sha) throw new Error(`Ref ${params.ref} not found`);
    return { data: { object: { sha } } };
  }

  async createRef(params: { ref: string; sha: string }): Promise<{ data: unknown }> {
    this.createdBranches.push({ branch: params.ref, sha: params.sha });
    this.refs.set(params.ref, params.sha);
    return { data: {} };
  }

  async getContent(params: { path: string; ref: string }): Promise<{
    data: { content?: string; encoding?: string; type?: string };
  }> {
    const content = this.files.get(params.path);
    if (content === undefined) throw new Error(`File ${params.path} not found`);
    return {
      data: {
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64',
        type: 'file',
      },
    };
  }

  async createOrUpdateFileContents(params: {
    owner: string;
    repo: string;
    path: string;
    branch: string;
    message: string;
    content: string;
  }): Promise<unknown> {
    this.committedFiles.push({
      path: params.path,
      branch: params.branch,
      content: Buffer.from(params.content, 'base64').toString('utf8'),
    });
    return {};
  }

  async createPullRequest(params: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<{ data: { html_url: string } }> {
    this.pullRequest = params;
    return { data: { html_url: `https://github.com/${params.owner}/${params.repo}/pull/42` } };
  }
}

describe('Phase 8: Pull Requests Permissions & Rules', () => {
  let db: Database;
  let repos: Repos;
  let projectsRepo: ProjectsRepo;
  let github: FakeGitHubClient;

  beforeEach(() => {
    db = openDb(':memory:');
    repos = createRepos(db);
    projectsRepo = createProjectsRepo(db);
    github = new FakeGitHubClient();

    projectsRepo.insertProject({
      id: 'remote-1',
      name: 'Remote Store',
      kind: 'remote',
      repoOwner: 'my-org',
      repoName: 'remote-store-app',
      repoBranch: 'main',
      sourceRoot: 'src',
      proxyToken: 'tok-1',
    });

    const run: Run = {
      id: 'run-rem-1',
      projectId: 'remote-1',
      target: 'store',
      mode: 'offline',
      scenarioKeys: ['B1'],
      status: 'completed',
      startedAt: '2026-10-18T10:00:00Z',
    };
    repos.insertRun(run);

    const builtinRun: Run = {
      id: 'run-builtin-1',
      projectId: 'builtin',
      target: 'store',
      mode: 'offline',
      scenarioKeys: ['B1'],
      status: 'completed',
      startedAt: '2026-10-18T10:00:00Z',
    };
    repos.insertRun(builtinRun);
  });

  it('rejects Open PR for open remote finding', async () => {
    const finding: Finding = {
      id: 'fnd-open-1',
      runId: 'run-rem-1',
      scenarioKey: 'B1',
      invariantKey: 'I-01',
      severity: 'high',
      title: 'Open Finding',
      summary: 'Cart race condition',
      evidenceStepIds: [],
      state: 'open',
      createdAt: '2026-10-18T10:00:00Z',
    };
    repos.insertFinding(finding);

    const patch: Patch = {
      id: 'p-1',
      findingId: 'fnd-open-1',
      edits: [
        {
          file: 'src/orders.ts',
          search: 'return 100;',
          replace: 'return 200;',
        },
      ],
      diff: 'diff --git ...',
      source: 'ai',
      createdAt: '2026-10-18T10:00:00Z',
    };
    repos.insertPatch(patch);

    const openPr = createOpenPr({
      github,
      repos,
      projectsRepo,
      now: () => new Date('2026-10-18T10:00:00Z'),
    });

    await expect(openPr('fnd-open-1')).rejects.toThrow(PrNotAllowedError);
  });

  it('allows Open PR for patched remote finding and includes note in body', async () => {
    const finding: Finding = {
      id: 'fnd-patched-1',
      runId: 'run-rem-1',
      scenarioKey: 'B1',
      invariantKey: 'I-01',
      severity: 'high',
      title: 'Patched Remote Finding',
      summary: 'Cart race condition',
      evidenceStepIds: ['step-ev-1'],
      state: 'patched',
      createdAt: '2026-10-18T10:00:00Z',
    };
    repos.insertFinding(finding);

    repos.insertScenario({
      id: 'sc-1',
      runId: 'run-rem-1',
      key: 'B1',
      status: 'failed',
      startedAt: '2026-10-18T10:00:00Z',
      finishedAt: '2026-10-18T10:00:01Z',
    });

    const step: Step = {
      id: 'step-ev-1',
      runId: 'run-rem-1',
      scenarioId: 'sc-1',
      seq: 1,
      actor: 'runner',
      method: 'POST',
      url: 'http://test.store/api/orders',
      requestHeaders: {},
      responseStatus: 422,
      responseHeaders: {},
      responseBody: { error: 'invalid total' },
      durationMs: 50,
      timestamp: '2026-10-18T10:00:00Z',
    };
    repos.insertSteps([step]);

    const patch: Patch = {
      id: 'p-2',
      findingId: 'fnd-patched-1',
      edits: [
        {
          file: 'src/orders.ts',
          search: 'return 100;',
          replace: 'return 200;',
        },
      ],
      diff: '+return 200;',
      source: 'ai',
      createdAt: '2026-10-18T10:00:00Z',
    };
    repos.insertPatch(patch);

    const openPr = createOpenPr({
      github,
      repos,
      projectsRepo,
      now: () => new Date('2026-10-18T10:00:00Z'),
    });

    const result = await openPr('fnd-patched-1');
    expect(result.prUrl).toBe('https://github.com/my-org/remote-store-app/pull/42');
    expect(github.pullRequest?.owner).toBe('my-org');
    expect(github.pullRequest?.repo).toBe('remote-store-app');
    expect(github.pullRequest?.body).toContain('Failing trace evidence');
    expect(github.pullRequest?.body).toContain(
      'Merge, deploy to your test environment, then press Re-test in PayClinic.',
    );
  });

  it('rejects Open PR for patched builtin finding (requires verified)', async () => {
    const finding: Finding = {
      id: 'fnd-builtin-patched',
      runId: 'run-builtin-1',
      scenarioKey: 'B1',
      invariantKey: 'I-01',
      severity: 'high',
      title: 'Builtin Patched Finding',
      summary: 'Cart race condition',
      evidenceStepIds: [],
      state: 'patched',
      createdAt: '2026-10-18T10:00:00Z',
    };
    repos.insertFinding(finding);

    const patch: Patch = {
      id: 'p-3',
      findingId: 'fnd-builtin-patched',
      edits: [
        {
          file: 'apps/buggy-store/src/routes/orders.ts',
          search: 'return 100;',
          replace: 'return 200;',
        },
      ],
      diff: 'diff...',
      source: 'ai',
      createdAt: '2026-10-18T10:00:00Z',
    };
    repos.insertPatch(patch);

    const openPr = createOpenPr({
      github,
      repos,
      projectsRepo,
      owner: 'default-owner',
      repo: 'default-repo',
      now: () => new Date('2026-10-18T10:00:00Z'),
    });

    await expect(openPr('fnd-builtin-patched')).rejects.toThrow(/is patched, not verified/);
  });
});

describe('Phase 8: Re-Test (POST /api/projects/:id/retest)', () => {
  let db: Database;
  let repos: Repos;
  let projectsRepo: ProjectsRepo;
  let bus: EventEmitter;
  let apiServer: ReturnType<typeof createApi>;
  let apiBaseUrl: string;
  let fakeStoreServer: Server;
  let fakeStoreUrl: string;
  let bugIsFixed = false;
  const adminSecret = 'retest-secret-123';
  const proxyToken = 'tok-retest-remote';

  beforeEach(async () => {
    process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS = '1';
    bugIsFixed = false;

    db = openDb(':memory:');
    repos = createRepos(db);
    projectsRepo = createProjectsRepo(db);
    bus = new EventEmitter();

    projectsRepo.insertProject({
      id: 'proj-retest-1',
      name: 'Retest Remote Site',
      kind: 'remote',
      baseUrl: 'http://127.0.0.1:0',
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
      prescriber: async () => ({
        explanation: {
          findingId: 'f1',
          rootCause: 'c',
          impact: 'i',
          whereInCode: { file: 'f', hint: 'h' },
          fixSummary: 's',
          model: 'm',
          createdAt: '2026-10-18T10:00:00Z',
        },
        patches: [],
      }),
      newId: () => `id-${Math.random().toString(36).slice(2, 9)}`,
      now: () => new Date(),
      bus,
    });

    apiServer = createApi({
      orchestrator: orch,
      repos,
      projectsRepo,
      config: loadConfig({}),
      bus,
      version: '0.0.0',
    });

    const apiAddress = await apiServer.listen({ host: '127.0.0.1', port: 0 });
    apiBaseUrl = apiAddress;

    const orders = new Map<string, Record<string, unknown>>();

    // Build the fake store server with mutable bugIsFixed toggle
    fakeStoreServer = createServer(async (req, res) => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';
      const auth = req.headers['x-payclinic-admin'];

      if (url === '/api/products' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify([
            { sku: 'tee-001', name: 'Tee', price: '25.00', currency: 'USD' },
            { sku: 'mug-003', name: 'Mug', price: '12.00', currency: 'USD' },
            { sku: 'jp-pen-01', name: 'Pen', price: '1200', currency: 'JPY' },
          ]),
        );
        return;
      }

      if (url === '/api/orders' && method === 'POST') {
        const bodyChunks: Buffer[] = [];
        for await (const chunk of req) bodyChunks.push(chunk as Buffer);
        const payload = JSON.parse(Buffer.concat(bodyChunks).toString('utf8'));

        // If bug is NOT fixed: accept clientTotal (B2 vulnerability)
        // If bug IS fixed: calculate actual price: 25.00 USD for tee-001
        const total = bugIsFixed ? '25.00' : (payload.clientTotal ?? '25.00');
        const cartId = payload.cartId ?? 'default-cart';

        const proxyBase = `${apiBaseUrl}/paypal-proxy/${proxyToken}`;
        const ppRes = await fetch(`${proxyBase}/v2/checkout/orders`, {
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

        const ppOrder = (await ppRes.json()) as { id: string };
        const paypalId = ppOrder.id;

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

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            merchantOrderId: `mo-${orders.size}`,
            orderId: paypalId,
            approveUrl: `http://127.0.0.1/__sim/orders/${paypalId}/approve`,
          }),
        );
        return;
      }

      if (url.startsWith('/api/orders/') && url.endsWith('/capture') && method === 'POST') {
        const parts = url.split('/');
        const orderId = parts[3] ?? '';
        const order = orders.get(orderId);
        if (!order) {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'not found' }));
        }

        const proxyBase = `${apiBaseUrl}/paypal-proxy/${proxyToken}`;
        const capRes = await fetch(`${proxyBase}/v2/checkout/orders/${orderId}/capture`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        const capData = (await capRes.json()) as Record<string, unknown>;

        order.status = 'paid';
        order.paid = true;
        order.capturedTotal = order.total ?? '25.00';

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'COMPLETED', ...capData }));
        return;
      }

      if (url === '/__admin/reset' && method === 'POST') {
        if (auth !== adminSecret) {
          res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        orders.clear();
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: true }));
        return;
      }

      if (url === '/__admin/state' && method === 'GET') {
        if (auth !== adminSecret) {
          res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            merchantOrders: Array.from(orders.values()),
            webhookDeliveries: [],
          }),
        );
        return;
      }

      res.writeHead(404).end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve) => {
      fakeStoreServer.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = fakeStoreServer.address() as AddressInfo;
    fakeStoreUrl = `http://127.0.0.1:${addr.port}`;

    projectsRepo.updateProject('proj-retest-1', {
      baseUrl: fakeStoreUrl,
    });
  });

  afterEach(async () => {
    delete process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS;
    await apiServer.close();
    await new Promise<void>((resolve) => fakeStoreServer.close(() => resolve()));
  });

  it('keeps finding state patched when site is still buggy, flips to verified when fixed', async () => {
    // 1. Run B2 diagnose initially against the buggy store
    const startRes = await apiServer.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        projectId: 'proj-retest-1',
        target: 'store',
        mode: 'offline',
        scenarios: ['B2'],
      },
    });

    expect(startRes.statusCode).toBe(202);
    const { runId } = JSON.parse(startRes.payload);

    // Wait for run to complete
    let completedRun;
    for (let i = 0; i < 50; i++) {
      completedRun = repos.getRun(runId);
      if (completedRun && completedRun.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(completedRun?.status).toBe('completed');

    const findingsBefore = repos.listFindings(runId);
    expect(findingsBefore.length).toBe(1);
    const findingB2 = findingsBefore[0]!;
    expect(findingB2.scenarioKey).toBe('B2');
    expect(findingB2.invariantKey).toBe('I-02');

    // Simulate AI prescribe setting finding state to 'patched'
    repos.updateFindingState(findingB2.id, 'patched');
    expect(repos.getFinding(findingB2.id)?.state).toBe('patched');

    // 2. Call Re-test while bugIsFixed is false: bug is still present!
    bugIsFixed = false;
    const retest1Res = await apiServer.inject({
      method: 'POST',
      url: '/api/projects/proj-retest-1/retest',
      payload: { runId },
    });

    if (retest1Res.statusCode !== 200) {
      console.log('retest1 failed payload:', retest1Res.payload);
    }
    expect(retest1Res.statusCode).toBe(200);
    const retest1Body = JSON.parse(retest1Res.payload);
    expect(retest1Body.ok).toBe(true);

    // Finding should STILL be 'patched'
    const findingAfterRetest1 = repos.getFinding(findingB2.id);
    expect(findingAfterRetest1?.state).toBe('patched');

    // 3. Now FIX the bug on the site
    bugIsFixed = true;

    const eventsEmitted: Array<{ type?: string; finding?: Finding }> = [];
    bus.on('event', (ev) => eventsEmitted.push(ev));

    // Call Re-test again: invariant should now PASS!
    const retest2Res = await apiServer.inject({
      method: 'POST',
      url: '/api/projects/proj-retest-1/retest',
      payload: { runId },
    });

    expect(retest2Res.statusCode).toBe(200);
    const retest2Body = JSON.parse(retest2Res.payload);
    expect(retest2Body.ok).toBe(true);
    expect(retest2Body.score).toBe(100);

    // Finding state should flip to 'verified'!
    const findingAfterRetest2 = repos.getFinding(findingB2.id);
    expect(findingAfterRetest2?.state).toBe('verified');

    // SSE events emitted
    expect(
      eventsEmitted.some((e) => e.type === 'finding.updated' && e.finding?.state === 'verified'),
    ).toBe(true);
    expect(eventsEmitted.some((e) => e.type === 'score.updated')).toBe(true);
  });
});
