import { ExplainOutput, SOURCE_FILES_FOR_SCENARIO } from '@payclinic/contracts';
import type {
  AIProvider,
  ExplainOutput as ExplainOutputType,
  Finding,
  Step,
} from '@payclinic/contracts';
import { makeCacheKey } from './cache-key';
import { buildExplainPrompt, type SourceFile } from './prompts';

export interface ExplainDeps {
  provider: AIProvider;
  readSource: (file: string) => string;
}

/** Reads the scenario's known source files through the injected reader. */
export function loadScenarioSources(
  finding: Finding,
  readSource: (file: string) => string,
): SourceFile[] {
  return (SOURCE_FILES_FOR_SCENARIO[finding.scenarioKey] ?? []).map((file) => ({
    file,
    content: readSource(file),
  }));
}

/** Asks the provider for a validated explanation of a finding. */
export async function explain(
  deps: ExplainDeps,
  finding: Finding,
  steps: Step[],
): Promise<ExplainOutputType> {
  const sources = loadScenarioSources(finding, deps.readSource);
  const { system, prompt } = buildExplainPrompt({ finding, steps, sources });
  const task = 'explain' as const;

  return deps.provider.generateJSON({
    task,
    system,
    prompt,
    schema: ExplainOutput,
    cacheKey: makeCacheKey({ task, system, prompt, model: deps.provider.name }),
    fixtureKey: `${task}:${finding.scenarioKey}`,
  });
}
