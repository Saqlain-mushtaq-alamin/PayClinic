import { INVARIANT_META } from '@payclinic/contracts';
import type {
  InvariantContext,
  InvariantFn,
  InvariantKey,
  InvariantResult,
} from '@payclinic/contracts';

function pass(key: InvariantKey): InvariantResult {
  return {
    key,
    passed: true,
    severity: INVARIANT_META[key].severity,
    message: 'OK',
    evidenceStepIds: [],
  };
}

function fail(key: InvariantKey, message: string): InvariantResult {
  return {
    key,
    passed: false,
    severity: INVARIANT_META[key].severity,
    message,
    evidenceStepIds: [],
  };
}

export const i05: InvariantFn = ({ state }: InvariantContext) => {
  const forged = new Set(state.forgedDeliveryIds);

  for (const delivery of state.webhookDeliveries) {
    if (forged.has(delivery.deliveryId) && delivery.applied > 0) {
      return fail('I-05', `Forged delivery ${delivery.deliveryId} was applied`);
    }
  }

  const appliedByEvent = new Map<string, number>();
  for (const delivery of state.webhookDeliveries) {
    if (forged.has(delivery.deliveryId)) continue;
    appliedByEvent.set(
      delivery.eventId,
      (appliedByEvent.get(delivery.eventId) ?? 0) + delivery.applied,
    );
  }

  for (const [eventId, applied] of appliedByEvent) {
    if (applied > 1) return fail('I-05', `Webhook event ${eventId} applied ${applied} times`);
  }

  return pass('I-05');
};
