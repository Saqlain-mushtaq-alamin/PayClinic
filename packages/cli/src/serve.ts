import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanupTmp } from '@payclinic/core';
import { createApi } from './api';
import { openPrFromEnv } from './open-pr';
import { buildRuntime } from './wire';

/** Resolves the listen port: Render-style `PORT` wins over the configured API port. */
function listenPort(configured: number): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return configured;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return configured;
  return parsed;
}

/**
 * Resolves the bind host. A injected `PORT` (Render and similar hosts) means
 * external traffic must reach us, so bind all interfaces unless HOST says otherwise.
 */
function listenHost(): string {
  if (process.env.HOST !== undefined && process.env.HOST !== '') return process.env.HOST;
  return process.env.PORT !== undefined && process.env.PORT !== '' ? '0.0.0.0' : '127.0.0.1';
}

/** Starts the REST + SSE API on the configured API port (or `PORT` if set). */
export async function runServer(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  cleanupTmp(repoRoot);

  const runtime = buildRuntime(process.env);
  const distDir = join(repoRoot, 'apps', 'dashboard', 'dist');
  const staticDir = existsSync(join(distDir, 'index.html')) ? distDir : undefined;
  const openPrFor = openPrFromEnv(process.env, { repos: runtime.repos });
  const app = createApi({
    orchestrator: runtime.orchestrator,
    repos: runtime.repos,
    config: runtime.config,
    bus: runtime.bus,
    settingsStore: runtime.settingsStore,
    getConfig: runtime.getConfig,
    version: process.env.PAYCLINIC_VERSION ?? '0.0.0',
    staticDir,
    ...(openPrFor === undefined ? {} : { openPr: (finding) => openPrFor(finding.id) }),
  });

  let address: string;
  try {
    address = await app.listen({
      host: listenHost(),
      port: listenPort(runtime.config.ports.api),
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EADDRINUSE'
    ) {
      throw new Error(`port ${listenPort(runtime.config.ports.api)} is in use`);
    }
    throw error;
  }
  process.stdout.write(`payclinic api listening on ${address}\n`);

  const shutdown = (): void => {
    app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`payclinic: failed to close the api: ${message}\n`);
        process.exit(1);
      });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  runServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`payclinic: ${message}\n`);
    process.exitCode = 1;
  });
}
