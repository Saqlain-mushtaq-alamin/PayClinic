import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adapterCheck, encrypt } from '@payclinic/core';

describe('Adapter Check (adapterCheck)', () => {
  let server: Server;
  let serverUrl: string;
  const adminSecret = 'my-secret-key-12345';
  let serverBehavior: {
    products?: unknown;
    productsStatus?: number;
    ordersStatus?: number;
    ordersBody?: unknown;
    captureStatus?: number;
    refundStatus?: number;
    webhookStatus?: number;
    adminStateStatus?: number;
    adminStateBody?: unknown;
    adminResetStatus?: number;
    requireAdminAuth?: boolean;
  } = {};

  const validProducts = [
    {
      sku: 'tee-001',
      name: 'Logo Tee',
      description: 'Soft cotton',
      price: '25.00',
      currency: 'USD',
      merchantId: 'store-1',
    },
    {
      sku: 'mug-003',
      name: 'Logo Mug',
      description: 'Ceramic mug',
      price: '12.00',
      currency: 'USD',
      merchantId: 'store-1',
    },
    {
      sku: 'jp-pen-01',
      name: 'Gel Pen (JP)',
      description: 'Smooth pen',
      price: '1200',
      currency: 'JPY',
      merchantId: 'store-1',
    },
  ];

  const validAdminState = {
    merchantOrders: [
      {
        id: 'mo-1',
        cartId: 'cart-1',
        paypalOrderId: 'order-1',
        status: 'paid',
        paid: true,
        capturedTotal: '25.00',
        refundedTotal: '0.00',
      },
    ],
    webhookDeliveries: [
      {
        deliveryId: 'del-1',
        eventId: 'evt-1',
        eventType: 'PAYMENT.CAPTURE.COMPLETED',
        applied: 1,
      },
    ],
  };

  beforeEach(async () => {
    process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS = '1';
    serverBehavior = {
      products: validProducts,
      productsStatus: 200,
      ordersStatus: 201,
      ordersBody: { orderId: 'order-123', approveUrl: 'https://paypal.com/approve' },
      captureStatus: 200,
      refundStatus: 200,
      webhookStatus: 200,
      adminStateStatus: 200,
      adminStateBody: validAdminState,
      adminResetStatus: 200,
      requireAdminAuth: true,
    };

    server = createServer((req, res) => {
      const url = req.url ?? '/';
      const auth = req.headers['x-payclinic-admin'];

      if (url === '/api/products' && req.method === 'GET') {
        res.writeHead(serverBehavior.productsStatus ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(serverBehavior.products));
        return;
      }

      if (url === '/api/orders' && req.method === 'POST') {
        res.writeHead(serverBehavior.ordersStatus ?? 201, { 'content-type': 'application/json' });
        res.end(JSON.stringify(serverBehavior.ordersBody ?? { orderId: 'ord-1' }));
        return;
      }

      if (url.startsWith('/api/orders/') && url.endsWith('/capture') && req.method === 'POST') {
        res.writeHead(serverBehavior.captureStatus ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'paid' }));
        return;
      }

      if (url.startsWith('/api/orders/') && url.endsWith('/refund') && req.method === 'POST') {
        res.writeHead(serverBehavior.refundStatus ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'refunded' }));
        return;
      }

      if (url === '/webhooks/paypal' && req.method === 'POST') {
        res.writeHead(serverBehavior.webhookStatus ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
        return;
      }

      if (url === '/__admin/state' && req.method === 'GET') {
        if (serverBehavior.requireAdminAuth && auth !== adminSecret) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        res.writeHead(serverBehavior.adminStateStatus ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(serverBehavior.adminStateBody));
        return;
      }

      if (url === '/__admin/reset' && req.method === 'POST') {
        if (serverBehavior.requireAdminAuth && auth !== adminSecret) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        res.writeHead(serverBehavior.adminResetStatus ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    delete process.env.PAYCLINIC_ALLOW_PRIVATE_TARGETS;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('all checks pass against a fully conforming store', async () => {
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt(adminSecret),
    };

    const results = await adapterCheck(project);
    expect(results).toHaveLength(7);
    for (const item of results) {
      expect(item.ok).toBe(true);
      expect(item.fix).toBeNull();
    }
  });

  it('produces fix instructions when required SKUs are missing', async () => {
    serverBehavior.products = [validProducts[0]]; // only tee-001, missing mug and pen
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt(adminSecret),
    };

    const results = await adapterCheck(project);
    const prodCheck = results.find((r) => r.id === 'products')!;
    expect(prodCheck.ok).toBe(false);
    expect(prodCheck.detail).toContain('Missing or incorrect required test SKUs');
    expect(prodCheck.fix).toBe(
      'Add the 3 required test SKUs in test mode: tee-001 (25.00 USD), mug-003 (12.00 USD), and jp-pen-01 (1200 JPY).',
    );
  });

  it('produces fix instructions when catalog schema is malformed', async () => {
    serverBehavior.products = [{ invalid: 'item' }];
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt(adminSecret),
    };

    const results = await adapterCheck(project);
    const prodCheck = results.find((r) => r.id === 'products')!;
    expect(prodCheck.ok).toBe(false);
    expect(prodCheck.fix).toBe(
      'Ensure GET /api/products returns products with { sku, name, description, price, currency, merchantId }.',
    );
  });

  it('produces fix instructions when POST /api/orders fails', async () => {
    serverBehavior.ordersStatus = 500;
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt(adminSecret),
    };

    const results = await adapterCheck(project);
    const orderCheck = results.find((r) => r.id === 'orders')!;
    expect(orderCheck.ok).toBe(false);
    expect(orderCheck.fix).toBe(
      'Implement POST /api/orders accepting { cartId, items } and creating an order via PAYPAL_BASE_URL.',
    );
  });

  it('produces fix instructions when POST /api/orders/:orderId/capture fails', async () => {
    serverBehavior.captureStatus = 500;
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt(adminSecret),
    };

    const results = await adapterCheck(project);
    const captureCheck = results.find((r) => r.id === 'capture')!;
    expect(captureCheck.ok).toBe(false);
    expect(captureCheck.fix).toBe(
      'Implement POST /api/orders/:orderId/capture to capture payment using PAYPAL_BASE_URL.',
    );
  });

  it('produces fix instructions when POST /api/orders/:orderId/refund fails', async () => {
    serverBehavior.refundStatus = 500;
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt(adminSecret),
    };

    const results = await adapterCheck(project);
    const refundCheck = results.find((r) => r.id === 'refund')!;
    expect(refundCheck.ok).toBe(false);
    expect(refundCheck.fix).toBe(
      'Implement POST /api/orders/:orderId/refund to issue refunds via PAYPAL_BASE_URL.',
    );
  });

  it('produces fix instructions when POST /webhooks/paypal fails', async () => {
    serverBehavior.webhookStatus = 500;
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt(adminSecret),
    };

    const results = await adapterCheck(project);
    const webhookCheck = results.find((r) => r.id === 'webhooks')!;
    expect(webhookCheck.ok).toBe(false);
    expect(webhookCheck.fix).toBe(
      'Implement POST /webhooks/paypal accepting PayPal webhook events and returning HTTP 200.',
    );
  });

  it('produces fix instructions when GET /__admin/state fails authentication', async () => {
    // Send a project with wrong admin secret
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt('wrong-secret'),
    };

    const results = await adapterCheck(project);
    const stateCheck = results.find((r) => r.id === 'admin_state')!;
    expect(stateCheck.ok).toBe(false);
    expect(stateCheck.fix).toBe(
      'Ensure GET /__admin/state verifies the x-payclinic-admin header against your configured admin secret.',
    );
  });

  it('produces fix instructions when POST /__admin/reset fails authentication', async () => {
    const project = {
      id: 'proj-1',
      name: 'Test Store',
      baseUrl: serverUrl,
      adminSecretEncrypted: encrypt('wrong-secret'),
    };

    const results = await adapterCheck(project);
    const resetCheck = results.find((r) => r.id === 'admin_reset')!;
    expect(resetCheck.ok).toBe(false);
    expect(resetCheck.fix).toBe(
      'Ensure POST /__admin/reset verifies the x-payclinic-admin header against your configured admin secret.',
    );
  });
});
