import { Link } from 'react-router-dom';
import { useRuns } from '../api/hooks';
import type { ApiClient } from '../api/client';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Spinner } from '../components/ui/Spinner';

export interface RunsPageProps {
  client?: Pick<ApiClient, 'listRuns'>;
}

function statusTone(status: string): BadgeTone {
  if (status === 'failed') return 'critical';
  if (status === 'completed') return 'ok';
  if (status === 'running') return 'medium';
  return 'neutral';
}

export function RunsPage({ client }: RunsPageProps) {
  const { data, error, loading, reload } = useRuns(client);

  if (loading) return <Spinner label="Loading runs..." />;
  if (error)
    return <ErrorState message={`Failed to load runs: ${error.message}`} onRetry={reload} />;
  if (!data || data.length === 0) return <EmptyState message="No runs yet" />;

  return (
    <section className="runs-page">
      <header className="page-header">
        <h1>Runs</h1>
      </header>
      <Card>
        <table className="runs-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Target</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {data.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/runs/${run.id}`}>{run.id}</Link>
                </td>
                <td>{run.target}</td>
                <td>{run.mode}</td>
                <td>
                  <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                </td>
                <td>{run.score ? <strong>{run.score.score}</strong> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
