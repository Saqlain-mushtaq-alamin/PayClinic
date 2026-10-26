import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApi } from './api';
import { buildRuntime } from './wire';

/** Starts the REST + SSE API on the configured API port. */
export async function runServer(): Promise<void> {
  const runtime = buildRuntime(process.env);
  const app = createApi({
    orchestrator: runtime.orchestrator,
    repos: runtime.repos,
    config: runtime.config,
    bus: runtime.bus,
    version: process.env.PAYCLINIC_VERSION ?? '0.0.0',
  });

  const address = await app.listen({
    host: process.env.HOST ?? '127.0.0.1',
    port: runtime.config.ports.api,
  });
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
