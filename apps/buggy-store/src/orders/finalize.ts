import type { StoreDb } from '../db';
import type { PayPalResult } from '../paypal';

export function finalizeCapture(db: StoreDb, merchantOrderId: string, res: PayPalResult) {
  db.markPaid(merchantOrderId); // BUG B4: marks paid before the capture result is inspected
  const capture = res.body?.purchase_units?.[0]?.payments?.captures?.[0];
  if (!res.ok || res.body?.status !== 'COMPLETED' || !capture) {
    return { ok: false as const };
  }
  db.recordCapture(merchantOrderId, capture.amount.value);
  return { ok: true as const };
}
