import type { FastifyInstance } from 'fastify';
import type { StoreDb } from './db';

export interface AdminDeps {
  db: StoreDb;
}

/** Registers state/reset endpoints used only by the runner. */
export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  app.get('/__admin/state', async () => deps.db.state());

  app.post('/__admin/reset', async () => {
    deps.db.reset();
    return { ok: true };
  });
}
