import type { StoreDb } from './db';
import type { PayPalClient } from './paypal';

export interface WebhookDeps {
  db: StoreDb;
  paypal: PayPalClient;
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource?: { id?: string; custom_id?: string | null };
  [key: string]: unknown;
}

export function handleWebhook(
  deps: WebhookDeps,
  deliveryId: string,
  headers: Record<string, string | string[] | undefined>,
  event: WebhookEvent,
) {
  // BUG B3: no signature verification and no deduplication; every delivery credits the ledger
  deps.db.insertLedgerEntry({ eventId: event.id, orderRef: event.resource?.custom_id ?? null });
  deps.db.recordDelivery({
    deliveryId,
    eventId: event.id,
    eventType: event.event_type,
    applied: 1,
  });
  return { status: 200, body: { received: true } };
}
