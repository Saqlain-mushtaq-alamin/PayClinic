/**
 * Regenerates packages/contracts/src/samples/traces/*.json.
 * Run:  npx tsx scripts/gen-golden.ts
 * These traces are HAND-DESIGNED to match docs/TECH_DESIGN.md. They are the test oracle for the invariants.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  buildStep,
  buildCart,
  buildMerchantOrder,
  buildState,
  paypalCaptureStep,
  paypalCreateStep,
} from '../packages/contracts/src/testing';
import { GoldenTrace } from '../packages/contracts/src/types';
import type { Step } from '../packages/contracts/src/types';

const STORE = 'http://127.0.0.1:50002';
const SIM = 'http://127.0.0.1:4010';

function runnerCreate(cartId: string, orderId: string, extra: Record<string, unknown> = {}): Step {
  return buildStep({
    actor: 'runner',
    label: 'Customer clicks Pay',
    method: 'POST',
    url: `${STORE}/api/orders`,
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: { cartId, items: [{ sku: 'tee-001', qty: 1 }], ...extra },
    responseStatus: 201,
    responseBody: { merchantOrderId: `mo-${orderId}`, orderId },
  });
}
function runnerApprove(orderId: string): Step {
  return buildStep({
    actor: 'runner',
    label: 'Buyer approves in PayPal',
    method: 'POST',
    url: `${SIM}/__sim/orders/${orderId}/approve`,
    requestHeaders: {},
    responseStatus: 200,
    responseBody: { id: orderId, status: 'APPROVED' },
  });
}
function runnerCapture(orderId: string, status = 200, body: unknown = { status: 'paid' }): Step {
  return buildStep({
    actor: 'runner',
    label: 'Customer returns; store captures',
    method: 'POST',
    url: `${STORE}/api/orders/${orderId}/capture`,
    requestHeaders: { 'content-type': 'application/json' },
    requestBody: {},
    responseStatus: status,
    responseBody: body,
  });
}

function finalize(steps: Step[], runId: string): Step[] {
  // seq = order of START. We list steps in start order already.
  return steps.map((s, i) => ({
    ...s,
    id: `${runId}-s${i}`,
    runId,
    scenarioId: `${runId}-scn`,
    seq: i,
    timestamp: new Date(Date.UTC(2026, 9, 18, 10, 0, 0, i * 100)).toISOString(),
  }));
}

const traces = [];

// 1 ── healthy single checkout
traces.push(
  GoldenTrace.parse({
    name: 'healthy-flow',
    scenarioKey: 'B1',
    description: 'One checkout, one order, one capture. Every invariant passes.',
    steps: finalize(
      [
        runnerCreate('cart-1', 'ORD0001'),
        paypalCreateStep({ orderId: 'ORD0001', cartId: 'cart-1', amount: '25.00' }),
        runnerApprove('ORD0001'),
        runnerCapture('ORD0001'),
        paypalCaptureStep({ orderId: 'ORD0001', cartId: 'cart-1', amount: '25.00' }),
      ],
      'g-healthy',
    ),
    state: buildState({
      carts: [buildCart({ id: 'cart-1', expectedTotal: '25.00' })],
      merchantOrders: [
        buildMerchantOrder({ id: 'mo-ORD0001', cartId: 'cart-1', paypalOrderId: 'ORD0001' }),
      ],
    }),
    expectedFailingInvariants: [],
  }),
);

// 2 ── B1: double click -> two PayPal orders for ONE cart, both captured
traces.push(
  GoldenTrace.parse({
    name: 'b1-duplicate-order',
    scenarioKey: 'B1',
    description:
      'Two concurrent checkouts for cart-1 create two PayPal orders; both are captured (customer charged twice).',
    steps: finalize(
      [
        runnerCreate('cart-1', 'ORD0001'),
        runnerCreate('cart-1', 'ORD0002'),
        paypalCreateStep({ orderId: 'ORD0001', cartId: 'cart-1', amount: '25.00' }),
        paypalCreateStep({ orderId: 'ORD0002', cartId: 'cart-1', amount: '25.00' }),
        runnerApprove('ORD0001'),
        runnerApprove('ORD0002'),
        runnerCapture('ORD0001'),
        paypalCaptureStep({ orderId: 'ORD0001', cartId: 'cart-1', amount: '25.00' }),
        runnerCapture('ORD0002'),
        paypalCaptureStep({ orderId: 'ORD0002', cartId: 'cart-1', amount: '25.00' }),
      ],
      'g-b1',
    ),
    state: buildState({
      carts: [buildCart({ id: 'cart-1', expectedTotal: '25.00' })],
      merchantOrders: [
        buildMerchantOrder({ id: 'mo-ORD0001', cartId: 'cart-1', paypalOrderId: 'ORD0001' }),
        buildMerchantOrder({ id: 'mo-ORD0002', cartId: 'cart-1', paypalOrderId: 'ORD0002' }),
      ],
    }),
    expectedFailingInvariants: ['I-01'],
  }),
);

// 3 ── B2: browser-supplied clientTotal is trusted
traces.push(
  GoldenTrace.parse({
    name: 'b2-tampered-amount',
    scenarioKey: 'B2',
    description:
      'Client sends clientTotal "1.00" for a 25.00 cart; the store creates and captures a 1.00 order.',
    steps: finalize(
      [
        runnerCreate('cart-2', 'ORD0001', { clientTotal: '1.00' }),
        paypalCreateStep({ orderId: 'ORD0001', cartId: 'cart-2', amount: '1.00' }),
        runnerApprove('ORD0001'),
        runnerCapture('ORD0001'),
        paypalCaptureStep({ orderId: 'ORD0001', cartId: 'cart-2', amount: '1.00' }),
      ],
      'g-b2',
    ),
    state: buildState({
      carts: [buildCart({ id: 'cart-2', expectedTotal: '25.00' })],
      merchantOrders: [
        buildMerchantOrder({
          id: 'mo-ORD0001',
          cartId: 'cart-2',
          paypalOrderId: 'ORD0001',
          capturedTotal: '1.00',
        }),
      ],
    }),
    expectedFailingInvariants: ['I-02'],
  }),
);

// 4 ── B4: capture declined, order still marked paid
traces.push(
  GoldenTrace.parse({
    name: 'b4-paid-on-decline',
    scenarioKey: 'B4',
    description:
      'Capture is declined by PayPal (INSTRUMENT_DECLINED) but the store has already marked the order paid.',
    steps: finalize(
      [
        runnerCreate('cart-4', 'ORD0001'),
        paypalCreateStep({ orderId: 'ORD0001', cartId: 'cart-4', amount: '25.00' }),
        runnerApprove('ORD0001'),
        runnerCapture('ORD0001', 402, { status: 'failed' }),
        paypalCaptureStep({
          orderId: 'ORD0001',
          cartId: 'cart-4',
          amount: '25.00',
          declined: true,
        }),
      ],
      'g-b4',
    ),
    state: buildState({
      carts: [buildCart({ id: 'cart-4', expectedTotal: '25.00' })],
      merchantOrders: [
        buildMerchantOrder({
          id: 'mo-ORD0001',
          cartId: 'cart-4',
          paypalOrderId: 'ORD0001',
          status: 'paid',
          paid: true,
          capturedTotal: '0.00',
        }),
      ],
    }),
    expectedFailingInvariants: ['I-04'],
  }),
);

mkdirSync('packages/contracts/src/samples/traces', { recursive: true });
for (const t of traces) {
  writeFileSync(
    `packages/contracts/src/samples/traces/${t.name}.json`,
    JSON.stringify(t, null, 2) + '\n',
  );
  console.log('wrote', t.name, t.steps.length, 'steps');
}
