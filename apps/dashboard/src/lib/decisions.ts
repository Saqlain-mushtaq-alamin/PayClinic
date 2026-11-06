import type { FirewallDecision } from '@payclinic/contracts';

export interface DecisionRow {
  id: string;
  time: string;
  action: string;
  rule: string;
  reason: string;
  merchant: string;
  sku: string;
  qty: number;
  amount: string;
}

/** Maps a firewall decision to one DecisionLog grid row. Pure. */
export function toDecisionRow(decision: FirewallDecision): DecisionRow {
  return {
    id: decision.id,
    time: decision.ts,
    action: decision.action,
    rule: decision.ruleId ?? '—',
    reason: decision.reason,
    merchant: decision.request.merchantId,
    sku: decision.request.sku,
    qty: decision.request.qty,
    amount: decision.request.amount,
  };
}

/** Maps decisions to grid rows in order. Pure. */
export function toDecisionRows(decisions: FirewallDecision[]): DecisionRow[] {
  return decisions.map(toDecisionRow);
}

/** One-line summary like "4 blocked, 1 allowed"; zero counts are omitted. Pure. */
export function summarizeDecisions(decisions: FirewallDecision[]): string {
  if (decisions.length === 0) return 'No decisions';
  const count = (action: string): number =>
    decisions.filter((decision) => decision.action === action).length;
  const parts: string[] = [];
  const blocked = count('block');
  const allowed = count('allow');
  const escalated = count('escalate');
  if (blocked > 0) parts.push(`${blocked} blocked`);
  if (allowed > 0) parts.push(`${allowed} allowed`);
  if (escalated > 0) parts.push(`${escalated} escalated`);
  return parts.join(', ');
}
