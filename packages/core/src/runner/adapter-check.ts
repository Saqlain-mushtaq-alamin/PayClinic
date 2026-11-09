import { AdapterCheckItem, MerchantOrder, Product, WebhookDelivery } from '@payclinic/contracts';
import { z } from 'zod';
import { decrypt } from '../settings/crypto';
import { assertSafeTarget } from './target-guard';

export interface ProjectCheckTarget {
  id: string;
  name: string;
  baseUrl?: string | null;
  adminSecretEncrypted?: string | null;
}

export interface AdapterCheckOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const AdminStateSchema = z.object({
  merchantOrders: z.array(MerchantOrder),
  webhookDeliveries: z.array(WebhookDelivery),
});

const REQUIRED_SKUS = [
  { sku: 'tee-001', price: '25.00', currency: 'USD' },
  { sku: 'mug-003', price: '12.00', currency: 'USD' },
  { sku: 'jp-pen-01', price: '1200', currency: 'JPY' },
];

/**
 * Checks a remote project against the PayClinic test adapter contract.
 * Calls each required endpoint, verifies response shapes, checks required SKUs,
 * and returns actionable fix instructions for any failures.
 */
export async function adapterCheck(
  project: ProjectCheckTarget,
  opts?: AdapterCheckOptions,
): Promise<AdapterCheckItem[]> {
  const fetchFn = opts?.fetchImpl ?? fetch;
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const baseUrl = project.baseUrl?.replace(/\/+$/, '');

  if (!baseUrl) {
    return [
      {
        id: 'base_url',
        endpoint: 'BASE_URL',
        ok: false,
        detail: 'No base URL configured for this project.',
        fix: 'Configure a valid base URL (e.g. https://your-store.com) in project settings.',
      },
    ];
  }

  // Verify target safety with SSRF guard
  try {
    await assertSafeTarget(baseUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        id: 'ssrf_guard',
        endpoint: 'BASE_URL',
        ok: false,
        detail: `Target URL rejected by SSRF guard: ${message}`,
        fix: 'Use a public domain/IP, or set PAYCLINIC_ALLOW_PRIVATE_TARGETS=1 in .env for local testing.',
      },
    ];
  }

  let adminSecret = '';
  if (project.adminSecretEncrypted) {
    try {
      adminSecret = decrypt(project.adminSecretEncrypted);
    } catch {
      adminSecret = '';
    }
  }

  const results: AdapterCheckItem[] = [];

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; headers: Headers; data: unknown }> => {
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    await assertSafeTarget(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      let data: unknown;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, headers: res.headers, data };
    } finally {
      clearTimeout(timer);
    }
  };

  // 1. GET /api/products (and required SKUs)
  try {
    const res = await call('GET', '/api/products');
    if (res.status < 200 || res.status >= 300) {
      results.push({
        id: 'products',
        endpoint: 'GET /api/products',
        ok: false,
        detail: `Expected HTTP 200, got ${res.status}: ${JSON.stringify(res.data)}`,
        fix: 'Implement GET /api/products returning HTTP 200 with an array of catalog products.',
      });
    } else {
      const parsed = Product.array().safeParse(res.data);
      if (!parsed.success) {
        results.push({
          id: 'products',
          endpoint: 'GET /api/products',
          ok: false,
          detail: `Response does not match Product[] contract schema: ${parsed.error.message}`,
          fix: 'Ensure GET /api/products returns products with { sku, name, description, price, currency, merchantId }.',
        });
      } else {
        const products = parsed.data;
        const missing = REQUIRED_SKUS.filter((req) => {
          const match = products.find((p) => p.sku === req.sku);
          if (!match) return true;
          return match.price !== req.price || match.currency !== req.currency;
        });

        if (missing.length > 0) {
          const missingDetails = missing
            .map((m) => `${m.sku} (${m.price} ${m.currency})`)
            .join(', ');
          results.push({
            id: 'products',
            endpoint: 'GET /api/products',
            ok: false,
            detail: `Missing or incorrect required test SKUs: ${missingDetails}`,
            fix: 'Add the 3 required test SKUs in test mode: tee-001 (25.00 USD), mug-003 (12.00 USD), and jp-pen-01 (1200 JPY).',
          });
        } else {
          results.push({
            id: 'products',
            endpoint: 'GET /api/products',
            ok: true,
            detail: `Returns ${products.length} products including all 3 required test SKUs.`,
            fix: null,
          });
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 'products',
      endpoint: 'GET /api/products',
      ok: false,
      detail: `Request failed: ${msg}`,
      fix: 'Implement GET /api/products returning HTTP 200 with catalog products in test mode.',
    });
  }

  // 2. POST /api/orders
  try {
    const res = await call('POST', '/api/orders', {
      cartId: 'payclinic-check-cart',
      items: [{ sku: 'tee-001', qty: 1 }],
      currency: 'USD',
    });
    if (res.status === 200 || res.status === 201) {
      results.push({
        id: 'orders',
        endpoint: 'POST /api/orders',
        ok: true,
        detail: `Order creation responded with HTTP ${res.status}.`,
        fix: null,
      });
    } else {
      results.push({
        id: 'orders',
        endpoint: 'POST /api/orders',
        ok: false,
        detail: `Expected HTTP 200/201, got ${res.status}: ${JSON.stringify(res.data)}`,
        fix: 'Implement POST /api/orders accepting { cartId, items } and creating an order via PAYPAL_BASE_URL.',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 'orders',
      endpoint: 'POST /api/orders',
      ok: false,
      detail: `Request failed: ${msg}`,
      fix: 'Implement POST /api/orders to create PayPal orders in test mode.',
    });
  }

  // 3. POST /api/orders/:orderId/capture
  try {
    const res = await call('POST', '/api/orders/probe-order-1/capture');
    // An endpoint that exists will handle the request and return JSON (e.g. 200, 400, 402, or 404 order not found)
    if (res.status !== 404 && res.status < 500) {
      results.push({
        id: 'capture',
        endpoint: 'POST /api/orders/:orderId/capture',
        ok: true,
        detail: `Capture endpoint handled request with HTTP ${res.status}.`,
        fix: null,
      });
    } else if (res.status === 404 && typeof res.data === 'object' && res.data !== null) {
      // JSON 404 like { error: "order not found" } indicates route exists
      results.push({
        id: 'capture',
        endpoint: 'POST /api/orders/:orderId/capture',
        ok: true,
        detail: `Capture endpoint exists (responded with order not found).`,
        fix: null,
      });
    } else {
      results.push({
        id: 'capture',
        endpoint: 'POST /api/orders/:orderId/capture',
        ok: false,
        detail: `Endpoint not found or threw error (status ${res.status}).`,
        fix: 'Implement POST /api/orders/:orderId/capture to capture payment using PAYPAL_BASE_URL.',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 'capture',
      endpoint: 'POST /api/orders/:orderId/capture',
      ok: false,
      detail: `Request failed: ${msg}`,
      fix: 'Implement POST /api/orders/:orderId/capture to capture payment in test mode.',
    });
  }

  // 4. POST /api/orders/:orderId/refund
  try {
    const res = await call('POST', '/api/orders/probe-order-1/refund', {
      amount: { value: '25.00', currency_code: 'USD' },
    });
    if (
      (res.status < 500 && res.status !== 404) ||
      (res.status === 404 && typeof res.data === 'object' && res.data !== null)
    ) {
      results.push({
        id: 'refund',
        endpoint: 'POST /api/orders/:orderId/refund',
        ok: true,
        detail: `Refund endpoint responded with HTTP ${res.status}.`,
        fix: null,
      });
    } else {
      results.push({
        id: 'refund',
        endpoint: 'POST /api/orders/:orderId/refund',
        ok: false,
        detail: `Endpoint not found or error (status ${res.status}).`,
        fix: 'Implement POST /api/orders/:orderId/refund to issue refunds via PAYPAL_BASE_URL.',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 'refund',
      endpoint: 'POST /api/orders/:orderId/refund',
      ok: false,
      detail: `Request failed: ${msg}`,
      fix: 'Implement POST /api/orders/:orderId/refund in test mode.',
    });
  }

  // 5. POST /webhooks/paypal
  try {
    const res = await call(
      'POST',
      '/webhooks/paypal',
      {
        id: 'WH-CHECK-PROBE',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'CAP-CHECK-1', custom_id: 'payclinic-check-cart' },
      },
      { 'x-payclinic-delivery-id': 'delivery-check-probe' },
    );

    if (res.status >= 200 && res.status < 300) {
      results.push({
        id: 'webhooks',
        endpoint: 'POST /webhooks/paypal',
        ok: true,
        detail: `Webhook received successfully (HTTP ${res.status}).`,
        fix: null,
      });
    } else {
      results.push({
        id: 'webhooks',
        endpoint: 'POST /webhooks/paypal',
        ok: false,
        detail: `Expected HTTP 200, got ${res.status}: ${JSON.stringify(res.data)}`,
        fix: 'Implement POST /webhooks/paypal accepting PayPal webhook events and returning HTTP 200.',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 'webhooks',
      endpoint: 'POST /webhooks/paypal',
      ok: false,
      detail: `Request failed: ${msg}`,
      fix: 'Implement POST /webhooks/paypal to receive PayPal webhook events.',
    });
  }

  // 6. GET /__admin/state
  try {
    const headers: Record<string, string> = {};
    if (adminSecret) headers['x-payclinic-admin'] = adminSecret;
    const res = await call('GET', '/__admin/state', undefined, headers);

    if (res.status === 401 || res.status === 403) {
      results.push({
        id: 'admin_state',
        endpoint: 'GET /__admin/state',
        ok: false,
        detail: `Unauthorized (HTTP ${res.status}): x-payclinic-admin header was missing or incorrect.`,
        fix: 'Ensure GET /__admin/state verifies the x-payclinic-admin header against your configured admin secret.',
      });
    } else if (res.status >= 200 && res.status < 300) {
      const parsed = AdminStateSchema.safeParse(res.data);
      if (!parsed.success) {
        results.push({
          id: 'admin_state',
          endpoint: 'GET /__admin/state',
          ok: false,
          detail: `Response does not match { merchantOrders, webhookDeliveries } schema: ${parsed.error.message}`,
          fix: 'Return { merchantOrders: [...], webhookDeliveries: [...] } from GET /__admin/state.',
        });
      } else {
        results.push({
          id: 'admin_state',
          endpoint: 'GET /__admin/state',
          ok: true,
          detail: `State endpoint returned ${parsed.data.merchantOrders.length} orders and ${parsed.data.webhookDeliveries.length} deliveries.`,
          fix: null,
        });
      }
    } else {
      results.push({
        id: 'admin_state',
        endpoint: 'GET /__admin/state',
        ok: false,
        detail: `Expected HTTP 200, got ${res.status}: ${JSON.stringify(res.data)}`,
        fix: 'Implement GET /__admin/state requiring header x-payclinic-admin and returning { merchantOrders, webhookDeliveries }.',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 'admin_state',
      endpoint: 'GET /__admin/state',
      ok: false,
      detail: `Request failed: ${msg}`,
      fix: 'Implement GET /__admin/state requiring header x-payclinic-admin in test mode.',
    });
  }

  // 7. POST /__admin/reset
  try {
    const headers: Record<string, string> = {};
    if (adminSecret) headers['x-payclinic-admin'] = adminSecret;
    const res = await call('POST', '/__admin/reset', undefined, headers);

    if (res.status === 401 || res.status === 403) {
      results.push({
        id: 'admin_reset',
        endpoint: 'POST /__admin/reset',
        ok: false,
        detail: `Unauthorized (HTTP ${res.status}): x-payclinic-admin header was missing or incorrect.`,
        fix: 'Ensure POST /__admin/reset verifies the x-payclinic-admin header against your configured admin secret.',
      });
    } else if (res.status >= 200 && res.status < 300) {
      results.push({
        id: 'admin_reset',
        endpoint: 'POST /__admin/reset',
        ok: true,
        detail: `Reset endpoint answered with HTTP ${res.status}.`,
        fix: null,
      });
    } else {
      results.push({
        id: 'admin_reset',
        endpoint: 'POST /__admin/reset',
        ok: false,
        detail: `Expected HTTP 200, got ${res.status}: ${JSON.stringify(res.data)}`,
        fix: 'Implement POST /__admin/reset requiring header x-payclinic-admin to reset test orders and state.',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 'admin_reset',
      endpoint: 'POST /__admin/reset',
      ok: false,
      detail: `Request failed: ${msg}`,
      fix: 'Implement POST /__admin/reset requiring header x-payclinic-admin to clear test database state.',
    });
  }

  return results;
}
