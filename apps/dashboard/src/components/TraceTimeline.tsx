import { useState } from 'react';
import type { Step } from '@payclinic/contracts';
import { describeStep, orderSteps } from '../lib/trace';

export interface TraceTimelineProps {
  steps: Step[];
  evidenceStepIds: string[];
}

export function TraceTimeline({ steps, evidenceStepIds }: TraceTimelineProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const evidence = new Set(evidenceStepIds);
  const ordered = orderSteps(steps);

  return (
    <div className="timeline-container">
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
    </div>
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
      className={`timeline__item timeline__item--${described.tone} ${isEvidence ? 'timeline__item--evidence' : ''}`}
      aria-current={isEvidence ? 'true' : undefined}
    >
      <div className={`timeline__dot timeline__dot--${described.tone}`} />
      <button
        type="button"
        className="timeline__row"
        data-testid="timeline-row"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="timeline__actor">{described.actorLabel}</span>
        <span className="timeline__title">{described.title}</span>
        <span className={`chip chip--${described.tone}`}>
          {described.chip}
        </span>
        {step.paypalDebugId && (
          <span className="chip timeline__debug">
            {step.paypalDebugId}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="timeline__details">
          <div className="timeline__pane">
            <span className="timeline__pane-label">Request</span>
            <pre className="timeline__body">{formatBody(step.requestBody)}</pre>
          </div>
          <div className="timeline__pane">
            <span className="timeline__pane-label">Response</span>
            <pre className="timeline__body">{formatBody(step.responseBody)}</pre>
          </div>
        </div>
      )}
    </li>
  );
}

const formatBody = (value: unknown): string => JSON.stringify(value ?? null, null, 2);
