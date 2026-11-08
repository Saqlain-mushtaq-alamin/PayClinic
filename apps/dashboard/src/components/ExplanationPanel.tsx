import type { Explanation } from '@payclinic/contracts';

export interface ExplanationPanelProps {
  explanation: Explanation;
}

export function ExplanationPanel({ explanation }: ExplanationPanelProps) {
  return (
    <section className="explanation">
      <h3>Root cause</h3>
      <p>{explanation.rootCause}</p>
      <h3>Impact</h3>
      <p>{explanation.impact}</p>
      <h3>Where in code</h3>
      <p>
        <code>{explanation.whereInCode.file}</code> ({explanation.whereInCode.hint})
      </p>
      <h3>Fix summary</h3>
      <p>{explanation.fixSummary}</p>
      <p>
        <span className="chip chip--neutral">
          {explanation.model === 'template' ? (
            'Reference fix'
          ) : (
            <>
              AI: <span>{explanation.model}</span>
            </>
          )}
        </span>
      </p>
    </section>
  );
}
