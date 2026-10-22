import { useParams } from 'react-router-dom';
import { useRun } from '../api/hooks';
import type { ApiClient } from '../api/client';
import { FindingsGrid } from '../components/FindingsGrid';
import { ScoreGauge } from '../components/ScoreGauge';

export interface RunPageProps {
  client?: Pick<ApiClient, 'getRun'>;
}

export function RunPage({ client }: RunPageProps) {
  const { id = '' } = useParams();
  const { data, error, loading } = useRun(id, client);

  if (loading) return <p>Loading run...</p>;
  if (error) return <p role="alert">Failed to load run: {error.message}</p>;
  if (!data) return null;

  return (
    <section>
      <header>
        <h1>Run {data.run.id}</h1>
        <p>{data.run.status}</p>
      </header>
      <ScoreGauge
        score={data.score.score}
        scoreBefore={data.run.scoreBefore}
        scoreAfter={data.run.scoreAfter}
      />
      <FindingsGrid runId={data.run.id} findings={data.findings} />
    </section>
  );
}
