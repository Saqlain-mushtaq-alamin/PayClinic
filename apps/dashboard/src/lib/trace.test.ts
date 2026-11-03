import { describe, expect, it } from 'vitest';
import type { Step } from '@payclinic/contracts';
import { describeStep, orderSteps } from './trace';

function step(over: Partial<Step>): Step {
  return {
    id: 's',
    runId: 'run-1',
    scenarioId: 'run-1-scn-B1',
    seq: 0,
    actor: 'runner',
    method: 'POST',
    url: 'http://127.0.0.1:50002/api/orders',
    requestHeaders: {},
    requestBody: { cartId: 'cart-1' },
    responseStatus: 201,
    responseHeaders: {},
    responseBody: { orderId: ' ORD0001' },
    durationMs: 5,
    timestamp: '2026-10-18T10:00:00.000Z',
    ...over,
  };
}

describe('describeStep', () => {
  it('uses the label when present and falls back to METHOD path (P2-C02)', () => {
    expect(describeStep(step({ label: 'Customer clicks Pay' })).title).toBe('Customer clicks Pay');
    expect(describeStep(step({})).title).toBe('POST /api/orders');
  });

  it('maps 2xx to ok, 4xx to warn, 5xx and 599 to error tones (P2-C02)', () => {
    expect(describeStep(step({ responseStatus: 201 })).tone).toBe('ok');
    expect(describeStep(step({ responseStatus: 400 })).tone).toBe('warn');
    expect(describeStep(step({ responseStatus: 500 })).tone).toBe('error');
    expect(describeStep(step({ responseStatus: 599 })).tone).toBe('error');
    expect(describeStep(step({ responseStatus: 201 })).chip).toBe('201');
  });

  it('labels runner, store and agent actors (P2-C02)', () => {
    expect(describeStep(step({ actor: 'runner' })).actorLabel).toBe('Runner');
    expect(describeStep(step({ actor: 'store' })).actorLabel).toBe('Store');
    expect(describeStep(step({ actor: 'agent' })).actorLabel).toBe('Agent');
  });
});

describe('orderSteps', () => {
  it('sorts steps by seq (P2-C02)', () => {
    const steps = [step({ id: 'b', seq: 1 }), step({ id: 'a', seq: 0 })];

    expect(orderSteps(steps).map((item) => item.id)).toEqual(['a', 'b']);
  });
});
