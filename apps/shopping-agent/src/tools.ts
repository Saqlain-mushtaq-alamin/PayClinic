import { Product, type AgentPurchase } from '@payclinic/contracts';
import { fromMinor, toMinor } from '@payclinic/core';

/** The three payment tools an agent may call. `@payclinic/firewall` wraps this interface. */
export interface PayTools {
  searchProducts(query?: string): Promise<Product[]>;
  createOrder(a: {
    merchantId: string;
    sku: string;
    qty: number;
  }): Promise<{ orderId: string; amount: string; currency: string } | { error: string }>;
  captureOrder(orderId: string): Promise<{ status: 'COMPLETED' | 'FAILED'; error?: string }>;
}

export interface StoreRequestResult {
  status: number;
  body: unknown;
}

export interface StorePayToolsOptions {
  request: (
    method: string,
    path: string,
    body?: unknown,
    opts?: { label?: string },
  ) => Promise<StoreRequestResult>;
  approve: (orderId: string) => Promise<void>;
  now: () => number;
  onPurchase?: (purchase: AgentPurchase) => void;
}

interface PendingOrder {
  merchantId: string;
  sku: string;
  qty: number;
  amount: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function errorMessage(body: unknown, fallback: string): string {
  const error = asRecord(body).error;
  return typeof error === 'string' ? error : fallback;
}

/** Builds PayTools backed by the store's HTTP API. Money is computed in minor units. */
export function createStorePayTools(options: StorePayToolsOptions): PayTools {
  const pending = new Map<string, PendingOrder>();
  let counter = 0;

  async function loadProducts(): Promise<Product[]> {
    const response = await options.request('GET', '/api/products', undefined, {
      label: 'Agent lists products',
    });
    if (response.status !== 200) {
      throw new Error(`product list request failed with status ${response.status}`);
    }
    return Product.array().parse(response.body);
  }

  return {
    async searchProducts(query?: string) {
      const products = await loadProducts();
      if (!query) return products;
      const needle = query.toLowerCase();
      return products.filter((product) =>
        [product.sku, product.name, product.description].some((value) =>
          value.toLowerCase().includes(needle),
        ),
      );
    },

    async createOrder(args) {
      const products = await loadProducts();
      const product = products.find((entry) => entry.sku === args.sku);
      if (!product) return { error: `unknown product ${args.sku}` };

      const amount = fromMinor(
        toMinor(product.price, product.currency) * BigInt(args.qty),
        product.currency,
      );

      counter += 1;
      const cartId = `agent-${counter}`;
      const response = await options.request(
        'POST',
        '/api/orders',
        { cartId, items: [{ sku: args.sku, qty: args.qty }] },
        { label: 'Agent creates order' },
      );

      const body = asRecord(response.body);
      const orderId = body.orderId;
      if ((response.status !== 200 && response.status !== 201) || typeof orderId !== 'string') {
        return {
          error: errorMessage(response.body, `order create failed with status ${response.status}`),
        };
      }

      pending.set(orderId, {
        merchantId: args.merchantId,
        sku: args.sku,
        qty: args.qty,
        amount,
      });
      return { orderId, amount, currency: product.currency };
    },

    async captureOrder(orderId) {
      await options.approve(orderId);
      const response = await options.request(
        'POST',
        `/api/orders/${encodeURIComponent(orderId)}/capture`,
        {},
        { label: 'Agent captures order' },
      );

      const body = asRecord(response.body);
      const paid = response.status === 200 && body.status === 'paid';
      if (!paid) {
        return {
          status: 'FAILED',
          error: errorMessage(response.body, `capture failed with status ${response.status}`),
        };
      }

      const order = pending.get(orderId);
      if (!order) return { status: 'FAILED', error: `unknown order ${orderId}` };

      options.onPurchase?.({
        orderId,
        merchantId: order.merchantId,
        sku: order.sku,
        qty: order.qty,
        amount: order.amount,
        atMs: options.now(),
      });
      return { status: 'COMPLETED' };
    },
  };
}
