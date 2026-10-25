import { describe, expect, it } from 'vitest';
import type { AIProvider, GenerateJsonOptions, Product, ScenarioKey } from '@payclinic/contracts';
import { AIOutputError } from '@payclinic/ai';
import {
  buildVariationsPrompt,
  generateVariations,
  validateVariations,
} from '@payclinic/ai';

// ─── Shared catalog fixtures ───────────────────────────────────────────────

const usdProduct: Product = {
  sku: 'tee-001',
  name: 'Logo Tee',
  description: 'A logo tee.',
  price: '25.00',
  currency: 'USD',
  merchantId: 'demo-store',
};

const jpyProduct: Product = {
  sku: 'jp-pen-01',
  name: 'JP Pen',
  description: 'A pen.',
  price: '1200',
  currency: 'JPY',
  merchantId: 'demo-store',
};

const catalog: Product[] = [usdProduct, jpyProduct];

// ─── Helper: make a variation entry ───────────────────────────────────────

const v = (
  scenarioKey: ScenarioKey,
  sku: string,
  currency: string,
  qty = 1,
) => ({
  scenarioKey,
  title: `Variation for ${scenarioKey}`,
  params: { currency, items: [{ sku, qty }] },
});

// ─── validateVariations ────────────────────────────────────────────────────

describe('validateVariations', () => {
  it('keeps a valid entry that matches catalog sku and currency', () => {
    const result = validateVariations(
      [v('B1', 'tee-001', 'USD')],
      catalog,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.params.items[0]!.sku).toBe('tee-001');
  });

  it('drops an entry whose sku is not in the catalog', () => {
    const result = validateVariations(
      [v('B1', 'unknown-sku', 'USD')],
      catalog,
    );
    expect(result).toHaveLength(0);
  });

  it('drops an entry whose currency differs from the product currency', () => {
    // tee-001 is USD; providing GBP is a mismatch
    const result = validateVariations(
      [v('B1', 'tee-001', 'GBP')],
      catalog,
    );
    expect(result).toHaveLength(0);
  });

  it('drops an entry whose scenarioKey is an agent scenario (A1)', () => {
    const result = validateVariations(
      [v('A1', 'tee-001', 'USD')],
      catalog,
    );
    expect(result).toHaveLength(0);
  });

  it('drops an entry whose scenarioKey is an agent scenario (A2)', () => {
    const result = validateVariations(
      [v('A2', 'tee-001', 'USD')],
      catalog,
    );
    expect(result).toHaveLength(0);
  });

  it('caps the validated list at 5 entries when more are provided', () => {
    const many = Array.from({ length: 8 }, (_, i) => v('B1', 'tee-001', 'USD', i + 1));
    const result = validateVariations(many, catalog);
    expect(result).toHaveLength(5);
  });

  it('accepts a multi-sku variation where all skus are in the catalog with matching currency', () => {
    const multi = {
      scenarioKey: 'B2' as const,
      title: 'Multi-item variation',
      params: {
        currency: 'USD',
        items: [
          { sku: 'tee-001', qty: 1 },
        ],
      },
    };
    expect(validateVariations([multi], catalog)).toHaveLength(1);
  });

  it('keeps a JPY variation when currency matches catalog', () => {
    const result = validateVariations(
      [v('B5', 'jp-pen-01', 'JPY')],
      catalog,
    );
    expect(result).toHaveLength(1);
  });

  it('drops a JPY-sku variation when currency is provided as USD', () => {
    const result = validateVariations(
      [v('B5', 'jp-pen-01', 'USD')],
      catalog,
    );
    expect(result).toHaveLength(0);
  });

  it('returns empty array when given an empty list', () => {
    expect(validateVariations([], catalog)).toHaveLength(0);
  });
});

// ─── buildVariationsPrompt ─────────────────────────────────────────────────

describe('buildVariationsPrompt', () => {
  it('returns a deterministic prompt for the same inputs', () => {
    const p1 = buildVariationsPrompt('B1', catalog);
    const p2 = buildVariationsPrompt('B1', catalog);
    expect(p1.prompt).toBe(p2.prompt);
    expect(p1.system).toBe(p2.system);
  });

  it('produces a different prompt for a different scenario key', () => {
    const p1 = buildVariationsPrompt('B1', catalog);
    const p2 = buildVariationsPrompt('B2', catalog);
    expect(p1.prompt).not.toBe(p2.prompt);
  });

  it('includes the scenario key in the prompt text', () => {
    const { prompt } = buildVariationsPrompt('B3', catalog);
    expect(prompt).toContain('B3');
  });

  it('includes catalog sku names in the prompt text', () => {
    const { prompt } = buildVariationsPrompt('B1', catalog);
    expect(prompt).toContain('tee-001');
  });
});

// ─── generateVariations ───────────────────────────────────────────────────

describe('generateVariations', () => {
  it('calls the provider with task "variations" and the correct fixtureKey', async () => {
    let capturedOpts: GenerateJsonOptions<unknown> | undefined;
    const provider: AIProvider = {
      name: 'spy',
      generateJSON: async (opts) => {
        capturedOpts = opts as GenerateJsonOptions<unknown>;
        return { variations: [v('B1', 'tee-001', 'USD')] } as never;
      },
    };
    await generateVariations({ provider }, 'B1', catalog);
    expect(capturedOpts?.task).toBe('variations');
    expect(capturedOpts?.fixtureKey).toBe('variations:B1');
  });

  it('returns validated variations on success', async () => {
    const provider: AIProvider = {
      name: 'ok',
      generateJSON: async () =>
        ({ variations: [v('B1', 'tee-001', 'USD')] }) as never,
    };
    const result = await generateVariations({ provider }, 'B1', catalog);
    expect(result).toHaveLength(1);
    expect(result[0]!.params.items[0]!.sku).toBe('tee-001');
  });

  it('returns [] when the provider throws AIOutputError', async () => {
    const provider: AIProvider = {
      name: 'broken',
      generateJSON: async () => {
        throw new AIOutputError('bad json');
      },
    };
    const result = await generateVariations({ provider }, 'B1', catalog);
    expect(result).toEqual([]);
  });

  it('returns [] when the provider throws any other error', async () => {
    const provider: AIProvider = {
      name: 'down',
      generateJSON: async () => {
        throw new Error('network error');
      },
    };
    const result = await generateVariations({ provider }, 'B2', catalog);
    expect(result).toEqual([]);
  });

  it('filters out invalid entries returned by the provider', async () => {
    const provider: AIProvider = {
      name: 'noisy',
      generateJSON: async () =>
        ({
          variations: [
            v('B1', 'tee-001', 'USD'),   // valid
            v('A1', 'tee-001', 'USD'),   // agent scenario – must be dropped
            v('B2', 'not-a-sku', 'USD'), // unknown sku – must be dropped
          ],
        }) as never,
    };
    const result = await generateVariations({ provider }, 'B1', catalog);
    expect(result).toHaveLength(1);
    expect(result[0]!.scenarioKey).toBe('B1');
  });
});
