import { describe, expect, it } from 'vitest';
import { buildState } from '@payclinic/contracts/testing';
import { INVARIANTS } from '@payclinic/core';

const d = (deliveryId: string, eventId: string, applied: number) => ({
  deliveryId,
  eventId,
  eventType: 'PAYMENT.CAPTURE.COMPLETED',
  applied,
});
const run = (webhookDeliveries: any[], forgedDeliveryIds: string[] = []) =>
  INVARIANTS['I-05']!({ trace: [], state: buildState({ webhookDeliveries, forgedDeliveryIds }) });

describe('I-05', () => {
  it('passes when each event is applied once and the forged delivery is not', () => {
    expect(run([d('d-1', 'E1', 1), d('d-2', 'E1', 0), d('d-f', 'E2', 0)], ['d-f']).passed).toBe(
      true,
    );
  });
  it('fails when a replayed event is applied twice', () => {
    const r = run([d('d-1', 'E1', 1), d('d-2', 'E1', 1)]);
    expect(r).toMatchObject({ passed: false, severity: 'high' });
    expect(r.message).toBe('Webhook event E1 applied 2 times');
  });
  it('fails when a forged delivery is applied', () => {
    const r = run([d('d-f', 'E2', 1)], ['d-f']);
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Forged delivery d-f was applied');
  });
  it('ignores forged deliveries when summing per event', () => {
    expect(run([d('d-1', 'E1', 1), d('d-f', 'E1', 0)], ['d-f']).passed).toBe(true);
  });
  it('passes with no deliveries', () => expect(run([]).passed).toBe(true));
});
