export interface ScoreGaugeProps {
  score: number;
  scoreBefore?: number;
  scoreAfter?: number;
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreGauge({ score, scoreBefore, scoreAfter }: ScoreGaugeProps) {
  const showChange = scoreBefore !== undefined && scoreAfter !== undefined;
  const safeScore = Math.max(0, Math.min(100, score));
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
          {score}
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
