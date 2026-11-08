import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bot,
  FolderLock,
  MoreVertical,
  Search,
  Store,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useRuns } from '../api/hooks';
import type { ApiClient } from '../api/client';
import { useDashboard } from '../context/DashboardContext';
import { SegmentedGauge } from '../components/SegmentedGauge';
import { ScoreHistoryChart } from '../components/ScoreHistoryChart';
import { StartRunPanel } from '../components/StartRunPanel';
import type { BadgeTone } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';

export type RunsPageClient = Pick<ApiClient, 'listRuns' | 'health' | 'getScenarios' | 'createRun'>;

export interface RunsPageProps {
  client?: RunsPageClient;
}

function statusTone(status: string): BadgeTone {
  if (status === 'failed') return 'critical';
  if (status === 'completed') return 'ok';
  if (status === 'running') return 'medium';
  return 'neutral';
}

function scoreTone(score: number): BadgeTone {
  if (score >= 80) return 'ok';
  if (score >= 50) return 'high';
  return 'critical';
}

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDays = Math.floor(diffHour / 24);
    return `${diffDays}d ago`;
  } catch {
    return isoString;
  }
}

export function RunsPage({ client }: RunsPageProps) {
  const { data, error, loading, reload } = useRuns(client);
  const { searchQuery, setSearchQuery } = useDashboard();
  const navigate = useNavigate();

  const sorted = useMemo(() => {
    return data ? [...data].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) : [];
  }, [data]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.target.toLowerCase().includes(q) ||
        r.scenarioKeys.some((k) => k.toLowerCase().includes(q)),
    );
  }, [sorted, searchQuery]);

  // Find latest run with score
  const latestCompletedRun = useMemo(() => {
    return sorted.find((r) => r.status === 'completed' && r.score !== undefined);
  }, [sorted]);

  const latestScore = latestCompletedRun?.score?.score ?? sorted[0]?.score?.score ?? 0;

  const findingCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    if (latestCompletedRun?.score?.penalties) {
      for (const p of latestCompletedRun.score.penalties) {
        if (p.severity in counts) {
          counts[p.severity as keyof typeof counts] += 1;
        }
      }
    }
    return counts;
  }, [latestCompletedRun]);

  return (
    <section className="runs-page" data-testid="runs-page">
      {/* 20% / 80% Layout:
          Left (20%): Payment Safety (top) + Ready to scan / Diagnose (below)
          Right (80%): Score History (top) + Recent Runs (below) */}
      <div className="runs-page__columns">
        {/* Left Column (20%) */}
        <div className="runs-page__column-side">
          {/* Top of Left: Payment Safety */}
          <Card className="runs-card runs-card--safety">
            <div className="runs-card__header">
              <h2>Payment Safety</h2>
              <span className="runs-card__subtitle">Latest safety score</span>
            </div>
            <SegmentedGauge
              score={latestScore}
              caption={
                latestCompletedRun ? `Run ${latestCompletedRun.id.slice(0, 8)}` : 'Latest run'
              }
              findingCounts={findingCounts}
            />
          </Card>

          {/* Below of Left: Ready to scan (Diagnose) */}
          <div className="runs-page__col--diagnose">
            <StartRunPanel client={client} />
          </div>
        </div>

        {/* Right Column (80%) */}
        <div className="runs-page__column-main">
          {/* Top of Right: Score History */}
          <Card className="runs-card runs-card--history">
            <ScoreHistoryChart runs={sorted} />
          </Card>

          {/* Below of Right: Recent Runs */}
          <Card className="runs-card runs-card--recent">
            <div className="runs-card__header runs-card__header--recent">
              <div>
                <h2>Recent runs</h2>
                <span className="runs-card__subtitle">
                  {sorted.length > 0
                    ? `Showing ${filtered.length} ${filtered.length === 1 ? 'evaluation' : 'evaluations'}`
                    : 'Evaluation activity'}
                </span>
              </div>

              {/* Search bar on top of recent runs */}
              <div className="recent-runs__search">
                <Search size={15} className="recent-runs__search-icon" aria-hidden="true" />
                <input
                  type="text"
                  data-testid="search-input"
                  className="recent-runs__search-input"
                  placeholder="Search runs, findings, traces…"
                  aria-label="Search runs, findings, traces"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {loading ? (
              /* Skeleton shimmer loading state */
              <div className="runs-table__skeleton-container" data-testid="runs-skeleton">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="runs-table__skeleton-row shimmer" />
                ))}
              </div>
            ) : error ? (
              <ErrorState message={`Failed to load runs: ${error.message}`} onRetry={reload} />
            ) : filtered.length > 0 ? (
              <div className="runs-table-scrollable">
                <table className="runs-table runs-table--transactions">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Started</th>
                      <th>Target</th>
                      <th>Mode</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((run, index) => {
                      const scoreVal = run.score?.score;
                      const delta =
                        run.scoreBefore !== undefined && run.scoreAfter !== undefined
                          ? run.scoreAfter - run.scoreBefore
                          : 0;

                      return (
                        <tr
                          key={run.id}
                          className="runs-table__row"
                          style={{ animationDelay: `${index * 35}ms` }}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') navigate(`/runs/${run.id}`);
                          }}
                        >
                          <td>
                            <div className="runs-table__run-cell">
                              <div className="runs-table__icon-tile">
                                {run.target === 'agent' ? (
                                  <Bot size={18} className="runs-table__target-icon" />
                                ) : (
                                  <Store size={18} className="runs-table__target-icon" />
                                )}
                              </div>
                              <div className="runs-table__run-info">
                                <Link to={`/runs/${run.id}`} className="runs-table__run-id">
                                  {run.id}
                                </Link>
                                <span className="runs-table__subtitle-keys">
                                  {run.scenarioKeys.join(', ')}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td>
                            <span
                              className="runs-table__time"
                              title={new Date(run.startedAt).toLocaleString()}
                            >
                              {formatRelativeTime(run.startedAt)}
                            </span>
                          </td>

                          <td>
                            <span className="runs-table__target-label">{run.target}</span>
                          </td>

                          <td>
                            <span className="runs-table__mode-label">{run.mode}</span>
                          </td>

                          <td>
                            <span className={`badge badge--${statusTone(run.status)}`}>
                              {run.status === 'running' && (
                                <span className="pulse-dot pulse-dot--live" />
                              )}
                              {run.status}
                            </span>
                          </td>

                          <td>
                            {scoreVal !== undefined ? (
                              <div className="runs-table__score-cell">
                                <span className={`chip badge--${scoreTone(scoreVal)}`}>
                                  <strong>{scoreVal}</strong>
                                </span>
                                {delta > 0 && (
                                  <span className="score-trend score-trend--up" title={`+${delta}`}>
                                    <TrendingUp size={12} />
                                  </span>
                                )}
                                {delta < 0 && (
                                  <span
                                    className="score-trend score-trend--down"
                                    title={`${delta}`}
                                  >
                                    <TrendingDown size={12} />
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="runs-table__score-empty">-</span>
                            )}
                          </td>

                          <td>
                            <button
                              type="button"
                              className="runs-table__kebab"
                              aria-label={`Actions for run ${run.id}`}
                              title="Actions"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/runs/${run.id}`);
                              }}
                            >
                              <MoreVertical size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Empty state with illustration & diagnosis shortcut button */
              <div className="runs-empty-state" data-testid="runs-empty-state">
                <div className="runs-empty-state__icon-wrap">
                  <FolderLock size={44} strokeWidth={1.5} />
                </div>
                <h3>No runs yet</h3>
                <p>Start your first payment safety diagnosis to scan scenarios and detect bugs.</p>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    const el = document.getElementById('diagnose-card');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Start your first diagnosis
                </button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}
