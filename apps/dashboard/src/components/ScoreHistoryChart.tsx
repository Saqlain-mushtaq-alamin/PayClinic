import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { RunSummary } from '@payclinic/contracts';

export type TimeRange = '7d' | '30d' | 'all';

export interface ScoreHistoryChartProps {
  runs: RunSummary[];
}

interface TooltipPayloadItem {
  payload: {
    id: string;
    shortId: string;
    score: number;
    date: string;
    fullDate: string;
  };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="chart-tooltip" data-testid="chart-tooltip">
      <div className="chart-tooltip__row">
        <span className="chart-tooltip__id">Run {item.shortId}</span>
        <span className="chart-tooltip__date">{item.date}</span>
      </div>
      <div className="chart-tooltip__score">
        Safety score: <strong style={{ color: '#22c37a' }}>{item.score}</strong>/100
      </div>
    </div>
  );
}

export function ScoreHistoryChart({ runs }: ScoreHistoryChartProps) {
  const [range, setRange] = useState<TimeRange>('all');

  const filteredData = useMemo(() => {
    const now = Date.now();
    const cutoff =
      range === '7d'
        ? now - 7 * 24 * 3600 * 1000
        : range === '30d'
          ? now - 30 * 24 * 3600 * 1000
          : 0;

    const filtered = runs
      .filter((r) => {
        if (!cutoff) return true;
        const time = new Date(r.startedAt).getTime();
        return time >= cutoff;
      })
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    const slice = filtered.slice(-10);

    return slice.map((run) => ({
      id: run.id,
      shortId: run.id.length > 8 ? run.id.slice(0, 8) : run.id,
      score: run.score?.score ?? 0,
      date: new Date(run.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      fullDate: new Date(run.startedAt).toLocaleString(),
    }));
  }, [runs, range]);

  return (
    <div className="score-history" data-testid="score-history-card">
      <div className="score-history__header">
        <div>
          <h2>Score history</h2>
          <span className="score-history__subtitle">Last 10 evaluations</span>
        </div>

        <div className="score-history__filter">
          <select
            className="chart-range-select"
            value={range}
            onChange={(e) => setRange(e.target.value as TimeRange)}
            aria-label="Filter time range"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="score-history__chart-container">
        {filteredData.length === 0 ? (
          <div className="score-history__empty">
            <span>No score history available for this range</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={filteredData} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="scoreGlowGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c37a" stopOpacity={0.45} />
                  <stop offset="85%" stopColor="#22c37a" stopOpacity={0.02} />
                  <stop offset="100%" stopColor="#22c37a" stopOpacity={0.0} />
                </linearGradient>

                <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <CartesianGrid stroke="rgba(255, 255, 255, 0.05)" vertical={false} />

              <XAxis
                dataKey="shortId"
                stroke="rgba(255, 255, 255, 0.2)"
                tick={{ fill: '#8b93a1', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255, 255, 255, 0.08)' }}
                tickLine={false}
              />

              <YAxis
                domain={[0, 100]}
                stroke="rgba(255, 255, 255, 0.2)"
                tick={{ fill: '#8b93a1', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255, 255, 255, 0.08)' }}
                tickLine={false}
              />

              <Tooltip content={<CustomTooltip />} />

              <Area
                type="monotone"
                dataKey="score"
                stroke="#22c37a"
                strokeWidth={2.5}
                fill="url(#scoreGlowGradient)"
                filter="url(#lineGlow)"
                activeDot={{
                  r: 6,
                  fill: '#22c37a',
                  stroke: '#191b1f',
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
