import type {
  InvariantContext,
  InvariantKey,
  InvariantRegistry,
  InvariantResult,
} from '@payclinic/contracts';
import { i07, i08, i09 } from './agent';
import { i03, i06 } from './amounts';
import { i01, i02, i04 } from './store';
import { i05 } from './webhooks';

export const INVARIANTS: Partial<InvariantRegistry> = {
  'I-01': i01,
  'I-02': i02,
  'I-03': i03,
  'I-04': i04,
  'I-05': i05,
  'I-06': i06,
  'I-07': i07,
  'I-08': i08,
  'I-09': i09,
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
