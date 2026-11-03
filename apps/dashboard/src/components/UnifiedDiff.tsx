import { parseUnifiedDiff, type DiffLine, type DiffLineKind } from '../lib/diff';

export interface UnifiedDiffProps {
  diff: string;
}

const LINE_COLOR: Record<DiffLineKind, string | undefined> = {
  meta: 'var(--color-muted)',
  hunk: 'var(--color-muted)',
  add: 'var(--color-ok)',
  del: 'var(--color-danger)',
  ctx: undefined,
};

export function UnifiedDiff({ diff }: UnifiedDiffProps) {
  const lines = parseUnifiedDiff(diff);

  return (
    <div
      data-testid="diff"
      className="diff"
      style={{
        font: '0.8rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '0.5rem 0.75rem',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
      }}
    >
      {lines.map((line, index) => (
        <DiffLineRow key={index} line={line} />
      ))}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const color = LINE_COLOR[line.kind];

  return (
    <div className={`diff__line diff__line--${line.kind}`} style={color ? { color } : undefined}>
      <code>{line.text}</code>
    </div>
  );
}
