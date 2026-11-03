import type { VerifyResult } from '@payclinic/contracts';

export interface VerifyBadgeProps {
  verify: VerifyResult | null;
}

export function VerifyBadge({ verify }: VerifyBadgeProps) {
  if (!verify) return <span className="chip chip--neutral">—</span>;

  if (verify.verified) {
    return (
      <span
        className="chip chip--ok"
        style={{ color: 'var(--color-ok)', borderColor: 'var(--color-ok)' }}
      >
        Verified ✓ {formatDuration(verify.durationMs)}
      </span>
    );
  }

  const lastLogLine = verify.log[verify.log.length - 1] ?? '';

  return (
    <span
      className="chip chip--warn"
      style={{ color: 'var(--color-warn)', borderColor: 'var(--color-warn)' }}
    >
      <span>Not verified</span>
      {lastLogLine && <span>{lastLogLine}</span>}
    </span>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}
