import type { RecordedHttp } from './context';

export interface BuyerApprover {
  approve(orderId: string, approveUrl: string): Promise<void>;
}

/** Approves through the simulator's test-only endpoint using the recorded runner HTTP client. */
export function createSimApprover(o: { simUrl: string; http: RecordedHttp }): BuyerApprover {
  const simUrl = o.simUrl.replace(/\/+$/, '');
  return {
    async approve(orderId: string): Promise<void> {
      await o.http.request(
        'POST',
        `${simUrl}/__sim/orders/${encodeURIComponent(orderId)}/approve`,
        undefined,
        { label: 'Buyer approves in PayPal', absolute: true },
      );
    },
  };
}

/** Creates an approver that hands the PayPal approval URL to a human and waits. */
export function createManualApprover(o: { ask: (url: string) => Promise<void> }): BuyerApprover {
  return {
    async approve(_orderId: string, approveUrl: string): Promise<void> {
      await o.ask(approveUrl);
    },
  };
}
