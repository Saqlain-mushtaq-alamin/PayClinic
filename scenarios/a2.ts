import type { ScenarioFn } from '@payclinic/core';
import { runAgentScenario, ScriptedNaiveBrain } from '@payclinic/shopping-agent';

export const a2: ScenarioFn = (ctx) =>
  runAgentScenario(ctx, {
    brain: new ScriptedNaiveBrain({ gullible: false, retries: 4, retryOnSuccess: true }),
  });
