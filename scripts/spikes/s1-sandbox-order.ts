/**
 * Spike S1 / S5: prove you can talk to the PayPal SANDBOX from this machine.
 *
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npx tsx scripts/spikes/s1-sandbox-order.ts
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... npx tsx scripts/spikes/s1-sandbox-order.ts --capture <ORDER_ID>
 *   ... --capture <ORDER_ID> --mock INSTRUMENT_DECLINED      (spike S5: negative-testing header)
 *
 * Step 1 (no flags): creates a 25.00 USD order, prints the buyer approval link.
 * Step 2: open the link, log in with your SANDBOX personal (buyer) account and approve.
 * Step 3: run with --capture <ORDER_ID> and read the result.
 * Write what happened into docs/spikes/S1.md (and S5.md).
 */
const BASE = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';
if (BASE !== 'https://api-m.sandbox.paypal.com') {
  throw new Error(`Refusing to run against ${BASE}: sandbox only`);
}
const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
if (!id || !secret) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app)');

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function token(): Promise<string> {
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`token failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function main() {
  const t = await token();
  const captureId = flag('--capture');
  if (!captureId) {
    const res = await fetch(`${BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: 'demo-store',
            custom_id: 'spike-1',
            amount: { currency_code: 'USD', value: '25.00' },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: 'https://example.com/return',
              cancel_url: 'https://example.com/cancel',
            },
          },
        },
      }),
    });
    const body = (await res.json()) as { id?: string; links?: { rel: string; href: string }[] };
    console.log('status', res.status, 'debug-id', res.headers.get('paypal-debug-id'));
    console.log('order id:', body.id);
    console.log(
      'approval link:',
      body.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href,
    );
    return;
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${t}`,
    'content-type': 'application/json',
  };
  const mock = flag('--mock');
  if (mock) headers['PayPal-Mock-Response'] = JSON.stringify({ mock_application_codes: mock });
  const res = await fetch(`${BASE}/v2/checkout/orders/${captureId}/capture`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  console.log('status', res.status, 'debug-id', res.headers.get('paypal-debug-id'));
  console.log(JSON.stringify(await res.json(), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
