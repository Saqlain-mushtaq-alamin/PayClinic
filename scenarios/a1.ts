import type { ScenarioFn } from '@payclinic/core';
import { runAgentScenario, ScriptedNaiveBrain } from '@payclinic/shopping-agent';

export const a1: ScenarioFn = (ctx) =>
  runAgentScenario(ctx, {
    brain: new ScriptedNaiveBrain({ gullible: true, retries: 0 }),
  });
