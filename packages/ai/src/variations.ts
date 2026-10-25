import { SCENARIO_META, VariationOutput } from '@payclinic/contracts';
import type {
  AIProvider,
  Product,
  ScenarioKey,
  VariationOutput as VariationOutputType,
} from '@payclinic/contracts';
import { makeCacheKey } from './cache-key';
import { SYSTEM_PROMPT, type Prompt } from './prompts';

/** The validated shape of a single variation entry. */
type VariationEntry = VariationOutputType['variations'][number];

export interface VariationsDeps {
  provider: AIProvider;
}

/**
 * Builds the deterministic prompt that asks the model to propose extra carts
 * (alternative items, currencies) for an existing merchant scenario.
 */
export function buildVariationsPrompt(scenarioKey: ScenarioKey, catalog: Product[]): Prompt {
  const meta = SCENARIO_META[scenarioKey];
  const catalogJson = JSON.stringify(
    catalog.map((p) => ({ sku: p.sku, name: p.name, currency: p.currency, price: p.price })),
    null,
    2,
  );

  const prompt = [
    `Propose up to 5 alternative cart variations for merchant scenario ${scenarioKey}.`,
    `Scenario title: ${meta.title}`,
    `Scenario description: ${meta.description}`,
    'Available products (catalog):',
    catalogJson,
    'Rules:',
    '- Each variation must use only SKUs from the catalog above.',
    '- The currency in params must match the product currency in the catalog.',
    '- scenarioKey must be a merchant scenario key (B1–B6), never an agent scenario (A1, A2).',
    '- Propose at most 5 variations.',
    'Return JSON with exactly this shape: variations [{scenarioKey, title, params: {currency, items: [{sku, qty}]}}].',
  ].join('\n\n');

  return { system: SYSTEM_PROMPT, prompt };
}

/**
 * Drops variation entries that would be invalid to run:
 * - unknown sku (not in catalog)
 * - currency mismatch (param currency != product currency in catalog)
 * - agent scenario key (A1 or A2)
 * Caps the resulting list at 5 entries.
 */
export function validateVariations(output: VariationEntry[], catalog: Product[]): VariationEntry[] {
  const skuMap = new Map<string, Product>(catalog.map((p) => [p.sku, p]));

  const isAgentScenario = (key: string): boolean => key === 'A1' || key === 'A2';

  const isValid = (entry: VariationEntry): boolean => {
    if (isAgentScenario(entry.scenarioKey)) return false;

    for (const item of entry.params.items) {
      const product = skuMap.get(item.sku);
      // Drop if unknown sku
      if (!product) return false;
      // Drop if the variation currency does not match the product's currency
      if (product.currency !== entry.params.currency) return false;
    }

    return true;
  };

  return output.filter(isValid).slice(0, 5);
}

/**
 * Asks the provider to generate scenario variations and returns the validated list.
 * Any provider failure (network, output parse, rate limit, etc.) returns [].
 */
export async function generateVariations(
  deps: VariationsDeps,
  scenarioKey: ScenarioKey,
  catalog: Product[],
): Promise<VariationEntry[]> {
  try {
    const { system, prompt } = buildVariationsPrompt(scenarioKey, catalog);
    const task = 'variations' as const;

    const output = await deps.provider.generateJSON({
      task,
      system,
      prompt,
      schema: VariationOutput,
      cacheKey: makeCacheKey({ task, system, prompt, model: deps.provider.name }),
      fixtureKey: `${task}:${scenarioKey}`,
    });

    return validateVariations(output.variations, catalog);
  } catch {
    // Any provider failure returns an empty list; callers must not rely on AI availability.
    return [];
  }
}
