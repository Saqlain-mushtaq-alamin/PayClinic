import { createHash } from 'node:crypto';
import type { AITask } from '@payclinic/contracts';

export interface CacheKeyInput {
  task: AITask;
  system: string;
  prompt: string;
  model: string;
}

/** Stable disk-cache key: sha256 of the canonical JSON of the prompt identity. */
export function makeCacheKey(input: CacheKeyInput): string {
  const { task, system, prompt, model } = input;
  return createHash('sha256').update(JSON.stringify({ task, system, prompt, model })).digest('hex');
}
