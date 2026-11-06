import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi } from '@payclinic/cli';
import {
  createOrchestrator,
  createRepos,
  loadConfig,
  openDb,
  type Orchestrator,
  type Repos,
} from '@payclinic/core';
import { SCENARIOS } from '../../scenarios';

const distDir = join(tmpdir(), `payclinic-static-test-${process.pid}`);

let app: ReturnType<typeof createApi>;
let baseUrl: string;

beforeAll(async () => {
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    join(distDir, 'index.html'),
    '<!doctype html><html><body>PayClinic dashboard</body></html>',
    'utf8',
  );
  writeFileSync(join(distDir, 'favicon.ico'), 'ico', 'utf8');

  const repos: Repos = createRepos(openDb(':memory:'));
  const bus = new EventEmitter();
  const orchestrator: Orchestrator = createOrchestrator({
    repos,
    config: loadConfig({}),
    scenarios: SCENARIOS,
    repoRoot: process.cwd(),
    storeSourceDir: join(process.cwd(), 'apps/buggy-store'),
    prescriber: async () => {
      throw new Error('not used');
    },
    newId: () => 'id-1',
    now: () => new Date('2026-11-06T10:00:00Z'),
    bus,
  });
  app = createApi({ orchestrator, repos, config: loadConfig({}), bus, staticDir: distDir });
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
}, 30_000);

afterAll(async () => {
  await app.close();
  rmSync(distDir, { recursive: true, force: true });
});

describe('static dashboard hosting', () => {
  it('GET / returns the built index.html', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('PayClinic dashboard');
  });

  it('GET /runs/abc (client route) falls back to index.html', async () => {
    const response = await fetch(`${baseUrl}/runs/abc`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('PayClinic dashboard');
  });

  it('GET /api/health still returns JSON', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('serves real asset files and 404s unknown asset paths', async () => {
    const asset = await fetch(`${baseUrl}/favicon.ico`);
    expect(asset.status).toBe(200);

    const missing = await fetch(`${baseUrl}/missing-9d21.js`);
    expect(missing.status).toBe(404);
  });
});
