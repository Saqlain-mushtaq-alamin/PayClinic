import { useState } from 'react';
import type { Step } from '@payclinic/contracts';
import { describeStep, orderSteps, type StepTone } from '../lib/trace';

export interface TraceTimelineProps {
  steps: Step[];
  evidenceStepIds: string[];
}

const TONE_COLOR: Record<StepTone, string> = {
  ok: 'var(--color-ok)',
  warn: 'var(--color-warn)',
  error: 'var(--color-danger)',
};

export function TraceTimeline({ steps, evidenceStepIds }: TraceTimelineProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const evidence = new Set(evidenceStepIds);
  const ordered = orderSteps(steps);

  return (
    <ul className="timeline">
      {ordered.map((step) => (
        <TraceRow
          key={step.id}
          step={step}
          isEvidence={evidence.has(step.id)}
          isOpen={openId === step.id}
          onToggle={() => setOpenId((current) => (current === step.id ? null : step.id))}
        />
      ))}
    </ul>
  );
}

function TraceRow(props: {
  step: Step;
  isEvidence: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { step, isEvidence, isOpen, onToggle } = props;
  const described = describeStep(step);

  return (
    <li
      data-testid={`timeline-row-${step.id}`}
      className="timeline__item"
      style={{
        position: 'relative',
        paddingLeft: '1rem',
        borderLeft: `4px solid ${isEvidence ? 'var(--color-accent)' : 'transparent'}`,
        margin: 'none',
      }}
      aria-current={isEvidence ? 'true' : undefined}
    >
      <button
        type="button"
        className="timeline__row"
        data-testid="timeline-row"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          width: '100%',
          background: 'transparent',
          color: 'var(--color-text)',
          cursor: 'pointer',
          padding: '0.4rem 0.6rem',
          font: 'inherit',
          textAlign: 'left',
          borderRadius: 'var(--radius-sm)',
          gap: '0.6rem',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span className="timeline__actor" style={{ minWidth: '7ch', fontWeight: 600 }}>
          {described.actorLabel}
        </span>
        <span style={{ flex: 1 }}>{described.title}</span>
        <span
          className={`chip chip--${described.tone}`}
          style={{
            color: TONE_COLOR[described.tone],
            border: `1px solid ${TONE_COLOR[described.tone]}`,
            borderRadius: 'var(--radius-pill)',
            padding: '0.1rem 0.4rem',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          {described.chip}
        </span>
        {step.paypalDebugId && (
          <span
            className="chip timeline__debug"
            style={{
              color: 'var(--color-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-pill)',
              padding: '0.1rem 0.4rem',
              fontSize: '0.7rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            }}
          >
            {step.paypalDebugId}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="timeline__details" style={{ padding: '0 0 0.6rem 1rem' }}>
          <pre
            className="timeline__body"
            style={{
              font: '0.75rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              background: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.5rem',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              color: 'var(--color-text)',
            }}
          >
            {formatBody(step.requestBody)}
          </pre>
          <pre
            className="timeline__body"
            style={{
              font: '0.75rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              background: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.5rem',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              color: 'var(--color-text)',
            }}
          >
            {formatBody(step.responseBody)}
          </pre>
        </div>
      )}
    </li>
  );
}

const formatBody = (value: unknown): string => JSON.stringify(value ?? null, null, 2);
