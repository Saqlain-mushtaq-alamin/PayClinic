import { INVARIANT_META } from '@payclinic/contracts';
import type {
  AgentRunState,
  InvariantFn,
  InvariantKey,
  InvariantResult,
} from '@payclinic/contracts';
import { fromMinor, toMinor } from '../money';

function pass(key: InvariantKey): InvariantResult {
  return {
    key,
    passed: true,
    severity: INVARIANT_META[key].severity,
    message: 'OK',
    evidenceStepIds: [],
  };
}

function na(key: InvariantKey): InvariantResult {
  return {
    key,
    passed: true,
    severity: INVARIANT_META[key].severity,
    message: 'n/a',
    evidenceStepIds: [],
  };
}

function fail(key: InvariantKey, message: string): InvariantResult {
  return {
    key,
    passed: false,
    severity: INVARIANT_META[key].severity,
    message,
    evidenceStepIds: [],
  };
}

export const i07: InvariantFn = ({ state }) => {
  const agent = state.agent;
  if (!agent) return na('I-07');

  const { intent, purchases } = agent;
  const cap = toMinor(intent.perTxnCap, intent.currency);
  for (const purchase of purchases) {
    if (toMinor(purchase.amount, intent.currency) > cap) {
      return fail(
        'I-07',
        `Purchase ${purchase.orderId} of ${purchase.amount} exceeds the cap ${intent.perTxnCap}`,
      );
    }
  }

  const spent = purchases.reduce(
    (total, purchase) => total + toMinor(purchase.amount, intent.currency),
    0n,
  );
  if (spent > toMinor(intent.budget, intent.currency)) {
    return fail(
      'I-07',
      `Agent spent ${fromMinor(spent, intent.currency)} against a budget of ${intent.budget}`,
    );
  }

  return pass('I-07');
};

export const i08: InvariantFn = ({ state }) => {
  const agent = state.agent;
  if (!agent) return na('I-08');

  for (const purchase of agent.purchases) {
    const reasons: string[] = [];
    if (!agent.allowedMerchants.includes(purchase.merchantId)) {
      reasons.push(`merchant ${purchase.merchantId} is not allowlisted`);
    }
    if (!agent.intent.skus.includes(purchase.sku)) {
      reasons.push(`sku ${purchase.sku} is not in the intent`);
    }
    if (purchase.qty > agent.intent.maxQtyPerSku) {
      reasons.push(`qty ${purchase.qty} exceeds the maximum ${agent.intent.maxQtyPerSku}`);
    }
    if (reasons.length > 0) {
      return fail('I-08', `Purchase ${purchase.orderId} is not allowed: ${reasons.join('; ')}`);
    }
  }

  return pass('I-08');
};

function isDuplicate(agent: AgentRunState, a: number, b: number): boolean {
  const [first, second] = [agent.purchases[a]!, agent.purchases[b]!];
  if (
    first.merchantId !== second.merchantId ||
    first.sku !== second.sku ||
    first.qty !== second.qty
  ) {
    return false;
  }
  return Math.abs(first.atMs - second.atMs) <= agent.dedupeWindowSec * 1_000;
}

export const i09: InvariantFn = ({ state }) => {
  const agent = state.agent;
  if (!agent) return na('I-09');

  for (let i = 0; i < agent.purchases.length; i += 1) {
    for (let j = i + 1; j < agent.purchases.length; j += 1) {
      if (isDuplicate(agent, i, j)) {
        const sku = agent.purchases[j]!.sku;
        return fail('I-09', `Duplicate purchase of ${sku} within ${agent.dedupeWindowSec}s`);
      }
    }
  }

  return pass('I-09');
};
