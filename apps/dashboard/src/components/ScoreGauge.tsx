export interface ScoreGaugeProps {
  score: number;
  scoreBefore?: number;
  scoreAfter?: number;
}

export function ScoreGauge({ score, scoreBefore, scoreAfter }: ScoreGaugeProps) {
  const showChange = scoreBefore !== undefined && scoreAfter !== undefined;
  return (
    <div className="score-gauge" data-testid="score-gauge">
      <span className="score-gauge__value">{score}</span>
      {showChange && (
        <span className="score-gauge__change">
          {scoreBefore} &rarr; {scoreAfter}
        </span>
      )}
    </div>
  );
}
