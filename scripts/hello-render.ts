import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';

/** Builds the Render hello-world app; P2-A07 replaces it with the real API. */
export function createHelloApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/healthz', async () => ({ ok: true }));
  return app;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? 3000);
  const app = createHelloApp();
  try {
    await app.listen({ host: '0.0.0.0', port });
    console.log(`PAYCLINIC_HELLO_LISTENING ${port}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
