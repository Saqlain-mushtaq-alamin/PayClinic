import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanupTmp } from '@payclinic/core';
import { createApi } from './api';
import { openPrFromEnv } from './open-pr';
import { buildRuntime } from './wire';

/** Starts the REST + SSE API on the configured API port. */
export async function runServer(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  cleanupTmp(repoRoot);

  const runtime = buildRuntime(process.env);
  const openPrFor = openPrFromEnv(process.env, { repos: runtime.repos });
  const app = createApi({
    orchestrator: runtime.orchestrator,
    repos: runtime.repos,
    config: runtime.config,
    bus: runtime.bus,
    version: process.env.PAYCLINIC_VERSION ?? '0.0.0',
    ...(openPrFor === undefined ? {} : { openPr: (finding) => openPrFor(finding.id) }),
  });

  let address: string;
  try {
    address = await app.listen({
      host: process.env.HOST ?? '127.0.0.1',
      port: runtime.config.ports.api,
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EADDRINUSE'
    ) {
      throw new Error(`port ${runtime.config.ports.api} is in use`);
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
