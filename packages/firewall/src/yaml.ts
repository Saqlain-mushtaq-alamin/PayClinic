import { parse, stringify } from 'yaml';
import { Policy } from '@payclinic/contracts';
import type { AgentIntent } from '@payclinic/contracts';

const COMMENT_BLOCK = [
  '# PayClinic spending firewall policy (v1).',
  '# Amounts are decimal strings in the policy currency.',
  '# R1 per-transaction cap',
  '# R2 session budget',
  '# R3 merchant allowlist (deny by default)',
  '# R4 approval threshold',
  '# R5 duplicate window',
].join('\n');

export class PolicyParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PolicyParseError';
  }
}

/** Serializes a policy as YAML with the rule comments kept at the top. */
export function serializePolicy(policy: Policy): string {
  return `${COMMENT_BLOCK}\n${stringify(policy)}`;
}

/** Parses untrusted YAML and validates it as a policy. */
export function parsePolicy(text: string): Policy {
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    throw new PolicyParseError('Policy YAML could not be parsed', { cause: error });
  }

  const result = Policy.safeParse(value);
  if (!result.success) {
    throw new PolicyParseError(`Invalid policy: ${result.error.message}`, { cause: result.error });
  }
  return result.data;
}

/** Safe baseline policy that is never weaker than the stated user intent. */
export function defaultPolicyFor(
  intent: AgentIntent,
  allowedMerchants: string[],
  extra?: { approvalThreshold?: string },
): Policy {
  return {
    version: 1,
    currency: intent.currency,
    perTransactionCap: intent.perTxnCap,
    sessionBudget: intent.budget,
    merchantAllowlist: allowedMerchants,
    duplicateWindowSec: 600,
    ...(extra ?? {}),
  };
}
