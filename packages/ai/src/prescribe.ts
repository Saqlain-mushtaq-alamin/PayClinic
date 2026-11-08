import { isDeepStrictEqual } from 'node:util';
import { Patch as PatchSchema } from '@payclinic/contracts';
import type {
  AIProvider,
  Explanation,
  ExplainOutput,
  Finding,
  Patch,
  PatchEdit,
  PatchOutput,
  ScenarioKey,
  Step,
} from '@payclinic/contracts';
import { AIRateLimitError, AIOutputError, FixtureMissingError } from './errors';
import { explain } from './explain';
import { generatePatch } from './patch';
import { templateExplanation } from './template';

export interface PrescribeDeps {
  provider: AIProvider;
  readSource: (repoRelativePath: string) => string;
  loadReferencePatch: (scenarioKey: ScenarioKey) => PatchOutput | null;
  deriveDiff: (edits: PatchEdit[]) => string;
  newId: () => string;
  now: () => string;
  sourceFiles?: string[];
  isRemote?: boolean;
  geminiConfigured?: boolean;
}

export class PrescribeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrescribeError';
  }
}

function isAiFailure(error: unknown): boolean {
  return (
    error instanceof AIOutputError ||
    error instanceof FixtureMissingError ||
    error instanceof AIRateLimitError
  );
}

interface PatchInput {
  edits: PatchEdit[];
  testFile?: PatchOutput['testFile'];
  rationale?: string;
  source: 'ai' | 'template';
  model?: string;
}

function buildPatch(deps: PrescribeDeps, finding: Finding, input: PatchInput): Patch {
  const candidate = {
    id: deps.newId(),
    findingId: finding.id,
    edits: input.edits,
    diff: deps.deriveDiff(input.edits),
    source: input.source,
    createdAt: deps.now(),
    ...(input.testFile ? { testFile: input.testFile } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.rationale ? { rationale: input.rationale } : {}),
  };

  return PatchSchema.parse(candidate);
}

/**
 * Returns an explanation plus ordered candidate patches: the AI patch first and
 * the proven reference patch second. Verification of candidates is the caller's job.
 */
export async function prescribe(
  deps: PrescribeDeps,
  finding: Finding,
  steps: Step[],
): Promise<{ explanation: Explanation; patches: Patch[]; message?: string }> {
  // Remote project without Gemini: return clear configure message
  if (deps.isRemote && (!deps.geminiConfigured || deps.provider.name !== 'gemini')) {
    const message = 'Configure Gemini in Settings to get an AI fix';
    const explanation: Explanation = {
      findingId: finding.id,
      rootCause: message,
      impact: message,
      whereInCode: { file: '', hint: message },
      fixSummary: message,
      model: 'template',
      createdAt: deps.now(),
    };
    return { explanation, patches: [], message };
  }

  // Builtin project with Gemini selected but not configured: never silently fall back
  if (!deps.isRemote && deps.provider.name === 'gemini' && deps.geminiConfigured === false) {
    throw new PrescribeError('Gemini is selected but not configured in Settings');
  }

  // For remote projects, disable reference patch and template fallback
  const reference = deps.isRemote ? null : deps.loadReferencePatch(finding.scenarioKey);
  const providerDeps = {
    provider: deps.provider,
    readSource: deps.readSource,
    sourceFiles: deps.sourceFiles,
  };

  let explainOutput: ExplainOutput | null = null;
  let explanation: Explanation;
  try {
    explainOutput = await explain(providerDeps, finding, steps);
    explanation = {
      findingId: finding.id,
      ...explainOutput,
      model: deps.provider.name,
      createdAt: deps.now(),
    };
  } catch (error) {
    if (!isAiFailure(error)) throw error;
    if (deps.isRemote) {
      throw new PrescribeError(
        error instanceof Error ? error.message : 'AI explanation failed for remote project',
      );
    }
    explanation = templateExplanation(finding, reference, deps.now());
  }

  let aiPatch: Patch | null = null;
  try {
    const patchOutput = await generatePatch(providerDeps, finding, explainOutput ?? explanation);
    aiPatch = buildPatch(deps, finding, {
      edits: patchOutput.edits,
      testFile: patchOutput.testFile,
      rationale: patchOutput.rationale,
      source: 'ai',
      model: deps.provider.name,
    });
  } catch (error) {
    if (!isAiFailure(error)) throw error;
  }

  const patches: Patch[] = [];
  if (aiPatch) patches.push(aiPatch);
  if (reference && !(aiPatch && isDeepStrictEqual(aiPatch.edits, reference.edits))) {
    patches.push(
      buildPatch(deps, finding, {
        edits: reference.edits,
        testFile: reference.testFile,
        rationale: reference.rationale,
        source: 'template',
      }),
    );
  }

  if (patches.length === 0) {
    throw new PrescribeError(`No patch could be produced for finding ${finding.id}`);
  }

  return { explanation, patches };
}
