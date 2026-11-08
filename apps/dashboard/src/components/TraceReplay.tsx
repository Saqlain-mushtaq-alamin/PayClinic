import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
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
    if (event.target !== event.currentTarget) return;
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
  const progressPercent = total > 0 ? (state.index / total) * 100 : 0;

  return (
    <div
      ref={containerRef}
      data-testid="replay-root"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="replay-root"
    >
      <div className="replay-card">
        <div role="group" aria-label="Trace replay controls" className="replay__controls">
          <div className="replay__btn-group">
            <button
              type="button"
              className={`replay__btn ${state.playing ? 'replay__btn--active' : ''}`}
              onClick={toggle}
              aria-label={state.playing ? 'Pause' : 'Play'}
            >
              {state.playing ? <Pause size={14} /> : <Play size={14} />}
              <span>{state.playing ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              className="replay__btn"
              onClick={() => dispatch({ type: 'step', total })}
              aria-label="Step"
            >
              <SkipForward size={14} />
              <span>Step</span>
            </button>
            <button
              type="button"
              className="replay__btn"
              onClick={() => dispatch({ type: 'restart' })}
              aria-label="Restart"
            >
              <RotateCcw size={14} />
              <span>Restart</span>
            </button>
          </div>

          <div className="replay__speed-group">
            <label className="replay__speed-label">
              <span>Speed</span>
              <select
                data-testid="replay-speed"
                value={state.speed}
                className="replay__speed-select"
                onChange={(event) =>
                  dispatch({ type: 'setSpeed', speed: Number(event.target.value) as ReplaySpeed })
                }
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </label>
            <span data-testid="replay-position" className="replay__position chip badge--neutral">
              Step {state.index} of {total}
            </span>
          </div>
        </div>

        {/* Thin progress bar */}
        <div className="replay-progress-track">
          <div className="replay-progress-bar" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {current && (
        <div data-testid="replay-current" className="replay-current-banner">
          <span className="replay-current-actor">{describeStep(current).actorLabel}</span>
          <span className="replay-current-title">{describeStep(current).title}</span>
          {evidenceStepIds.includes(current.id) && (
            <span className="chip badge--critical">evidence</span>
          )}
        </div>
      )}

      <TraceTimeline steps={visible} evidenceStepIds={evidenceStepIds} />

      {atEnd && (
        <div data-testid="replay-verdict" className="replay-verdict-banner">
          <span className="replay-verdict-badge">Verdict</span>
          <span className="replay-verdict-text">{verdict}</span>
        </div>
      )}
    </div>
  );
}
