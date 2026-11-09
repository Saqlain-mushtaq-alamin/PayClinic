import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UnsafeTargetError,
  assertSafeTarget,
  createProjectsRepo,
  encrypt,
  isPrivateOrLocalIp,
  loadConfig,
  openDb,
} from '@payclinic/core';
import { createApi } from '@payclinic/cli';

describe('Projects Backend & Target Guard (SSRF)', () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS;
    delete process.env.PAYCLINIC_ADMIN_TOKEN;
  });

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it('isPrivateOrLocalIp correctly identifies dangerous and private IPs', () => {
    expect(isPrivateOrLocalIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('127.10.20.30')).toBe(true);
    expect(isPrivateOrLocalIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrLocalIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrLocalIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrLocalIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrLocalIp('::1')).toBe(true);
    expect(isPrivateOrLocalIp('::')).toBe(true);
    expect(isPrivateOrLocalIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateOrLocalIp('fe80::1')).toBe(true);
    expect(isPrivateOrLocalIp('fc00::1')).toBe(true);

    // Public IPs
    expect(isPrivateOrLocalIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrLocalIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrLocalIp('93.184.216.34')).toBe(false);
    expect(isPrivateOrLocalIp('2606:4700:4700::1111')).toBe(false);
  });

  it('SSRF guard blocks 127.0.0.1, 10.0.0.5, 169.254.169.254, and private hostnames', async () => {
    await expect(assertSafeTarget('http://127.0.0.1:8080/')).rejects.toThrow(UnsafeTargetError);
    await expect(assertSafeTarget('http://10.0.0.5/api')).rejects.toThrow(UnsafeTargetError);
    await expect(assertSafeTarget('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      UnsafeTargetError,
    );
    await expect(assertSafeTarget('http://localhost:3000/')).rejects.toThrow(UnsafeTargetError);
    await expect(assertSafeTarget('ftp://example.com/')).rejects.toThrow(UnsafeTargetError);

    // Mock DNS lookup resolving to a private IP
    const mockLookup = async () => [{ address: '10.100.1.50', family: 4 }];

    await expect(
      assertSafeTarget('http://internal.company.corp/api', {
        dnsLookup: mockLookup,
      }),
    ).rejects.toThrow(/resolves to private or loopback IP: 10\.100\.1\.50/);
  });

  it('SSRF guard allows targets when PAYCLINIC_ALLOW_PRIVATE_TARGETS=1', async () => {
    process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS = '1';

    const res1 = await assertSafeTarget('http://127.0.0.1:4000/api');
    expect(res1.url.hostname).toBe('127.0.0.1');

    const res2 = await assertSafeTarget('http://10.0.0.5/store');
    expect(res2.url.hostname).toBe('10.0.0.5');

    const res3 = await assertSafeTarget('http://169.254.169.254/meta-data');
    expect(res3.url.hostname).toBe('169.254.169.254');
  });

  it('builtin project is seeded once in openDb', () => {
    const db = openDb(':memory:');
    const repo = createProjectsRepo(db);

    const initial = repo.listProjects();
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      id: 'builtin',
      name: 'Demo store',
      kind: 'builtin',
    });

    // Re-running seeding logic does not duplicate
    db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, kind, proxy_token, created_at)
       VALUES ('builtin', 'Demo store', 'builtin', 'builtin', '1970-01-01T00:00:00.000Z')`,
    ).run();

    const second = repo.listProjects();
    expect(second).toHaveLength(1);
  });

  it('old DB gets the new project_id column via migration', () => {
    const tempDbPath = join(process.cwd(), '.payclinic-tmp', `test-migration-${Date.now()}.db`);
    try {
      // 1. Create a database with the old schema (without project_id column)
      const rawDb = new BetterSqlite3(tempDbPath);
      rawDb.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY, target TEXT NOT NULL, mode TEXT NOT NULL, scenario_keys TEXT NOT NULL,
          status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
          score_before REAL, score_after REAL, error TEXT
        );
      `);
      rawDb
        .prepare(
          `INSERT INTO runs (id, target, mode, scenario_keys, status, started_at)
         VALUES ('old-run-1', 'store', 'offline', '["B1"]', 'completed', '2026-01-01T00:00:00.000Z')`,
        )
        .run();
      rawDb.close();

      // 2. Open via openDb, triggering automatic migration
      const migratedDb = openDb(tempDbPath);
      const cols = migratedDb.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === 'project_id')).toBe(true);

      // Verify old row is preserved and has null project_id
      const row = migratedDb
        .prepare('SELECT id, project_id FROM runs WHERE id = ?')
        .get('old-run-1') as {
        id: string;
        project_id: string | null;
      };
      expect(row.id).toBe('old-run-1');
      expect(row.project_id).toBeNull();

      migratedDb.close();
    } finally {
      rmSync(tempDbPath, { force: true });
    }
  });

  it('admin secret is never returned in API responses', async () => {
    const db = openDb(':memory:');
    const projectsRepo = createProjectsRepo(db);
    const rawSecret = 'SUPER_SECRET_PROJECT_ADMIN_KEY_ABC123';

    projectsRepo.insertProject({
      id: 'proj-1',
      name: 'Custom Store',
      kind: 'remote',
      baseUrl: 'https://example.com/store',
      adminSecretEncrypted: encrypt(rawSecret),
      proxyToken: 'token12345',
      repoOwner: 'octocat',
      repoName: 'hello-world',
    });

    const bus = new EventEmitter();
    const config = loadConfig({ AI_PROVIDER: 'fake', DB_PATH: ':memory:' });
    const app = createApi({
      orchestrator: { startRun: () => 'r1' } as any,
      repos: { listRuns: () => [], getRun: () => null } as any,
      projectsRepo,
      config,
      bus,
    });

    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);

    const rawJson = res.payload;
    expect(rawJson).not.toContain(rawSecret);
    expect(rawJson).not.toContain('adminSecretEncrypted');

    const projects = res.json();
    const custom = projects.find((p: any) => p.id === 'proj-1');
    expect(custom.hasAdminSecret).toBe(true);
    expect(custom.proxyUrl).toMatch(/\/(?:paypal-)?proxy\/token12345$/);
    expect(custom.adminSecret).toBeUndefined();
    expect(custom.adminSecretEncrypted).toBeUndefined();
  });

  it('builtin project cannot be edited or deleted', async () => {
    const db = openDb(':memory:');
    const projectsRepo = createProjectsRepo(db);
    const bus = new EventEmitter();
    const config = loadConfig({ AI_PROVIDER: 'fake', DB_PATH: ':memory:' });
    const app = createApi({
      orchestrator: { startRun: () => 'r1' } as any,
      repos: { listRuns: () => [], getRun: () => null } as any,
      projectsRepo,
      config,
      bus,
    });

    // PUT builtin returns 403
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/projects/builtin',
      payload: { name: 'New Name' },
    });
    expect(putRes.statusCode).toBe(403);
    expect(putRes.json().error).toMatch(/Cannot edit builtin/i);

    // DELETE builtin returns 403
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/projects/builtin',
    });
    expect(delRes.statusCode).toBe(403);
    expect(delRes.json().error).toMatch(/Cannot delete builtin/i);
  });

  it('POST /api/runs validates that the project exists', async () => {
    const db = openDb(':memory:');
    const projectsRepo = createProjectsRepo(db);
    const bus = new EventEmitter();
    const config = loadConfig({ AI_PROVIDER: 'fake', DB_PATH: ':memory:' });
    const app = createApi({
      orchestrator: { startRun: () => 'r-valid' } as any,
      repos: { listRuns: () => [], getRun: () => null } as any,
      projectsRepo,
      config,
      bus,
    });

    // Unknown project returns 400
    const failRes = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        projectId: 'does-not-exist',
        target: 'store',
        mode: 'offline',
        scenarios: ['B1'],
      },
    });
    expect(failRes.statusCode).toBe(400);
    expect(failRes.json().error).toMatch(/project 'does-not-exist' does not exist/i);

    // Builtin project succeeds
    const successRes = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: {
        projectId: 'builtin',
        target: 'store',
        mode: 'offline',
        scenarios: ['B1'],
      },
    });
    expect(successRes.statusCode).toBe(202);
    expect(successRes.json().runId).toBe('r-valid');
  });

  it('admin gate protects project writes when PAYCLINIC_ADMIN_TOKEN is set', async () => {
    process.env.PAYCLINIC_ADMIN_TOKEN = 'secret-gate-token-999';

    const db = openDb(':memory:');
    const projectsRepo = createProjectsRepo(db);
    const bus = new EventEmitter();
    const config = loadConfig({ AI_PROVIDER: 'fake', DB_PATH: ':memory:' });
    const app = createApi({
      orchestrator: { startRun: () => 'r1' } as any,
      repos: { listRuns: () => [], getRun: () => null } as any,
      projectsRepo,
      config,
      bus,
    });

    // GET is allowed without token
    const getRes = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(getRes.statusCode).toBe(200);

    // POST without token fails 401
    const postNoToken = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'My New Remote' },
    });
    expect(postNoToken.statusCode).toBe(401);

    // POST with token succeeds 201
    const postWithToken = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { authorization: 'Bearer secret-gate-token-999' },
      payload: { name: 'My New Remote' },
    });
    expect(postWithToken.statusCode).toBe(201);
    expect(postWithToken.json().name).toBe('My New Remote');
  });
});
