export interface FindingCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface SegmentedGaugeProps {
  score: number;
  caption?: string;
  findingCounts?: Partial<FindingCounts>;
  totalSegments?: number;
}

export function getScoreTone(score: number): 'ok' | 'warn' | 'bad' {
  if (score >= 80) return 'ok';
  if (score >= 50) return 'warn';
  return 'bad';
}

export function getScoreColor(score: number): string {
  if (score >= 80) return '#22c37a';
  if (score >= 50) return '#f2b04a';
  return '#ef5b52';
}

export function SegmentedGauge({
  score,
  caption = 'Latest run',
  findingCounts,
  totalSegments = 12,
}: SegmentedGaugeProps) {
  const scoreTone = getScoreTone(score);
  const activeColor = getScoreColor(score);
  const dimColor = 'rgba(255, 255, 255, 0.08)';

  const filledCount = Math.min(
    totalSegments,
    Math.max(0, Math.round((score / 100) * totalSegments)),
  );

  // SVG Geometry
  const cx = 120;
  const cy = 125;
  const r = 92;
  const strokeWidth = 11;

  // Arc configuration: 180 degrees semi-circle with gaps
  const totalArc = 180;
  const gap = 4.5;
  const activeAngle = totalArc - (totalSegments - 1) * gap;
  const segmentSpan = activeAngle / totalSegments;

  const segments = Array.from({ length: totalSegments }, (_, i) => {
    const isFilled = i < filledCount;
    const startAngle = 180 - i * (segmentSpan + gap);
    const endAngle = startAngle - segmentSpan;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy - r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy - r * Math.sin(endRad);

    const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;

    return {
      index: i,
      d,
      isFilled,
      delay: i * 40,
    };
  });

  const counts: FindingCounts = {
    critical: findingCounts?.critical ?? 0,
    high: findingCounts?.high ?? 0,
    medium: findingCounts?.medium ?? 0,
    low: findingCounts?.low ?? 0,
  };

  return (
    <div
      className={`segmented-gauge segmented-gauge--${scoreTone}`}
      data-testid="segmented-gauge"
      role="img"
      aria-label={`Payment safety score ${score} out of 100`}
    >
      <div className="segmented-gauge__arc-wrapper">
        <svg
          viewBox="0 0 240 145"
          className="segmented-gauge__svg"
          aria-hidden="true"
        >
          {segments.map((seg) => (
            <path
              key={seg.index}
              d={seg.d}
              fill="none"
              stroke={seg.isFilled ? activeColor : dimColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              className={`segmented-gauge__segment ${seg.isFilled ? 'segmented-gauge__segment--filled' : ''}`}
              style={{
                animationDelay: `${seg.delay}ms`,
                filter: seg.isFilled ? `drop-shadow(0 0 6px ${activeColor}55)` : undefined,
              }}
            />
          ))}

          <text x={cx} y={cy - 20} textAnchor="middle" className="segmented-gauge__score-value">
            {score}
          </text>
          <text x={cx} y={cy} textAnchor="middle" className="segmented-gauge__score-caption">
            {caption}
          </text>
        </svg>
      </div>

      <div className="segmented-gauge__legend" aria-label="Unresolved findings by severity">
        <span className="chip badge--critical" title={`${counts.critical} critical findings`}>
          <strong>{counts.critical}</strong> Critical
        </span>
        <span className="chip badge--high" title={`${counts.high} high findings`}>
          <strong>{counts.high}</strong> High
        </span>
        <span className="chip badge--medium" title={`${counts.medium} medium findings`}>
          <strong>{counts.medium}</strong> Medium
        </span>
        <span className="chip badge--low" title={`${counts.low} low findings`}>
          <strong>{counts.low}</strong> Low
        </span>
      </div>
    </div>
  );
}

