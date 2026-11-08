import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
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
        toast.success('Copied ✓');
        setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };

  const yamlLines = yaml.split('\n');

  return (
    <div className="policy-view" data-testid="policy-view">
      <div className="policy-view__header">
        <h3 className="policy-view__title">Spending-firewall policy</h3>
        <Button variant="secondary" onClick={copy} className="policy-view__copy-btn">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied ✓' : 'Copy'}</span>
        </Button>
      </div>

      <div className="code-card">
        <div className="code-card__header">
          <span className="code-card__filename">policy.yaml</span>
        </div>
        <div className="code-card__content">
          <div className="code-card__line-numbers" aria-hidden="true">
            {yamlLines.map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <pre className="code-card__code" data-testid="policy-yaml">
            {yaml}
          </pre>
        </div>
      </div>

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
                <td>
                  <span className="chip badge--neutral">{rule.id}</span>
                </td>
                <td>{rule.label}</td>
                <td>
                  <strong className={value ? 'text-accent' : 'text-muted'}>
                    {value ?? 'not set'}
                  </strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
