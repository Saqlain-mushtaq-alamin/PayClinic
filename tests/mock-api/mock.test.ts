import { describe, expect, it } from 'vitest';
import {
  FindingDetail,
  Health,
  PolicyResponse,
  RunCreateResponse,
  RunDetail,
  RunEvent,
  RunSummary,
  ScenarioInfo,
  StepList,
} from '@payclinic/contracts';
import { createMockApi } from '@payclinic/mock-api';

const get = (app: ReturnType<typeof createMockApi>, url: string) =>
  app.inject({ method: 'GET', url });

describe('mock api', () => {
  it('serves health matching the contract', async () => {
    const app = createMockApi();
    try {
      const res = await get(app, '/api/health');
      expect(res.statusCode).toBe(200);
      expect(() => Health.parse(res.json())).not.toThrow();
    } finally {
      await app.close();
    }
  });

  it('lists the three mock runs as RunSummary', async () => {
    const app = createMockApi();
    try {
      const res = await get(app, '/api/runs');
      expect(res.statusCode).toBe(200);
      const runs = RunSummary.array().parse(res.json());
      expect(runs).toHaveLength(3);
      expect(runs.map((r) => r.id)).toEqual(['run-1', 'run-2', 'run-3']);
    } finally {
      await app.close();
    }
  });

  it('serves run-1 as RunDetail with score 70 and three open findings', async () => {
    const app = createMockApi();
    try {
      const res = await get(app, '/api/runs/run-1');
      expect(res.statusCode).toBe(200);
      const detail = RunDetail.parse(res.json());
      expect(detail.score.score).toBe(70);
      expect(detail.findings).toHaveLength(3);
      expect(detail.findings.every((f) => f.state === 'open')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('serves a FindingDetail and 404 with an error body for unknown ids', async () => {
    const app = createMockApi();
    try {
      const res = await get(app, '/api/findings/fnd-run-1-1');
      expect(res.statusCode).toBe(200);
      expect(() => FindingDetail.parse(res.json())).not.toThrow();

      const missing = await get(app, '/api/findings/does-not-exist');
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toHaveProperty('error');
    } finally {
      await app.close();
    }
  });

  it('serves steps and scenario metadata', async () => {
    const app = createMockApi();
    try {
      const steps = await get(app, '/api/runs/run-1/steps');
      expect(steps.statusCode).toBe(200);
      expect(StepList.parse(steps.json()).length).toBeGreaterThan(0);

      const scenarios = await get(app, '/api/scenarios');
      expect(scenarios.statusCode).toBe(200);
      expect(ScenarioInfo.array().parse(scenarios.json())).toHaveLength(8);
    } finally {
      await app.close();
    }
  });

  it('creates a new run that shows up in the runs list', async () => {
    const app = createMockApi();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { target: 'store', mode: 'offline', scenarios: ['B1', 'B2'] },
      });
      expect(created.statusCode).toBe(202);
      const { runId } = RunCreateResponse.parse(created.json());
      const runs = RunSummary.array().parse((await get(app, '/api/runs')).json());
      expect(runs.map((r) => r.id)).toContain(runId);
    } finally {
      await app.close();
    }
  });

  it('serves the agent policy for run-3', async () => {
    const app = createMockApi();
    try {
      const res = await get(app, '/api/runs/run-3/policy');
      expect(res.statusCode).toBe(200);
      const body = PolicyResponse.parse(res.json());
      expect(body.policy?.merchantAllowlist).toContain('demo-store');
    } finally {
      await app.close();
    }
  });

  it('streams the first RunEvent as SSE for run-1', async () => {
    const app = createMockApi();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    try {
      const res = await fetch(`${address}/api/runs/run-1/events`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!buffer.includes('\n\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      const first = buffer.split('\n\n')[0]!;
      const dataLine = first.split('\n').find((line) => line.startsWith('data: '));
      expect(dataLine).toBeDefined();
      const event = RunEvent.parse(JSON.parse(dataLine!.slice('data: '.length)));
      expect(event.type).toBe('run.started');
      controller.abort();
    } finally {
      await app.close();
    }
  });
});
