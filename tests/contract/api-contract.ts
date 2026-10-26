import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FindingDetail,
  Health,
  RunCreateResponse,
  RunDetail,
  RunEvent,
  RunSummary,
  ScenarioInfo,
} from '@payclinic/contracts';

type Server = { baseUrl: string; close(): Promise<void> };

async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  ms = 90_000,
  every = 300,
): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, every));
  }
}

export function describeApiContract(name: string, start: () => Promise<Server>) {
  describe(`API contract: ${name}`, () => {
    let srv: Server;
    beforeAll(async () => {
      srv = await start();
    }, 60_000);
    afterAll(async () => {
      await srv.close();
    });
    const get = (p: string) => fetch(srv.baseUrl + p);
    const post = (p: string, body?: unknown) =>
      fetch(srv.baseUrl + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });

    it('GET /api/health', async () => {
      Health.parse(await (await get('/api/health')).json());
    });
    it('GET /api/scenarios lists B1..B5 with titles', async () => {
      const list = ScenarioInfo.array().parse(await (await get('/api/scenarios')).json());
      expect(list.map((s) => s.key)).toEqual(
        expect.arrayContaining(['B1', 'B2', 'B3', 'B4', 'B5']),
      );
    });
    it('rejects an invalid create body with 400', async () => {
      expect((await post('/api/runs', { target: 'nope' })).status).toBe(400);
    });
    it('returns JSON 404 for unknown run and finding', async () => {
      for (const p of ['/api/runs/nope', '/api/findings/nope']) {
        const r = await get(p);
        expect(r.status).toBe(404);
        expect(await r.json()).toHaveProperty('error');
      }
    });
    it('creates a run, completes it, exposes findings and steps, replays events, prescribes and verifies', async () => {
      const created = await post('/api/runs', {
        target: 'store',
        mode: 'offline',
        scenarios: ['B2'],
      });
      expect(created.status).toBe(202);
      const { runId } = RunCreateResponse.parse(await created.json());
      const detail = await waitFor(
        async () => RunDetail.parse(await (await get(`/api/runs/${runId}`)).json()),
        (d) => d.run.status === 'completed',
      );
      expect(detail.findings.length).toBeGreaterThan(0);
      expect(detail.score.score).toBeLessThan(100);
      const list = RunSummary.array().parse(await (await get('/api/runs')).json());
      expect(list.some((r) => r.id === runId)).toBe(true);
      const f = detail.findings[0]!;
      const fd = FindingDetail.parse(await (await get(`/api/findings/${f.id}`)).json());
      expect(fd.steps.length).toBeGreaterThan(0);
      const ac = new AbortController();
      const sse = await fetch(`${srv.baseUrl}/api/runs/${runId}/events`, { signal: ac.signal });
      const reader = sse.body!.getReader();
      const { value } = await reader.read();
      const line = new TextDecoder()
        .decode(value)
        .split('\n')
        .find((l) => l.startsWith('data: '))!;
      expect(RunEvent.parse(JSON.parse(line.slice(6))).type).toBe('run.started');
      ac.abort();
      expect((await post(`/api/findings/${f.id}/prescribe`)).status).toBe(202);
      const after = await waitFor(
        async () => FindingDetail.parse(await (await get(`/api/findings/${f.id}`)).json()),
        (d) => d.finding.state === 'verified' || d.finding.state === 'unverified',
      );
      expect(after.finding.state).toBe('verified');
      expect(after.patch).not.toBeNull();
      expect(after.verify?.verified).toBe(true);
    }, 180_000);
  });
}
