# Connect Your Site to PayClinic

This guide explains how to connect your external store or payment integration to **PayClinic** for automated vulnerability scanning, chaos simulation, invariant checks, and AI-assisted patching.

> [!WARNING]
> **TEST MODE ONLY**  
> The endpoints described below bypass actual payment capture and expose test reset capabilities.  
> **Only mount or enable these endpoints in non-production test/sandbox environments!** Never expose them in production.

---

## 1. Overview & Architecture

PayClinic acts as a security scanner and PayPal proxy for your store:

```
[ Your Store in Test Mode ]
      │
      ├── (1) PayClinic scans store endpoints (products, orders, webhooks, state)
      │
      └── (2) Store calls PAYPAL_BASE_URL (<publicUrl>/paypal-proxy/<token>)
                   │
                   ▼
             [ PayClinic PayPal Proxy ]
                   │
                   ├── In offline mode: forwards to local deterministic PayPal simulator
                   └── In online mode: forwards to PayPal Developer Sandbox
```

### Key Benefits
- **Zero Live Secrets in Offline Mode:** In offline mode, your store needs no PayPal credentials because requests are routed through PayClinic's proxy to a deterministic simulator.
- **Trace & Replay:** All store-to-PayPal interactions are recorded as trace steps for automated invariant validation.

---

## 2. Configuration (`PAYPAL_BASE_URL`)

In your test environment, configure your store's PayPal SDK or HTTP client to use the PayClinic proxy URL:

```bash
# Obtain your unique proxy token from the PayClinic Projects dashboard
PAYPAL_BASE_URL=https://your-payclinic-instance.com/paypal-proxy/<YOUR_PROJECT_PROXY_TOKEN>
```

When your store calls `POST $PAYPAL_BASE_URL/v2/checkout/orders` or `$PAYPAL_BASE_URL/v1/oauth2/token`, PayClinic verifies that an active security run exists, records the API steps for invariant checking, and proxies the call to the PayPal engine.

---

## 3. Required Test Catalog SKUs

The PayClinic scanner evaluates scenarios such as double-capture prevention, currency validation, and refund idempotency. In test mode, your `GET /api/products` catalog must include at least these three test SKUs:

| SKU | Name | Price | Currency | Purpose |
|-----|------|-------|----------|---------|
| `tee-001` | Logo Tee | `25.00` | `USD` | Standard order creation and double-capture testing |
| `mug-003` | Logo Mug | `12.00` | `USD` | Multi-item cart & idempotency validation |
| `jp-pen-01` | Gel Pen (JP) | `1200` | `JPY` | Zero-decimal & non-USD currency handling |

---

## 4. The 7 Required Adapter Endpoints

### 1. `GET /api/products`
Returns the product catalog.

- **Request:** `GET /api/products`
- **Response:** `200 OK`
```json
[
  {
    "sku": "tee-001",
    "name": "Logo Tee",
    "description": "Cotton t-shirt",
    "price": "25.00",
    "currency": "USD",
    "merchantId": "merchant-1"
  },
  {
    "sku": "mug-003",
    "name": "Logo Mug",
    "description": "Ceramic coffee mug",
    "price": "12.00",
    "currency": "USD",
    "merchantId": "merchant-1"
  },
  {
    "sku": "jp-pen-01",
    "name": "Gel Pen (JP)",
    "description": "Smooth ink pen",
    "price": "1200",
    "currency": "JPY",
    "merchantId": "merchant-1"
  }
]
```

---

### 2. `POST /api/orders`
Initiates a checkout order with PayPal via `PAYPAL_BASE_URL`.

- **Request:** `POST /api/orders`
```json
{
  "cartId": "cart-1234",
  "items": [
    { "sku": "tee-001", "qty": 1 }
  ],
  "currency": "USD"
}
```
- **Response:** `200 OK` or `201 Created`
```json
{
  "orderId": "5O190127TN364715T",
  "merchantOrderId": "mo-1234",
  "approveUrl": "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T"
}
```

---

### 3. `POST /api/orders/:orderId/capture`
Captures an approved PayPal order.

- **Request:** `POST /api/orders/5O190127TN364715T/capture`
- **Response:** `200 OK`
```json
{
  "merchantOrderId": "mo-1234",
  "status": "paid"
}
```

---

### 4. `POST /api/orders/:orderId/refund`
Issues a full or partial refund for a captured order.

- **Request:** `POST /api/orders/5O190127TN364715T/refund`
```json
{
  "amount": {
    "value": "25.00",
    "currency_code": "USD"
  }
}
```
- **Response:** `200 OK`
```json
{
  "status": "refunded",
  "refundId": "REFUND-99120"
}
```

---

### 5. `POST /webhooks/paypal`
Receives asynchronous PayPal webhook notifications.

- **Request:** `POST /webhooks/paypal`
- **Headers:** `x-payclinic-delivery-id: <deliveryId>`
```json
{
  "id": "WH-12345",
  "event_type": "PAYMENT.CAPTURE.COMPLETED",
  "resource": {
    "id": "CAP-8871",
    "custom_id": "cart-1234"
  }
}
```
- **Response:** `200 OK`
```json
{
  "received": true
}
```

---

### 6. `GET /__admin/state`
Returns the test database state for invariant evaluation.

- **Request:** `GET /__admin/state`
- **Headers:** `x-payclinic-admin: <YOUR_PROJECT_ADMIN_SECRET>`
- **Response:** `200 OK`
```json
{
  "merchantOrders": [
    {
      "id": "mo-1234",
      "cartId": "cart-1234",
      "paypalOrderId": "5O190127TN364715T",
      "status": "paid",
      "paid": true,
      "capturedTotal": "25.00",
      "refundedTotal": "0.00"
    }
  ],
  "webhookDeliveries": [
    {
      "deliveryId": "del-1234",
      "eventId": "WH-12345",
      "eventType": "PAYMENT.CAPTURE.COMPLETED",
      "applied": 1
    }
  ]
}
```

---

### 7. `POST /__admin/reset`
Clears test orders, captures, and webhooks between test scenarios.

- **Request:** `POST /__admin/reset`
- **Headers:** `x-payclinic-admin: <YOUR_PROJECT_ADMIN_SECRET>`
- **Response:** `200 OK`
```json
{
  "ok": true
}
```

---

## 5. Ready-to-Use Code Examples

### Express.js Example (`adapter.express.js`)

```javascript
import express from 'express';

const app = express();
app.use(express.json());

const ADMIN_SECRET = process.env.PAYCLINIC_ADMIN_SECRET || 'test-secret';
const PAYPAL_BASE_URL = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';

let orders = [];
let deliveries = [];

// 1. Catalog
app.get('/api/products', (req, res) => {
  res.json([
    { sku: 'tee-001', name: 'Logo Tee', description: 'Cotton tee', price: '25.00', currency: 'USD', merchantId: 'store' },
    { sku: 'mug-003', name: 'Logo Mug', description: 'Coffee mug', price: '12.00', currency: 'USD', merchantId: 'store' },
    { sku: 'jp-pen-01', name: 'Gel Pen (JP)', description: 'Ink pen', price: '1200', currency: 'JPY', merchantId: 'store' },
  ]);
});

// 2. Orders
app.post('/api/orders', async (req, res) => {
  const { cartId, items, currency = 'USD' } = req.body;
  // Create order via PAYPAL_BASE_URL
  const paypalRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ custom_id: cartId, amount: { currency_code: currency, value: '25.00' } }]
    })
  });
  const data = await paypalRes.json();
  const order = { id: `mo-${data.id}`, cartId, paypalOrderId: data.id, status: 'created', paid: false, capturedTotal: '0.00', refundedTotal: '0.00' };
  orders.push(order);
  res.status(201).json({ orderId: data.id, merchantOrderId: order.id, approveUrl: data.links?.[1]?.href || '' });
});

// 3. Capture
app.post('/api/orders/:orderId/capture', async (req, res) => {
  const order = orders.find(o => o.paypalOrderId === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'order not found' });
  order.status = 'paid';
  order.paid = true;
  order.capturedTotal = '25.00';
  res.json({ merchantOrderId: order.id, status: 'paid' });
});

// 4. Refund
app.post('/api/orders/:orderId/refund', async (req, res) => {
  const order = orders.find(o => o.paypalOrderId === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'order not found' });
  order.refundedTotal = req.body?.amount?.value || '25.00';
  res.json({ status: 'refunded' });
});

// 5. Webhooks
app.post('/webhooks/paypal', (req, res) => {
  deliveries.push({
    deliveryId: req.headers['x-payclinic-delivery-id'] || `del-${Date.now()}`,
    eventId: req.body?.id || 'evt-unknown',
    eventType: req.body?.event_type || 'PAYMENT.CAPTURE.COMPLETED',
    applied: 1
  });
  res.json({ received: true });
});

// Admin Authentication Guard
const checkAdmin = (req, res, next) => {
  if (req.headers['x-payclinic-admin'] !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
};

// 6. Admin State
app.get('/__admin/state', checkAdmin, (req, res) => {
  res.json({ merchantOrders: orders, webhookDeliveries: deliveries });
});

// 7. Admin Reset
app.post('/__admin/reset', checkAdmin, (req, res) => {
  orders = [];
  deliveries = [];
  res.json({ ok: true });
});

app.listen(3000, () => console.log('Store running on port 3000 in test mode'));
```

---

### Fastify Example (`adapter.fastify.js`)

```javascript
import Fastify from 'fastify';

const app = Fastify({ logger: true });
const ADMIN_SECRET = process.env.PAYCLINIC_ADMIN_SECRET || 'test-secret';

let orders = [];
let deliveries = [];

app.get('/api/products', async () => [
  { sku: 'tee-001', name: 'Logo Tee', description: 'Cotton tee', price: '25.00', currency: 'USD', merchantId: 'store' },
  { sku: 'mug-003', name: 'Logo Mug', description: 'Coffee mug', price: '12.00', currency: 'USD', merchantId: 'store' },
  { sku: 'jp-pen-01', name: 'Gel Pen (JP)', description: 'Ink pen', price: '1200', currency: 'JPY', merchantId: 'store' },
]);

app.post('/api/orders', async (req, reply) => {
  const orderId = `SIM-ORD-${Date.now()}`;
  orders.push({ id: `mo-${orderId}`, cartId: req.body.cartId, paypalOrderId: orderId, status: 'created', paid: false, capturedTotal: '0.00', refundedTotal: '0.00' });
  return reply.code(201).send({ orderId, merchantOrderId: `mo-${orderId}` });
});

app.post('/api/orders/:orderId/capture', async (req, reply) => {
  const order = orders.find(o => o.paypalOrderId === req.params.orderId);
  if (!order) return reply.code(404).send({ error: 'order not found' });
  order.status = 'paid';
  order.paid = true;
  order.capturedTotal = '25.00';
  return { merchantOrderId: order.id, status: 'paid' };
});

app.post('/api/orders/:orderId/refund', async (req, reply) => {
  const order = orders.find(o => o.paypalOrderId === req.params.orderId);
  if (!order) return reply.code(404).send({ error: 'order not found' });
  order.refundedTotal = req.body?.amount?.value || '25.00';
  return { status: 'refunded' };
});

app.post('/webhooks/paypal', async (req) => {
  deliveries.push({
    deliveryId: req.headers['x-payclinic-delivery-id'] || `del-${Date.now()}`,
    eventId: req.body?.id || 'evt-unknown',
    eventType: req.body?.event_type || 'PAYMENT.CAPTURE.COMPLETED',
    applied: 1
  });
  return { received: true };
});

app.get('/__admin/state', async (req, reply) => {
  if (req.headers['x-payclinic-admin'] !== ADMIN_SECRET) return reply.code(401).send({ error: 'unauthorized' });
  return { merchantOrders: orders, webhookDeliveries: deliveries };
});

app.post('/__admin/reset', async (req, reply) => {
  if (req.headers['x-payclinic-admin'] !== ADMIN_SECRET) return reply.code(401).send({ error: 'unauthorized' });
  orders = [];
  deliveries = [];
  return { ok: true };
});

app.listen({ port: 3000 });
```
