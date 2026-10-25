import { PatchOutput } from '@payclinic/contracts';
import type {
  AIProvider,
  ExplainOutput,
  Finding,
  PatchOutput as PatchOutputType,
} from '@payclinic/contracts';
import { makeCacheKey } from './cache-key';
import { loadScenarioSources } from './explain';
import { buildPatchPrompt } from './prompts';

export interface PatchDeps {
  provider: AIProvider;
  readSource: (file: string) => string;
}

/** Asks the provider for a validated, exact-substring patch for a finding. */
export async function generatePatch(
  deps: PatchDeps,
  finding: Finding,
  explanation: ExplainOutput,
): Promise<PatchOutputType> {
  const sources = loadScenarioSources(finding, deps.readSource);
  const { system, prompt } = buildPatchPrompt({ finding, explanation, sources });
  const task = 'patch' as const;

  return deps.provider.generateJSON({
    task,
    system,
    prompt,
    schema: PatchOutput,
    cacheKey: makeCacheKey({ task, system, prompt, model: deps.provider.name }),
    fixtureKey: `${task}:${finding.scenarioKey}`,
  });
}
