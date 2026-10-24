import { INVARIANT_META } from '@payclinic/contracts';
import type {
  InvariantContext,
  InvariantFn,
  InvariantKey,
  InvariantResult,
  Step,
} from '@payclinic/contracts';
import { isValidAmountString, toMinor } from '../money';
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

interface AmountField {
  value: unknown;
  currency: unknown;
}

function amountsIn(step: Step): AmountField[] {
  const body = asRecord(step.requestBody);
  if (!body) return [];

  const amounts: AmountField[] = [];
  const topLevel = asRecord(body.amount);
  if (topLevel) amounts.push({ value: topLevel.value, currency: topLevel.currency_code });

  for (const unit of asArray(body.purchase_units)) {
    const amount = asRecord(asRecord(unit)?.amount);
    if (amount) amounts.push({ value: amount.value, currency: amount.currency_code });
  }
  return amounts;
}

function isValidAmount(amount: AmountField): boolean {
  if (typeof amount.currency !== 'string' || !/^[A-Z]{3}$/.test(amount.currency)) return false;
  if (typeof amount.value !== 'string') return false;
  try {
    return isValidAmountString(amount.value, amount.currency);
  } catch {
    return false;
  }
}

export const i06: InvariantFn = ({ trace }: InvariantContext) => {
  const evidence: string[] = [];
  let firstMessage: string | null = null;

  for (const step of trace) {
    if (step.actor !== 'store') continue;
    for (const amount of amountsIn(step)) {
      if (isValidAmount(amount)) continue;
      if (firstMessage === null) {
        firstMessage = `Amount "${String(amount.value)}" is invalid for ${String(amount.currency)}`;
      }
      if (!evidence.includes(step.id)) evidence.push(step.id);
    }
  }

  if (firstMessage !== null) return fail('I-06', firstMessage, evidence);
  return pass('I-06');
};

export const i03: InvariantFn = ({ trace, state }: InvariantContext) => {
  const captures = successfulCaptures(trace);

  for (const order of state.merchantOrders) {
    const capture = captures.find((candidate) => candidate.orderId === order.paypalOrderId);
    const cart = state.carts.find((candidate) => candidate.id === order.cartId);
    const currency = capture?.currency ?? cart?.currency;
    if (!currency) return fail('I-03', `Order ${order.id} has unparseable money`);

    let captured: bigint;
    let refunded: bigint;
    try {
      captured = toMinor(order.capturedTotal, currency);
      refunded = toMinor(order.refundedTotal, currency);
    } catch {
      return fail('I-03', `Order ${order.id} has unparseable money`);
    }

    if (refunded > captured) {
      return fail(
        'I-03',
        `Order ${order.id} refunded ${order.refundedTotal} of ${order.capturedTotal}`,
      );
    }
  }
  return pass('I-03');
};
