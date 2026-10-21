import { INVARIANT_META } from '@payclinic/contracts';
import type {
  InvariantContext,
  InvariantFn,
  InvariantKey,
  InvariantResult,
} from '@payclinic/contracts';
import { toMinor } from '../money';
import { successfulCaptures } from './helpers';

function pass(key: InvariantKey): InvariantResult {
  return {
    key,
    passed: true,
    severity: INVARIANT_META[key].severity,
    message: 'OK',
    evidenceStepIds: [],
  };
}

function fail(key: InvariantKey, message: string, evidenceStepIds: string[] = []): InvariantResult {
  return {
    key,
    passed: false,
    severity: INVARIANT_META[key].severity,
    message,
    evidenceStepIds,
  };
}

export const i01: InvariantFn = ({ trace }: InvariantContext) => {
  const byCart = new Map<string, ReturnType<typeof successfulCaptures>>();
  for (const capture of successfulCaptures(trace)) {
    const captures = byCart.get(capture.cartId);
    if (captures) captures.push(capture);
    else byCart.set(capture.cartId, [capture]);
  }

  for (const [cartId, captures] of byCart) {
    if (captures.length > 1) {
      return fail(
        'I-01',
        `Cart ${cartId} was captured ${captures.length} times`,
        captures.map((capture) => capture.stepId),
      );
    }
  }
  return pass('I-01');
};

export const i02: InvariantFn = ({ trace, state }: InvariantContext) => {
  for (const capture of successfulCaptures(trace)) {
    const cart = state.carts.find((candidate) => candidate.id === capture.cartId);
    if (!cart) continue;

    let captureMinor: bigint;
    let expectedMinor: bigint;
    try {
      captureMinor = toMinor(capture.amount, capture.currency);
      expectedMinor = toMinor(cart.expectedTotal, cart.currency);
    } catch {
      return fail(
        'I-02',
        `Capture ${capture.orderId} has an unparseable amount "${capture.amount}"`,
        [capture.stepId],
      );
    }

    if (captureMinor !== expectedMinor) {
      return fail(
        'I-02',
        `Capture ${capture.orderId} charged ${capture.amount} but cart ${cart.id} costs ${cart.expectedTotal}`,
        [capture.stepId],
      );
    }
  }
  return pass('I-02');
};

export const i04: InvariantFn = ({ trace, state }: InvariantContext) => {
  const captures = successfulCaptures(trace);

  for (const order of state.merchantOrders) {
    if (!order.paypalOrderId) continue;

    const orderCaptures = captures.filter((capture) => capture.orderId === order.paypalOrderId);
    const captureSucceeded = orderCaptures.length > 0;
    const evidence = orderCaptures.map((capture) => capture.stepId);

    if (order.paid && !captureSucceeded) {
      return fail('I-04', `Order ${order.id} paid=true but capture did not succeed`, evidence);
    }
    if (!order.paid && captureSucceeded) {
      return fail('I-04', `Order ${order.id} paid=false but capture succeeded`, evidence);
    }
  }
  return pass('I-04');
};
