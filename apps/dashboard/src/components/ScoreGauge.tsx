import { useEffect, useRef, useState } from 'react';

export interface ScoreGaugeProps {
  score: number;
  scoreBefore?: number;
  scoreAfter?: number;
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ANIMATION_MS = 600;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function ScoreGauge({ score, scoreBefore, scoreAfter }: ScoreGaugeProps) {
  const [displayed, setDisplayed] = useState(score);
  const previousRef = useRef(score);

  useEffect(() => {
    const from = previousRef.current;
    if (from === score) return;
    previousRef.current = score;

    // Without rAF (or when the user prefers reduced motion) jump straight to
    // the new value; the accessible label always carries the final score.
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') {
      setDisplayed(score);
      return;
    }

    let startedAt: number | null = null;
    let frame = 0;
    const tick = (now: number) => {
      // Anchor on the rAF clock itself: its timestamps are not guaranteed to
      // share an origin with performance.now() (jsdom differs).
      if (startedAt === null) startedAt = now;
      const progress = Math.min(1, (now - startedAt) / ANIMATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(from + (score - from) * eased));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [score]);

  const showChange = scoreBefore !== undefined && scoreAfter !== undefined;
  const safeScore = Math.max(0, Math.min(100, displayed));
  const offset = CIRCUMFERENCE * (1 - safeScore / 100);

  return (
    <div className="score-gauge" data-testid="score-gauge">
      <svg
        className="score-gauge__ring"
        viewBox="0 0 120 120"
        role="img"
        aria-label={`Payment Safety Score ${score} out of 100`}
      >
        <circle className="score-gauge__track" cx="60" cy="60" r={RADIUS} />
        <circle
          className="score-gauge__progress"
          cx="60"
          cy="60"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
        />
        <text
          className="score-gauge__value"
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="central"
        >
          {displayed}
        </text>
      </svg>
      {showChange && (
        <span className="score-gauge__change">
          {scoreBefore} &rarr; {scoreAfter}
        </span>
      )}
    </div>
  );
}
