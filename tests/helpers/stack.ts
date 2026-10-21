import { startSim } from '@payclinic/sim';
import { createApp } from '@payclinic/buggy-store';

export async function startStack(opts: { fetchImpl?: typeof fetch } = {}) {
  const sim = await startSim();
  const store = await createApp({
    paypalBaseUrl: sim.url,
    paypalClientId: 'id',
    paypalClientSecret: 'secret',
    dbPath: ':memory:',
    admin: true,
    fetchImpl: opts.fetchImpl,
  });
  await store.ready();
  const simState = async () => (await fetch(`${sim.url}/__sim/state`)).json() as Promise<any>;
  const approve = (orderId: string) =>
    fetch(`${sim.url}/__sim/orders/${orderId}/approve`, { method: 'POST' });
  const create = (payload: object) => store.inject({ method: 'POST', url: '/api/orders', payload });
  const capture = (orderId: string) =>
    store.inject({ method: 'POST', url: `/api/orders/${orderId}/capture`, payload: {} });
  const state = async () => (await store.inject({ method: 'GET', url: '/__admin/state' })).json();
  return {
    sim,
    store,
    simState,
    approve,
    create,
    capture,
    state,
    async close() {
      await store.close();
      await sim.close();
    },
  };
}
