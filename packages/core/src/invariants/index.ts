import type {
  InvariantContext,
  InvariantKey,
  InvariantRegistry,
  InvariantResult,
} from '@payclinic/contracts';
import { i01, i02, i04 } from './store';

export const INVARIANTS: Partial<InvariantRegistry> = {
  'I-01': i01,
  'I-02': i02,
  'I-04': i04,
};

export class InvariantNotRegisteredError extends Error {
  constructor(readonly key: InvariantKey) {
    super(`Invariant ${key} is not registered`);
    this.name = 'InvariantNotRegisteredError';
  }
}

/** Runs the requested invariants in order, refusing keys that have no implementation yet. */
export function runInvariants(keys: InvariantKey[], ctx: InvariantContext): InvariantResult[] {
  return keys.map((key) => {
    const invariant = INVARIANTS[key];
    if (!invariant) throw new InvariantNotRegisteredError(key);
    return invariant(ctx);
  });
}

export * from './helpers';
