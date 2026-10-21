import { beforeEach, describe, expect, it } from 'vitest';
import { createSim, startSim } from '@payclinic/sim';

const order = (value = '25.00', currency = 'USD', custom = 'cart-1') => ({
  intent: 'CAPTURE',
  purchase_units: [
    { reference_id: 'demo-store', custom_id: custom, amount: { currency_code: currency, value } },
  ],
});

let sim: ReturnType<typeof createSim>;
const post = (url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  sim.app.inject({ method: 'POST', url, payload: payload as object, headers });

beforeEach(() => {
  sim = createSim({ publicUrl: 'http://sim.test' });
});

describe('simulator', () => {
  it('issues a token', async () => {
    const r = await post('/v1/oauth2/token');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ access_token: 'SIM-TOKEN', token_type: 'Bearer' });
  });

  it('creates an order with a deterministic id, approve link and debug id', async () => {
    const r = await post('/v2/checkout/orders', order());
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBe('ORD0001');
    expect(body.status).toBe('CREATED');
    expect(body.links[0].href).toBe('http://sim.test/__sim/orders/ORD0001/approve');
    expect(r.headers['paypal-debug-id']).toMatch(/^SIM-/);
    expect((await post('/v2/checkout/orders', order())).json().id).toBe('ORD0002');
    sim.reset();
    expect((await post('/v2/checkout/orders', order())).json().id).toBe('ORD0001');
  });

  it('replays the same response for the same PayPal-Request-Id', async () => {
    const a = await post('/v2/checkout/orders', order(), { 'paypal-request-id': 'req-1' });
    const b = await post('/v2/checkout/orders', order(), { 'paypal-request-id': 'req-1' });
    expect(b.statusCode).toBe(200);
    expect(b.headers['x-sim-idempotent-replay']).toBe('true');
    expect(b.json().id).toBe(a.json().id);
  });

  it.each([
    ['2400.00', 'JPY', 'DECIMAL_PRECISION'],
    ['25.999', 'USD', 'DECIMAL_PRECISION'],
    ['25.00', 'XXX', 'INVALID_VALUE'],
    ['abc', 'USD', 'INVALID_VALUE'],
  ])('rejects amount %s %s with %s', async (value, currency, issue) => {
    const r = await post('/v2/checkout/orders', order(value, currency));
    expect(r.statusCode).toBe(422);
    expect(r.json().details[0].issue).toBe(issue);
  });

  it('cannot capture before approval', async () => {
    await post('/v2/checkout/orders', order());
    const r = await post('/v2/checkout/orders/ORD0001/capture');
    expect(r.statusCode).toBe(422);
    expect(r.json().details[0].issue).toBe('ORDER_NOT_APPROVED');
  });

  it('captures an approved order once; a second capture is ORDER_ALREADY_CAPTURED', async () => {
    await post('/v2/checkout/orders', order());
    expect((await post('/__sim/orders/ORD0001/approve')).statusCode).toBe(200);
    const ok = await post('/v2/checkout/orders/ORD0001/capture');
    expect(ok.statusCode).toBe(201);
    const cap = ok.json().purchase_units[0].payments.captures[0];
    expect(cap).toMatchObject({
      id: 'CAP0001',
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '25.00' },
      custom_id: 'cart-1',
    });
    const again = await post('/v2/checkout/orders/ORD0001/capture');
    expect(again.statusCode).toBe(422);
    expect(again.json().details[0].issue).toBe('ORDER_ALREADY_CAPTURED');
  });

  it('honors PayPal-Mock-Response INSTRUMENT_DECLINED and keeps the order approved', async () => {
    await post('/v2/checkout/orders', order());
    await post('/__sim/orders/ORD0001/approve');
    const declined = await post(
      '/v2/checkout/orders/ORD0001/capture',
      {},
      {
        'paypal-mock-response': JSON.stringify({ mock_application_codes: 'INSTRUMENT_DECLINED' }),
      },
    );
    expect(declined.statusCode).toBe(422);
    expect(declined.json().details[0].issue).toBe('INSTRUMENT_DECLINED');
    expect((await post('/v2/checkout/orders/ORD0001/capture')).statusCode).toBe(201);
  });

  it('refunds partially and rejects over-refunds', async () => {
    await post('/v2/checkout/orders', order());
    await post('/__sim/orders/ORD0001/approve');
    await post('/v2/checkout/orders/ORD0001/capture');
    const part = await post('/v2/payments/captures/CAP0001/refund', {
      amount: { value: '10.00', currency_code: 'USD' },
    });
    expect(part.statusCode).toBe(201);
    expect(part.json()).toMatchObject({ id: 'REF0001', status: 'COMPLETED' });
    const over = await post('/v2/payments/captures/CAP0001/refund', {
      amount: { value: '20.00', currency_code: 'USD' },
    });
    expect(over.statusCode).toBe(422);
    expect(over.json().details[0].issue).toBe('REFUND_AMOUNT_EXCEEDED');
  });

  it('verifies webhook signatures', async () => {
    const good = await post('/v1/notifications/verify-webhook-signature', {
      transmission_sig: 'SIM-VALID-SIGNATURE',
    });
    const bad = await post('/v1/notifications/verify-webhook-signature', {
      transmission_sig: 'FORGED',
    });
    expect(good.json().verification_status).toBe('SUCCESS');
    expect(bad.json().verification_status).toBe('FAILURE');
  });

  it('returns 404 for unknown orders and exposes state', async () => {
    expect(
      (await sim.app.inject({ method: 'GET', url: '/v2/checkout/orders/NOPE' })).statusCode,
    ).toBe(404);
    await post('/v2/checkout/orders', order());
    const state = (await sim.app.inject({ method: 'GET', url: '/__sim/state' })).json();
    expect(state.orders[0]).toMatchObject({
      id: 'ORD0001',
      status: 'CREATED',
      custom_id: 'cart-1',
    });
  });

  it('startSim listens on a free port and serves requests', async () => {
    const s = await startSim();
    try {
      const res = await fetch(`${s.url}/v1/oauth2/token`, { method: 'POST' });
      expect(res.status).toBe(200);
    } finally {
      await s.close();
    }
  });
});
