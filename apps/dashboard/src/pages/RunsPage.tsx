import { Link } from 'react-router-dom';
import { useRuns } from '../api/hooks';
import type { ApiClient } from '../api/client';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Spinner } from '../components/ui/Spinner';
import { StartRunPanel } from '../components/StartRunPanel';

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

export function RunsPage({ client }: RunsPageProps) {
  const { data, error, loading, reload } = useRuns(client);

  const sorted = data ? [...data].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) : [];

  return (
    <section className="runs-page">
      <header className="page-header">
        <h1>Runs</h1>
      </header>
      <StartRunPanel client={client} />
      {loading ? (
        <Spinner label="Loading runs..." />
      ) : error ? (
        <ErrorState message={`Failed to load runs: ${error.message}`} onRetry={reload} />
      ) : sorted.length > 0 ? (
        <Card>
          <table className="runs-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Started</th>
                <th>Target</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Score</th>
                <th>Scenarios</th>
                <th>Findings</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link to={`/runs/${run.id}`}>
                      {run.id.length > 12 ? run.id.slice(0, 8) : run.id}
                    </Link>
                  </td>
                  <td>{new Date(run.startedAt).toLocaleString()}</td>
                  <td>{run.target}</td>
                  <td>{run.mode}</td>
                  <td>
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                  </td>
                  <td>{run.score ? <strong>{run.score.score}</strong> : '-'}</td>
                  <td>{run.scenarioKeys.join(', ')}</td>
                  <td>{run.findingCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState message="No runs yet" />
      )}
    </section>
  );
}
