import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '@payclinic/cli';
import {
  createProjectsRepo,
  createRepos,
  loadConfig,
  openDb,
  type Database,
  type Repos,
} from '@payclinic/core';

describe('Public PayPal Proxy Mount (/paypal-proxy/:token/*)', () => {
  let db: Database;
  let repos: Repos;
  let bus: EventEmitter;
  let mockTargetServer: Server;
  let mockTargetUrl: string;

  beforeEach(async () => {
    db = openDb(':memory:');
    repos = createRepos(db);
    bus = new EventEmitter();

    mockTargetServer = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'ORD-MOCK', status: 'CREATED' }));
    });

    await new Promise<void>((resolve) => mockTargetServer.listen(0, '127.0.0.1', resolve));
    const port = (mockTargetServer.address() as AddressInfo).port;
    mockTargetUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => mockTargetServer.close(() => resolve()));
    db.close();
  });

  it('rejects an unknown proxy token with 404', async () => {
    const app = createApi({
      repos,
      config: loadConfig({}),
      bus,
      orchestrator: { startRun: () => 'run-1', prescribe: async () => {}, protect: async () => {} } as any,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/paypal-proxy/unknown-token-123/v2/checkout/orders',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Unknown proxy token' });
    await app.close();
  });

  it('answers 409 when no run is active for that token', async () => {
    const projectsRepo = createProjectsRepo(db);
    projectsRepo.insertProject({
      id: 'proj-1',
      name: 'Custom Remote Store',
      kind: 'remote',
      proxyToken: 'token-active-123',
    });

    const app = createApi({
      repos,
      projectsRepo,
      config: loadConfig({}),
      bus,
      orchestrator: { startRun: () => 'run-1', prescribe: async () => {}, protect: async () => {} } as any,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/paypal-proxy/token-active-123/v2/checkout/orders',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No PayClinic run active' });
    await app.close();
  });

  it('forwards and records a store step when an active run exists', async () => {
    const projectsRepo = createProjectsRepo(db);
    projectsRepo.insertProject({
      id: 'proj-1',
      name: 'Custom Remote Store',
      kind: 'remote',
      proxyToken: 'valid-token-777',
    });

    // Create an active run for proj-1
    repos.insertRun({
      id: 'run-active-1',
      projectId: 'proj-1',
      target: 'store',
      mode: 'offline',
      scenarioKeys: ['B1'],
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    repos.insertScenario({
      id: 'run-active-1-scen-1',
      runId: 'run-active-1',
      key: 'B1',
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    const app = createApi({
      repos,
      projectsRepo,
      config: loadConfig({}),
      bus,
      orchestrator: { startRun: () => 'run-1', prescribe: async () => {}, protect: async () => {} } as any,
    });

    const recordedEvents: any[] = [];
    bus.on('event', (ev) => recordedEvents.push(ev));

    const res = await app.inject({
      method: 'POST',
      url: '/paypal-proxy/valid-token-777/v1/oauth2/token',
      headers: {
        'content-type': 'application/json',
      },
      payload: { grant_type: 'client_credentials' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('id');

    // Verify step was recorded into active run
    const steps = repos.listSteps('run-active-1');
    expect(steps.length).toBeGreaterThanOrEqual(1);

    const step = steps[0]!;
    expect(step.actor).toBe('store');
    expect(step.method).toBe('POST');
    expect(step.label).toContain('POST /v1/oauth2/token');
    expect(step.responseStatus).toBe(200);

    // Verify SSE event was emitted
    expect(recordedEvents.some((e) => e.type === 'step.recorded')).toBe(true);

    await app.close();
  });
});
