import { Link } from 'react-router-dom';
import { useRuns } from '../api/hooks';
import type { ApiClient } from '../api/client';

export interface RunsPageProps {
  client?: Pick<ApiClient, 'listRuns'>;
}

export function RunsPage({ client }: RunsPageProps) {
  const { data, error, loading, reload } = useRuns(client);

  if (loading) return <p>Loading runs...</p>;
  if (error) {
    return (
      <div role="alert">
        <p>Failed to load runs: {error.message}</p>
        <button type="button" onClick={reload}>
          Retry
        </button>
      </div>
    );
  }
  if (!data || data.length === 0) return <p>No runs yet</p>;

  return (
    <table>
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
            <td>{run.status}</td>
            <td>{run.score ? run.score.score : '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
