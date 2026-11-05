import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ChildRegistry,
  cleanupTmp,
  createOrchestrator,
  createRepos,
  loadConfig,
  openDb,
  startStore,
  waitForStoreReady,
  type Prescriber,
} from '@payclinic/core';

const repoRoot = join(__dirname, '../..');
const alive = (c: ReturnType<typeof spawn>) => c.exitCode === null && c.signalCode === null;

describe('ChildRegistry', () => {
  it('kills every registered child on disposeAll and is idempotent', async () => {
    const reg = new ChildRegistry();
    const loop = () =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const a = loop();
    const b = loop();
    reg.add(a);
    reg.add(b);
    expect(reg.size()).toBe(2);
    await reg.disposeAll();
    await reg.disposeAll();
    expect(alive(a)).toBe(false);
    expect(alive(b)).toBe(false);
    expect(reg.size()).toBe(0);
  });
});

describe('waitForStoreReady', () => {
  it('rejects with "store did not answer" when the server accepts connections but never responds', async () => {
    const server = createServer(() => {});
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as { port: number };
    try {
      await expect(
        waitForStoreReady(`http://127.0.0.1:${port}`, { timeoutMs: 1000 }),
      ).rejects.toThrow(/store did not answer/);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  it('resolves when the server responds with 200 OK', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'p1' }]));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as { port: number };
    try {
      await expect(
        waitForStoreReady(`http://127.0.0.1:${port}`, { timeoutMs: 1000 }),
      ).resolves.toBeUndefined();
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('cleanupTmp', () => {
  it('removes .payclinic-tmp and stale data/*.db-journal and is safe when it does not exist', () => {
    const root = join(repoRoot, 'data', 'cleanup-test');
    mkdirSync(join(root, '.payclinic-tmp', 'verify-x'), { recursive: true });
    writeFileSync(join(root, '.payclinic-tmp', 'verify-x', 'f.txt'), 'x');
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'test.db-journal'), 'journal');
    writeFileSync(join(root, 'data', 'test.db-wal'), 'wal');
    writeFileSync(join(root, 'data', 'keep.db'), 'database');

    cleanupTmp(root);
    expect(existsSync(join(root, '.payclinic-tmp'))).toBe(false);
    expect(existsSync(join(root, 'data', 'test.db-journal'))).toBe(false);
    expect(existsSync(join(root, 'data', 'test.db-wal'))).toBe(false);
    expect(existsSync(join(root, 'data', 'keep.db'))).toBe(true);
    expect(() => cleanupTmp(root)).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });
});

describe('startStore retry', () => {
  it('retries once when child exits before listening and succeeds on second attempt', async () => {
    const testDir = join(repoRoot, 'data', 'store-retry-test');
    const srcDir = join(testDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    const counterFile = join(testDir, 'counter.txt');
    writeFileSync(counterFile, '0', 'utf8');

    writeFileSync(
      join(srcDir, 'server.ts'),
      `
import { readFileSync, writeFileSync } from 'node:fs';
const c = Number(readFileSync(${JSON.stringify(counterFile)}, 'utf8'));
if (c === 0) {
  writeFileSync(${JSON.stringify(counterFile)}, '1', 'utf8');
  process.exit(1);
}
console.log('PAYCLINIC_STORE_LISTENING 49999');
setInterval(() => {}, 1000);
`,
      'utf8',
    );

    try {
      const store = await startStore({
        sourceDir: testDir,
        paypalBaseUrl: 'http://127.0.0.1:4010',
      });
      expect(store.port).toBe(49999);
      await store.stop();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails with same message format when second attempt also exits', async () => {
    const testDir = join(repoRoot, 'data', 'store-fail-test');
    const srcDir = join(testDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, 'server.ts'),
      `process.stderr.write('fatal crash\\n'); process.exit(42);\n`,
      'utf8',
    );

    try {
      await expect(
        startStore({ sourceDir: testDir, paypalBaseUrl: 'http://127.0.0.1:4010' }),
      ).rejects.toThrow(/Store process exited before listening \(code 42.*fatal crash/);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('run timeout', () => {
  it('fails a run that exceeds runTimeoutMs, then processes the next queued run', async () => {
    const repos = createRepos(openDb(':memory:'));
    const bus = new EventEmitter();
    const hang = () => new Promise<void>(() => {});
    const prescriber: Prescriber = async () => {
      throw new Error('not used');
    };
    let n = 0;
    // Both scenarios are fakes so the second run only pays sim + proxy + store
    // boot. The timeout must still leave headroom for that boot under
    // full-suite load: 1500ms made this test flaky because the second run
    // competed for the same budget as the hang run.
    const quick = async () => undefined;
    const orch = createOrchestrator({
      repos,
      config: loadConfig({}),
      scenarios: { B1: hang, B2: quick },
      repoRoot,
      storeSourceDir: join(repoRoot, 'apps/buggy-store'),
      prescriber,
      newId: () => `h${++n}`,
      now: () => new Date('2026-10-18T10:00:00Z'),
      bus,
      runTimeoutMs: 15_000,
    });
    const first = orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B1'] });
    const second = orch.startRun({ target: 'store', mode: 'offline', scenarios: ['B2'] });
    await orch.idle();
    expect(repos.getRun(first)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/timed out/i),
    });
    expect(repos.getRun(second)!.status).toBe('completed');
  }, 120_000);
});
