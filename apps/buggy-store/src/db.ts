import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

export type MerchantOrderStatus = 'created' | 'paid' | 'failed';

export interface MerchantOrderRecord {
  id: string;
  cartId: string;
  paypalOrderId: string | null;
  status: MerchantOrderStatus;
  paid: boolean;
  capturedTotal: string;
  refundedTotal: string;
}

export interface NewMerchantOrder {
  id: string;
  cartId: string;
  paypalOrderId: string;
  status: MerchantOrderStatus;
  paid: boolean;
  capturedTotal: string;
  refundedTotal: string;
}

export interface WebhookDeliveryRecord {
  deliveryId: string;
  eventId: string;
  eventType: string;
  applied: number;
}

export interface LedgerEntry {
  eventId: string;
  orderRef?: string | null;
}

export interface StoreState {
  merchantOrders: MerchantOrderRecord[];
  webhookDeliveries: WebhookDeliveryRecord[];
}

interface MerchantRow {
  id: string;
  cart_id: string;
  paypal_order_id: string | null;
  status: string;
  paid: number;
  captured_total: string;
  refunded_total: string;
  capture_id: string | null;
}

interface DeliveryRow {
  delivery_id: string;
  event_id: string;
  event_type: string;
  applied: number;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS merchant_orders (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL,
  paypal_order_id TEXT UNIQUE,
  status TEXT NOT NULL,
  paid INTEGER NOT NULL,
  captured_total TEXT NOT NULL,
  refunded_total TEXT NOT NULL,
  capture_id TEXT
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  applied INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  order_ref TEXT,
  created_at TEXT NOT NULL
);
`;

function toMerchantOrder(row: MerchantRow): MerchantOrderRecord {
  return {
    id: row.id,
    cartId: row.cart_id,
    paypalOrderId: row.paypal_order_id,
    status: row.status as MerchantOrderStatus,
    paid: row.paid === 1,
    capturedTotal: row.captured_total,
    refundedTotal: row.refunded_total,
  };
}

function toDelivery(row: DeliveryRow): WebhookDeliveryRecord {
  return {
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    eventType: row.event_type,
    applied: row.applied,
  };
}

/** SQLite persistence for the buggy store. */
export class StoreDb {
  private readonly db: BetterSqlite3.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new BetterSqlite3(path);
    this.db.exec(SCHEMA_SQL);
    const columns = this.db.prepare('PRAGMA table_info(merchant_orders)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'capture_id')) {
      this.db.exec('ALTER TABLE merchant_orders ADD COLUMN capture_id TEXT');
    }
  }

  upsertMerchantOrderByPaypalId(order: NewMerchantOrder): MerchantOrderRecord {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO merchant_orders
          (id, cart_id, paypal_order_id, status, paid, captured_total, refunded_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        order.id,
        order.cartId,
        order.paypalOrderId,
        order.status,
        order.paid ? 1 : 0,
        order.capturedTotal,
        order.refundedTotal,
      );

    const stored = this.getByPaypalOrderId(order.paypalOrderId);
    if (!stored) throw new Error(`Merchant order for PayPal order ${order.paypalOrderId} missing`);
    return stored;
  }

  markPaid(id: string): void {
    this.db.prepare("UPDATE merchant_orders SET status = 'paid', paid = 1 WHERE id = ?").run(id);
  }

  markFailedIfUnpaid(id: string): void {
    this.db
      .prepare("UPDATE merchant_orders SET status = 'failed' WHERE id = ? AND paid = 0")
      .run(id);
  }

  recordCapture(id: string, amount: string, captureId: string): void {
    this.db
      .prepare('UPDATE merchant_orders SET captured_total = ?, capture_id = ? WHERE id = ?')
      .run(amount, captureId, id);
  }

  recordRefund(id: string, refundedTotal: string): void {
    this.db
      .prepare('UPDATE merchant_orders SET refunded_total = ? WHERE id = ?')
      .run(refundedTotal, id);
  }

  getByPaypalOrderId(id: string): MerchantOrderRecord | null {
    const row = this.db
      .prepare('SELECT * FROM merchant_orders WHERE paypal_order_id = ?')
      .get(id) as MerchantRow | undefined;
    return row ? toMerchantOrder(row) : null;
  }

  getCaptureId(id: string): string | null {
    const row = this.db
      .prepare('SELECT capture_id FROM merchant_orders WHERE paypal_order_id = ?')
      .get(id) as { capture_id: string | null } | undefined;
    return row?.capture_id ?? null;
  }

  hasLedgerEvent(eventId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM ledger WHERE event_id = ?').get(eventId);
    return row !== undefined;
  }

  insertLedgerEntry(entry: LedgerEntry): void {
    this.db
      .prepare('INSERT INTO ledger (event_id, order_ref, created_at) VALUES (?, ?, ?)')
      .run(entry.eventId, entry.orderRef ?? null, new Date().toISOString());
  }

  recordDelivery(delivery: WebhookDeliveryRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO webhook_deliveries
          (delivery_id, event_id, event_type, applied)
         VALUES (?, ?, ?, ?)`,
      )
      .run(delivery.deliveryId, delivery.eventId, delivery.eventType, delivery.applied);
  }

  state(): StoreState {
    const merchantRows = this.db
      .prepare('SELECT * FROM merchant_orders ORDER BY id')
      .all() as MerchantRow[];
    const deliveryRows = this.db
      .prepare('SELECT * FROM webhook_deliveries ORDER BY delivery_id')
      .all() as DeliveryRow[];
    return {
      merchantOrders: merchantRows.map(toMerchantOrder),
      webhookDeliveries: deliveryRows.map(toDelivery),
    };
  }

  reset(): void {
    this.db.exec(
      'DELETE FROM ledger; DELETE FROM webhook_deliveries; DELETE FROM merchant_orders;',
    );
  }

  close(): void {
    this.db.close();
  }
}
