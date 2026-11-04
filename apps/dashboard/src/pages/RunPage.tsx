import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RunEvent } from '@payclinic/contracts';
import { useRun } from '../api/hooks';
import { useRunEvents, type RunEventSourceCtor } from '../api/useRunEvents';
import { api, type ApiClient } from '../api/client';
import { FindingsGrid } from '../components/FindingsGrid';
import { RunProgress } from '../components/RunProgress';
import { ScoreGauge } from '../components/ScoreGauge';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { Spinner } from '../components/ui/Spinner';

export interface RunPageProps {
  client?: Pick<ApiClient, 'getRun' | 'prescribe'>;
  eventSourceCtor?: RunEventSourceCtor;
}

function statusTone(status: string): BadgeTone {
  if (status === 'failed') return 'critical';
  if (status === 'completed') return 'ok';
  if (status === 'running') return 'medium';
  return 'neutral';
}

/** Last score carried by a `score.updated` event, or null before the first one. */
function liveScore(events: RunEvent[]): number | null {
  let score: number | null = null;
  for (const event of events) {
    if (event.type === 'score.updated') score = event.score.score;
  }
  return score;
}

export function RunPage({ client: injectedClient, eventSourceCtor }: RunPageProps) {
  const client = injectedClient ?? api;
  const clientRef = useRef(client);
  clientRef.current = client;
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useRun(id, client);
  const { events } = useRunEvents(id, { eventSourceCtor });
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  const runCompleted = events.some((event) => event.type === 'run.completed');
  useEffect(() => {
    // A live run gains its findings as it completes; refetch once so the grid,
    // the score and Fix all see them. Replays of completed runs skip this.
    if (runCompleted && data?.run.status === 'running') reload();
  }, [runCompleted, data?.run.status, reload]);

  const openFindings = (data?.findings ?? []).filter((finding) => finding.state === 'open');

  const fixAll = useCallback(async () => {
    if (fixing) return;
    setFixing(true);
    setFixError(null);
    try {
      // One prescribe at a time so the store is patched and verified in order.
      for (const finding of openFindings) {
        await clientRef.current.prescribe(finding.id);
      }
      reload();
    } catch (reason: unknown) {
      setFixError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFixing(false);
    }
  }, [fixing, openFindings, reload]);

  if (loading) return <Spinner label="Loading run..." />;
  if (error)
    return <ErrorState message={`Failed to load run: ${error.message}`} onRetry={reload} />;
  if (!data) return null;

  const live = liveScore(events);

  return (
    <section className="run-page">
      <header className="page-header">
        <h1>Run {data.run.id}</h1>
        <Badge tone={statusTone(data.run.status)}>{data.run.status}</Badge>
      </header>
      <div className="run-page__summary">
        <ScoreGauge
          score={live ?? data.score.score}
          scoreBefore={data.run.scoreBefore}
          scoreAfter={live ?? data.run.scoreAfter}
        />
        {openFindings.length > 0 && (
          <div className="run-page__fixall">
            <Button onClick={fixAll} disabled={fixing}>
              {fixing ? 'Fixing…' : 'Fix all'}
            </Button>
            {fixError && <p role="alert">{fixError}</p>}
          </div>
        )}
      </div>
      <Card>
        <RunProgress events={events} />
      </Card>
      <Card>
        <FindingsGrid runId={data.run.id} findings={data.findings} />
      </Card>
    </section>
  );
}
