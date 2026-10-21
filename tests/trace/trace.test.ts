import { afterEach, describe, expect, it } from 'vitest';
import { startSim } from '@payclinic/sim';
import { createRecorder, redactHeaders, startTraceProxy } from '@payclinic/core';

let n = 0;
const rec = () =>
  createRecorder({
    runId: 'r1',
    newId: () => `s${++n}`,
    now: () => new Date('2026-10-18T10:00:00Z'),
  });
const order = {
  intent: 'CAPTURE',
  purchase_units: [{ custom_id: 'c1', amount: { currency_code: 'USD', value: '25.00' } }],
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
});

async function setup() {
  const sim = await startSim();
  cleanup.push(sim.close);
  const recorder = rec();
  recorder.setScenario('scn-1');
  const proxy = await startTraceProxy({ target: sim.url, recorder });
  cleanup.push(() => proxy.stop());
  return { sim, recorder, proxy };
}

describe('redaction', () => {
  it('masks authorization and secret headers', () => {
    expect(
      redactHeaders({ Authorization: 'Bearer x', 'x-client-secret': 'y', accept: 'a' }),
    ).toEqual({ authorization: '***', 'x-client-secret': '***', accept: 'a' });
  });
});

describe('recorder', () => {
  it('allocates seq at start and returns steps sorted by seq even if they finish out of order', () => {
    const r = rec();
    r.setScenario('s');
    const a = r.start('runner');
    const b = r.start('store');
    const base = {
      method: 'GET',
      url: 'http://x/a',
      requestHeaders: {},
      requestBody: undefined,
      responseStatus: 200,
      responseHeaders: {},
      responseBody: undefined,
      durationMs: 1,
    };
    r.finish(b, base);
    r.finish(a, base);
    expect(r.steps().map((s) => s.seq)).toEqual([0, 1]);
    r.setScenario('s2');
    expect(r.start('runner')).toBe(0);
  });
});

describe('trace proxy', () => {
  it('forwards, records a redacted store step and captures the debug id', async () => {
    const { proxy, recorder } = await setup();
    const res = await fetch(`${proxy.url}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer SECRET' },
      body: JSON.stringify(order),
    });
    expect(res.status).toBe(201);
    const [step] = recorder.steps();
    expect(step).toMatchObject({ actor: 'store', method: 'POST', responseStatus: 201, seq: 0 });
    expect(step!.requestHeaders.authorization).toBe('***');
    expect(step!.paypalDebugId).toMatch(/^SIM-/);
    expect((step!.responseBody as any).id).toBe('ORD0001');
  });
  it('masks access tokens in oauth responses', async () => {
    const { proxy, recorder } = await setup();
    await fetch(`${proxy.url}/v1/oauth2/token`, { method: 'POST' });
    expect((recorder.steps()[0]!.responseBody as any).access_token).toBe('***');
  });
  it('injects PayPal-Mock-Response exactly once for a matching request', async () => {
    const { proxy, recorder, sim } = await setup();
    await fetch(`${proxy.url}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    });
    await fetch(`${sim.url}/__sim/orders/ORD0001/approve`, { method: 'POST' });
    proxy.mockNext({ method: 'POST', pathRegex: '/capture$', mockCode: 'INSTRUMENT_DECLINED' });
    const first = await fetch(`${proxy.url}/v2/checkout/orders/ORD0001/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const second = await fetch(`${proxy.url}/v2/checkout/orders/ORD0001/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(first.status).toBe(422);
    expect(second.status).toBe(201);
    expect(recorder.steps().filter((s) => s.url.endsWith('/capture'))).toHaveLength(2);
  });
  it('clearMocks removes pending rules', async () => {
    const { proxy, sim } = await setup();
    await fetch(`${proxy.url}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    });
    await fetch(`${sim.url}/__sim/orders/ORD0001/approve`, { method: 'POST' });
    proxy.mockNext({ method: 'POST', pathRegex: '/capture$', mockCode: 'INSTRUMENT_DECLINED' });
    proxy.clearMocks();
    expect(
      (
        await fetch(`${proxy.url}/v2/checkout/orders/ORD0001/capture`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(201);
  });
  it('stop() closes the server', async () => {
    const { proxy } = await setup();
    await proxy.stop();
    await expect(fetch(`${proxy.url}/v1/oauth2/token`, { method: 'POST' })).rejects.toThrow();
  });
});
