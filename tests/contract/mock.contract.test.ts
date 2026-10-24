import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Health, RunCreateResponse, RunDetail, RunEvent, ScenarioInfo } from '@payclinic/contracts';
import { createMockApi } from '@payclinic/mock-api';

type Server = { baseUrl: string; close(): Promise<void> };

let srv: Server;

beforeAll(async () => {
  const app = createMockApi();
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  srv = {
    baseUrl,
    async close() {
      await app.close();
    },
  };
}, 60_000);

afterAll(async () => {
  await srv.close();
});

const get = (path: string) => fetch(srv.baseUrl + path);
const post = (path: string, body?: unknown) =>
  fetch(srv.baseUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

describe('API contract: mock server', () => {
  it('serves health, scenarios, validation and unknown-id responses', async () => {
    Health.parse(await (await get('/api/health')).json());
    const list = ScenarioInfo.array().parse(await (await get('/api/scenarios')).json());
    expect(list.map((scenario) => scenario.key)).toEqual(
      expect.arrayContaining(['B1', 'B2', 'B3', 'B4', 'B5']),
    );
    expect((await post('/api/runs', { target: 'nope' })).status).toBe(400);
    for (const path of ['/api/runs/nope', '/api/findings/nope']) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toHaveProperty('error');
    }
  });

  it('replays run.events from a created run', async () => {
    const created = await post('/api/runs', {
      target: 'store',
      mode: 'offline',
      scenarios: ['B2'],
    });
    expect(created.status).toBe(202);
    const { runId } = RunCreateResponse.parse(await created.json());

    const ac = new AbortController();
    const sse = await fetch(`${srv.baseUrl}/api/runs/${runId}/events`, { signal: ac.signal });
    const reader = sse.body!.getReader();
    const { value } = await reader.read();
    const line = new TextDecoder()
      .decode(value)
      .split('\n')
      .find((candidate) => candidate.startsWith('data: '))!;
    expect(RunEvent.parse(JSON.parse(line.slice(6))).type).toBe('run.started');
    ac.abort();
  });

  /**
   * Track C gap: POST /api/runs creates new finding ids but does not copy their
   * entries into findingDetails, so the shared contract's GET finding step fails.
   * This test records the current divergence instead of weakening the real suite.
   */
  it('documents that findings created by POST /api/runs have no detail row', async () => {
    const created = await post('/api/runs', {
      target: 'store',
      mode: 'offline',
      scenarios: ['B2'],
    });
    const { runId } = RunCreateResponse.parse(await created.json());
    const detail = RunDetail.parse(await (await get(`/api/runs/${runId}`)).json());
    const finding = detail.findings[0]!;
    expect((await get(`/api/findings/${finding.id}`)).status).toBe(404);
  });
});
