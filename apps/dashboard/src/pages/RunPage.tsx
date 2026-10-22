import { useParams } from 'react-router-dom';
import { useRun } from '../api/hooks';
import type { ApiClient } from '../api/client';
import { FindingsGrid } from '../components/FindingsGrid';
import { ScoreGauge } from '../components/ScoreGauge';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { Spinner } from '../components/ui/Spinner';

export interface RunPageProps {
  client?: Pick<ApiClient, 'getRun'>;
}

function statusTone(status: string): BadgeTone {
  if (status === 'failed') return 'critical';
  if (status === 'completed') return 'ok';
  if (status === 'running') return 'medium';
  return 'neutral';
}

export function RunPage({ client }: RunPageProps) {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useRun(id, client);

  if (loading) return <Spinner label="Loading run..." />;
  if (error)
    return <ErrorState message={`Failed to load run: ${error.message}`} onRetry={reload} />;
  if (!data) return null;

  return (
    <section className="run-page">
      <header className="page-header">
        <h1>Run {data.run.id}</h1>
        <Badge tone={statusTone(data.run.status)}>{data.run.status}</Badge>
      </header>
      <div className="run-page__summary">
        <ScoreGauge
          score={data.score.score}
          scoreBefore={data.run.scoreBefore}
          scoreAfter={data.run.scoreAfter}
        />
      </div>
      <Card>
        <FindingsGrid runId={data.run.id} findings={data.findings} />
      </Card>
    </section>
  );
}
