import type { Cart, MerchantOrder, RunState, Step } from './types';

/** Test-data builders. Import from "@payclinic/contracts/testing". Never used in production code. */

let counter = 0;

export function buildStep(partial: Partial<Step> = {}): Step {
  counter += 1;
  const seq = partial.seq ?? counter;
  return {
    id: `step-${counter}`,
    runId: 'run-test',
    scenarioId: 'scn-test',
    seq,
    actor: 'store',
    method: 'GET',
    url: 'http://127.0.0.1:4010/',
    requestHeaders: {},
    requestBody: undefined,
    responseStatus: 200,
    responseHeaders: {},
    responseBody: undefined,
    durationMs: 5,
    timestamp: new Date(Date.UTC(2026, 9, 18, 10, 0, 0, seq * 100)).toISOString(),
    ...partial,
  };
}

export function buildCart(partial: Partial<Cart> = {}): Cart {
  return {
    id: 'cart-1',
    items: [{ sku: 'tee-001', qty: 1 }],
    currency: 'USD',
    expectedTotal: '25.00',
    ...partial,
  };
}

export function buildMerchantOrder(partial: Partial<MerchantOrder> = {}): MerchantOrder {
  return {
    id: 'mo-1',
    cartId: 'cart-1',
    paypalOrderId: 'ORD0001',
    status: 'paid',
    paid: true,
    capturedTotal: '25.00',
    refundedTotal: '0.00',
    ...partial,
  };
}

export function buildState(partial: Partial<RunState> = {}): RunState {
  return {
    carts: [buildCart()],
    merchantOrders: [buildMerchantOrder()],
    webhookDeliveries: [],
    forgedDeliveryIds: [],
    ...partial,
  };
}

/** A PayPal "create order" exchange as the STORE sees it (what the trace proxy records). */
export function paypalCreateStep(o: {
  orderId: string;
  cartId: string;
  amount: string;
  currency?: string;
  seq?: number;
  merchantId?: string;
  status?: number;
  body?: unknown;
}): Step {
  const currency = o.currency ?? 'USD';
  return buildStep({
    seq: o.seq,
    actor: 'store',
    label: 'Store creates PayPal order',
    method: 'POST',
    url: 'http://127.0.0.1:50001/v2/checkout/orders',
    requestHeaders: { authorization: '***', 'content-type': 'application/json' },
    requestBody: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: o.merchantId ?? 'demo-store',
          custom_id: o.cartId,
          amount: { currency_code: currency, value: o.amount },
        },
      ],
    },
    responseStatus: o.status ?? 201,
    responseBody: o.body ?? {
      id: o.orderId,
      status: 'CREATED',
      links: [
        {
          href: `http://127.0.0.1:4010/__sim/orders/${o.orderId}/approve`,
          rel: 'approve',
          method: 'POST',
        },
      ],
    },
    paypalDebugId: `SIM-${o.orderId}-create`,
  });
}

/** A PayPal "capture order" exchange as the STORE sees it. Pass `declined: true` for INSTRUMENT_DECLINED. */
export function paypalCaptureStep(o: {
  orderId: string;
  cartId: string;
  amount: string;
  currency?: string;
  captureId?: string;
  seq?: number;
  declined?: boolean;
}): Step {
  const currency = o.currency ?? 'USD';
  const base = {
    seq: o.seq,
    actor: 'store' as const,
    label: 'Store captures PayPal order',
    method: 'POST',
    url: `http://127.0.0.1:50001/v2/checkout/orders/${o.orderId}/capture`,
    requestHeaders: { authorization: '***', 'content-type': 'application/json' },
    requestBody: {},
    paypalDebugId: `SIM-${o.orderId}-capture`,
  };
  if (o.declined) {
    return buildStep({
      ...base,
      responseStatus: 422,
      responseBody: {
        name: 'UNPROCESSABLE_ENTITY',
        details: [
          { issue: 'INSTRUMENT_DECLINED', description: 'The instrument presented was declined.' },
        ],
        debug_id: `SIM-${o.orderId}-capture`,
      },
    });
  }
  return buildStep({
    ...base,
    responseStatus: 201,
    responseBody: {
      id: o.orderId,
      status: 'COMPLETED',
      purchase_units: [
        {
          reference_id: 'demo-store',
          custom_id: o.cartId,
          payments: {
            captures: [
              {
                id: o.captureId ?? `CAP-${o.orderId}`,
                status: 'COMPLETED',
                amount: { currency_code: currency, value: o.amount },
                custom_id: o.cartId,
                final_capture: true,
              },
            ],
          },
        },
      ],
    },
  });
}
