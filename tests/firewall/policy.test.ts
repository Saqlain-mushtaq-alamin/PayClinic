import { describe, expect, it } from 'vitest';
import type { AIProvider, AgentIntent, Policy } from '@payclinic/contracts';
import {
  defaultPolicyFor,
  generatePolicy,
  parsePolicy,
  PolicyParseError,
  serializePolicy,
} from '@payclinic/firewall';

const intent: AgentIntent = {
  skus: ['tee-001'],
  maxQtyPerSku: 1,
  budget: '40.00',
  perTxnCap: '30.00',
  currency: 'USD',
};
const provider = (policy: Partial<Policy> | Error): AIProvider => ({
  name: 'p',
  generateJSON: async () => {
    if (policy instanceof Error) throw policy;
    return { policy: { version: 1, currency: 'USD', ...policy }, rationale: 'r' } as never;
  },
});
const good = {
  perTransactionCap: '30.00',
  sessionBudget: '40.00',
  merchantAllowlist: ['demo-store'],
  duplicateWindowSec: 600,
};
const input = { findings: [], intent, allowedMerchants: ['demo-store'] };

describe('policy yaml', () => {
  it('round-trips and keeps comments', () => {
    const p = defaultPolicyFor(intent, ['demo-store'], { approvalThreshold: '25.00' });
    const text = serializePolicy(p);
    expect(text).toMatch(/# R3 merchant allowlist/);
    expect(parsePolicy(text)).toEqual(p);
  });
  it('rejects invalid YAML policies', () => {
    let error: unknown = null;
    try {
      parsePolicy('version: 2\ncurrency: usd');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PolicyParseError);
  });
});

describe('generatePolicy', () => {
  it('accepts a strict AI policy', async () =>
    expect(await generatePolicy({ provider: provider(good) }, input)).toMatchObject({
      source: 'ai',
    }));
  it.each([
    ['extra merchant', { ...good, merchantAllowlist: ['demo-store', 'sketchy-deals'] }],
    ['empty allowlist', { ...good, merchantAllowlist: [] }],
    ['cap above intent', { ...good, perTransactionCap: '99.00' }],
    ['budget above intent', { ...good, sessionBudget: '500.00' }],
    ['missing dedupe window', { ...good, duplicateWindowSec: undefined }],
  ])('falls back to the default for %s', async (_n, bad) => {
    const out = await generatePolicy({ provider: provider(bad as Partial<Policy>) }, input);
    expect(out.source).toBe('template');
    expect(out.policy).toEqual(defaultPolicyFor(intent, ['demo-store']));
  });
  it('falls back when the provider throws', async () =>
    expect((await generatePolicy({ provider: provider(new Error('down')) }, input)).source).toBe(
      'template',
    ));
});
