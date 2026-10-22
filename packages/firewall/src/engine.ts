import type {
  FirewallDecision,
  FirewallEngine,
  GuardHistory,
  GuardRequest,
  Policy,
} from '@payclinic/contracts';
import { toMinor } from '@payclinic/core';

type Decision = Omit<FirewallDecision, 'id' | 'runId' | 'ts'>;

function decision(
  request: GuardRequest,
  action: Decision['action'],
  ruleId: Decision['ruleId'],
  reason: string,
): Decision {
  return { action, ruleId, reason, request };
}

/** Pure policy engine: first matching rule decides, in R3 → R1 → R2 → R5 → R4 order. */
export const firewallEngine: FirewallEngine = {
  evaluate(request: GuardRequest, policy: Policy, history: GuardHistory): Decision {
    const currency = policy.currency;
    const amount = toMinor(request.amount, currency);

    if (policy.merchantAllowlist !== undefined) {
      if (!policy.merchantAllowlist.includes(request.merchantId)) {
        return decision(
          request,
          'block',
          'R3',
          `Merchant ${request.merchantId} is not on the allowlist`,
        );
      }
    }

    if (policy.perTransactionCap !== undefined) {
      const cap = toMinor(policy.perTransactionCap, currency);
      if (amount > cap) {
        return decision(
          request,
          'block',
          'R1',
          `Amount ${request.amount} exceeds the per-transaction cap ${policy.perTransactionCap}`,
        );
      }
    }

    if (policy.sessionBudget !== undefined) {
      const budget = toMinor(policy.sessionBudget, currency);
      const spent = toMinor(history.sessionSpent, currency);
      if (spent + amount > budget) {
        return decision(
          request,
          'block',
          'R2',
          `Spend ${history.sessionSpent} + ${request.amount} would exceed the session budget ${policy.sessionBudget}`,
        );
      }
    }

    if (policy.duplicateWindowSec !== undefined) {
      const windowMs = policy.duplicateWindowSec * 1000;
      const threshold = history.nowMs - windowMs;
      const duplicate = history.recentPurchases.some(
        (p) =>
          p.merchantId === request.merchantId &&
          p.sku === request.sku &&
          p.qty === request.qty &&
          p.atMs >= threshold,
      );
      if (duplicate) {
        return decision(
          request,
          'block',
          'R5',
          `Duplicate purchase of ${request.sku} x${request.qty} from ${request.merchantId} within ${policy.duplicateWindowSec}s`,
        );
      }
    }

    if (policy.approvalThreshold !== undefined) {
      const threshold = toMinor(policy.approvalThreshold, currency);
      if (amount > threshold) {
        return decision(
          request,
          'escalate',
          'R4',
          `Amount ${request.amount} needs approval (threshold ${policy.approvalThreshold})`,
        );
      }
    }

    return { action: 'allow', ruleId: null, reason: 'Allowed by policy', request };
  },
};
