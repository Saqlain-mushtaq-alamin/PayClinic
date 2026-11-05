import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { Step } from '@payclinic/contracts';
import { createReplayState, intervalMs, replayReducer, type ReplaySpeed } from '../lib/replay';
import { describeStep, orderSteps } from '../lib/trace';
import { TraceTimeline } from './TraceTimeline';

export interface TraceReplayProps {
  steps: Step[];
  evidenceStepIds: string[];
  /** One-line verdict shown when the replay reaches the last step (the finding summary). */
  verdict: string;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Replays the trace step by step above the timeline, with playback controls. */
export function TraceReplay({ steps, evidenceStepIds, verdict }: TraceReplayProps) {
  const ordered = useMemo(() => orderSteps(steps), [steps]);
  const total = ordered.length;
  const [state, dispatch] = useReducer(replayReducer, undefined, createReplayState);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!state.playing || total === 0) return;
    const id = window.setInterval(() => dispatch({ type: 'tick', total }), intervalMs(state.speed));
    return () => window.clearInterval(id);
  }, [state.playing, state.speed, total]);

  // Auto-scroll the current row into view; no animation under reduced motion.
  useEffect(() => {
    const current = ordered[state.index - 1];
    if (!current) return;
    const row = containerRef.current?.querySelector(`[data-testid="timeline-row-${current.id}"]`);
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
  }, [state.index, ordered, reducedMotion]);

  const toggle = () => dispatch({ type: state.playing ? 'pause' : 'play' });
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      event.preventDefault();
      toggle();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      dispatch({ type: 'step', total });
    }
  };

  const current = ordered[state.index - 1];
  const visible = ordered.slice(0, state.index);
  const atEnd = total > 0 && state.index === total;

  return (
    <div ref={containerRef} data-testid="replay-root" tabIndex={0} onKeyDown={onKeyDown}>
      <div role="group" aria-label="Trace replay controls" className="replay__controls">
        <button type="button" onClick={toggle}>
          {state.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'step', total })}>
          Step
        </button>
        <button type="button" onClick={() => dispatch({ type: 'restart' })}>
          Restart
        </button>
        <label>
          Speed{' '}
          <select
            data-testid="replay-speed"
            value={state.speed}
            onChange={(event) =>
              dispatch({ type: 'setSpeed', speed: Number(event.target.value) as ReplaySpeed })
            }
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        <span data-testid="replay-position">
          Step {state.index} of {total}
        </span>
      </div>
      {current && (
        <p data-testid="replay-current">
          <strong>{describeStep(current).actorLabel}</strong> {describeStep(current).title}
          {evidenceStepIds.includes(current.id) ? ' · evidence' : ''}
        </p>
      )}
      <TraceTimeline steps={visible} evidenceStepIds={evidenceStepIds} />
      {atEnd && (
        <p data-testid="replay-verdict">
          <strong>Verdict:</strong> {verdict}
        </p>
      )}
    </div>
  );
}
