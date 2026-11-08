import { parseUnifiedDiff, type DiffLine } from '../lib/diff';

export interface UnifiedDiffProps {
  diff: string;
}

export function UnifiedDiff({ diff }: UnifiedDiffProps) {
  const lines = parseUnifiedDiff(diff);

  return (
    <div data-testid="diff" className="diff code-card">
      <div className="code-card__header">
        <span className="code-card__filename">patch.diff</span>
      </div>
      <div className="diff__content">
        {lines.map((line, index) => (
          <DiffLineRow key={index} line={line} lineNumber={index + 1} />
        ))}
      </div>
    </div>
  );
}

function DiffLineRow({ line, lineNumber }: { line: DiffLine; lineNumber: number }) {
  return (
    <div className={`diff__line diff__line--${line.kind}`}>
      <span className="diff__gutter" aria-hidden="true">
        {lineNumber}
      </span>
      <code className="diff__code">{line.text}</code>
    </div>
  );
}
