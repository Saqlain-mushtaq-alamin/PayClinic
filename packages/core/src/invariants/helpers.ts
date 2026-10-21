import type { Step } from '@payclinic/contracts';

const CAPTURE_PATH = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/;

export interface PayPalOrderRef {
  orderId: string;
  cartId: string | null;
  stepId: string;
}

export interface SuccessfulCapture {
  orderId: string;
  cartId: string;
  amount: string;
  currency: string;
  stepId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Returns the path portion of a recorded request URL. */
export function pathOf(step: Step): string {
  try {
    return new URL(step.url, 'http://placeholder').pathname;
  } catch {
    return step.url;
  }
}

/** Returns whether the recorded response has a 2xx status. */
export function isOk(step: Step): boolean {
  return step.responseStatus >= 200 && step.responseStatus < 300;
}

/** Returns successful PayPal create-order exchanges with their response id and request cart id. */
export function paypalOrders(trace: Step[]): PayPalOrderRef[] {
  return trace.flatMap((step) => {
    if (step.method.toUpperCase() !== 'POST') return [];
    if (pathOf(step) !== '/v2/checkout/orders') return [];
    if (!isOk(step)) return [];

    const response = asRecord(step.responseBody);
    const orderId = response?.id;
    if (typeof orderId !== 'string') return [];

    const request = asRecord(step.requestBody);
    const unit = asRecord(asArray(request?.purchase_units)[0]);
    const cartId = typeof unit?.custom_id === 'string' ? unit.custom_id : null;
    return [{ orderId, cartId, stepId: step.id }];
  });
}

/** Returns successful PayPal capture exchanges with their cart and captured amount. */
export function successfulCaptures(trace: Step[]): SuccessfulCapture[] {
  return trace.flatMap((step) => {
    if (step.method.toUpperCase() !== 'POST') return [];
    if (!isOk(step)) return [];

    const path = pathOf(step);
    const match = CAPTURE_PATH.exec(path);
    if (!match) return [];

    const response = asRecord(step.responseBody);
    if (response?.status !== 'COMPLETED') return [];

    const unit = asRecord(asArray(response.purchase_units)[0]);
    const captures = asArray(asRecord(unit?.payments)?.captures);
    const captured = asRecord(captures[0]);
    if (!captured) return [];

    const amount = asRecord(captured.amount);
    const orderId = typeof response.id === 'string' ? response.id : match[1]!;
    const cartId =
      typeof unit?.custom_id === 'string'
        ? unit.custom_id
        : typeof captured.custom_id === 'string'
          ? captured.custom_id
          : '';
    const value = typeof amount?.value === 'string' ? amount.value : '';
    const currency = typeof amount?.currency_code === 'string' ? amount.currency_code : '';

    return [{ orderId, cartId, amount: value, currency, stepId: step.id }];
  });
}
