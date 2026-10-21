import type { ScenarioKey } from '@payclinic/contracts';
import type { ScenarioFn } from '@payclinic/core';
import { b1 } from './b1';
import { b2 } from './b2';
import { b4 } from './b4';

export const SCENARIOS: Partial<Record<ScenarioKey, ScenarioFn>> = {
  B1: b1,
  B2: b2,
  B4: b4,
};
