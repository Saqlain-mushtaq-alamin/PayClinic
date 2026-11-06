import { useState } from 'react';
import type { Policy } from '@payclinic/contracts';
import { Button } from './ui/Button';

export interface PolicyViewProps {
  policy: Policy | null;
  yaml: string | null;
}

interface RuleSpec {
  id: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  label: string;
  value: (policy: Policy) => string | undefined;
}

const RULES: readonly RuleSpec[] = [
  { id: 'R1', label: 'Per-transaction cap', value: (p) => p.perTransactionCap },
  { id: 'R2', label: 'Session budget', value: (p) => p.sessionBudget },
  {
    id: 'R3',
    label: 'Merchant allowlist',
    value: (p) => p.merchantAllowlist?.join(', '),
  },
  { id: 'R4', label: 'Approval threshold', value: (p) => p.approvalThreshold },
  {
    id: 'R5',
    label: 'Duplicate window',
    value: (p) => (p.duplicateWindowSec === undefined ? undefined : `${p.duplicateWindowSec}s`),
  },
];

/** Shows the spending-firewall policy: the generated YAML and the R1–R5 rules. */
export function PolicyView({ policy, yaml }: PolicyViewProps) {
  const [copied, setCopied] = useState(false);
  if (!policy || !yaml) return null;

  const copy = () => {
    navigator.clipboard.writeText(yaml).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };

  return (
    <div className="policy-view" data-testid="policy-view">
      <h2>Spending-firewall policy</h2>
      <pre
        className="policy-view__yaml"
        data-testid="policy-yaml"
        style={{
          font: '0.8rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          background: 'var(--color-surface-muted)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.6rem',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {yaml}
      </pre>
      <Button onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      <table className="policy-view__rules">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Setting</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {RULES.map((rule) => {
            const value = rule.value(policy);
            return (
              <tr key={rule.id} data-testid={`rule-${rule.id}`}>
                <td>{rule.id}</td>
                <td>{rule.label}</td>
                <td>{value ?? 'not set'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
