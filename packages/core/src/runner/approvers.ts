import type { Config } from '../config';
import type { RecordedHttp } from './context';
import {
  PlaywrightApproverError,
  createPlaywrightApprover,
  type LaunchFn,
} from './playwright-approver';

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

export interface ApproverFactoryOptions {
  config: Pick<Config, 'buyerApprover'>;
  http: RecordedHttp;
  simUrl?: string;
  ask?: (url: string) => Promise<void>;
  launch?: LaunchFn;
  buyerEmail?: string;
  buyerPassword?: string;
  failureScreenshotPath?: string;
}

/** Selects the configured buyer approver; the simulator always wins when it is available. */
export function createApprover(o: ApproverFactoryOptions): BuyerApprover {
  if (o.simUrl) return createSimApprover({ simUrl: o.simUrl, http: o.http });

  switch (o.config.buyerApprover) {
    case 'manual':
      if (!o.ask) throw new Error('Manual buyer approval requires an ask callback');
      return createManualApprover({ ask: o.ask });
    case 'playwright':
      if (!o.buyerEmail || !o.buyerPassword) {
        throw new PlaywrightApproverError(
          'Playwright buyer approval requires PAYPAL_BUYER_EMAIL and PAYPAL_BUYER_PASSWORD',
        );
      }
      return createPlaywrightApprover({
        buyerEmail: o.buyerEmail,
        buyerPassword: o.buyerPassword,
        ...(o.launch === undefined ? {} : { launch: o.launch }),
        ...(o.failureScreenshotPath === undefined
          ? {}
          : { failureScreenshotPath: o.failureScreenshotPath }),
      });
    case 'card':
      throw new Error(
        'Card buyer approval is not available; set BUYER_APPROVER=manual or playwright',
      );
    case 'sim':
      throw new Error('Simulator URL is required for sim buyer approval');
  }
}
