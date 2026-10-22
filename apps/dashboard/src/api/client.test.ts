import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from './client';

const response = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const fetchImpl = (handler: (url: string) => Response) =>
  (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;

const run = {
  id: 'run-1',
  target: 'store',
  mode: 'offline',
  scenarioKeys: ['B1'],
  status: 'completed',
  startedAt: '2026-10-18T10:00:00.000Z',
  findingCount: 1,
};

describe('createApiClient', () => {
  it('parses a valid RunSummary list', async () => {
    const client = createApiClient(
      'http://api.test',
      fetchImpl(() => response([run])),
    );
    await expect(client.listRuns()).resolves.toEqual([run]);
  });

  it('throws when the response violates the contract schema', async () => {
    const client = createApiClient(
      'http://api.test',
      fetchImpl(() => response([{ id: 1 }])),
    );
    await expect(client.listRuns()).rejects.toThrow();
  });

  it('throws ApiError with the status on a 500', async () => {
    const client = createApiClient(
      'http://api.test',
      fetchImpl(() => response({ error: 'boom' }, 500)),
    );
    await expect(client.listRuns()).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'boom',
    });
    await expect(client.listRuns()).rejects.toBeInstanceOf(ApiError);
  });

  it('requests the run detail path with the encoded id', async () => {
    let requested = '';
    const client = createApiClient(
      'http://api.test',
      fetchImpl((url) => {
        requested = url;
        return response({
          run: { ...run, scenarioKeys: [], findingCount: undefined, score: undefined },
          scenarios: [],
          findings: [],
          score: { score: 100, penalties: [], unresolvedCount: 0, resolvedCount: 0 },
        });
      }),
    );
    await client.getRun('run/1');
    expect(requested).toBe('http://api.test/api/runs/run%2F1');
  });
});
