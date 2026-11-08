import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RunEvent } from '@payclinic/contracts';
import { useRun } from '../api/hooks';
import { useRunEvents, type RunEventSourceCtor } from '../api/useRunEvents';
import { api, type ApiClient } from '../api/client';
import { AgentRunSection } from './AgentRunSection';
import { FindingsGrid } from '../components/FindingsGrid';
import { RunProgress } from '../components/RunProgress';
import { ScoreGauge } from '../components/ScoreGauge';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { Spinner } from '../components/ui/Spinner';

export interface RunPageProps {
  client?: Pick<ApiClient, 'getRun' | 'prescribe'> &
    Partial<Pick<ApiClient, 'protect' | 'getPolicy' | 'getDecisions'>>;
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
  const [watching, setWatching] = useState(false);

  const runDone = events.some((e) => e.type === 'run.completed' || e.type === 'run.failed');
  const status = data?.run.status;
  useEffect(() => {
    if (runDone && (status === 'queued' || status === 'running')) reload();
  }, [runDone, status, reload]);

  const openFindings = (data?.findings ?? []).filter((finding) => finding.state === 'open');

  useEffect(() => {
    if (!watching) return;
    if (openFindings.length === 0) {
      setWatching(false);
      return;
    }
    const t = setInterval(reload, 2000);
    const stop = setTimeout(() => setWatching(false), 180_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [watching, openFindings.length, reload]);

  const fixAll = useCallback(async () => {
    if (fixing) return;
    setFixing(true);
    setFixError(null);
    try {
      // Note: prescribe returns 202 Accepted immediately.
      // If ordering matters for patching the same store, queue them in the orchestrator,
      // or wait for each finding to leave the open state before starting the next.
      for (const finding of openFindings) {
        await clientRef.current.prescribe(finding.id);
      }
      setWatching(true);
      reload();
    } catch (reason: unknown) {
      setFixError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFixing(false);
    }
  }, [fixing, openFindings, reload]);

  if (loading && !data) return <Spinner label="Loading run..." />;
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
        {data.run.status === 'completed' ? (
          <ScoreGauge
            score={live ?? data.score.score}
            scoreBefore={data.run.scoreBefore}
            scoreAfter={
              data.run.scoreAfter ??
              (live !== null && live !== data.run.scoreBefore ? live : undefined)
            }
          />
        ) : data.run.status === 'failed' ? (
          <ErrorState
            message={`Run failed: ${data.run.error ?? 'unknown error'}`}
            onRetry={reload}
          />
        ) : (
          <p className="run-page__running">
            <Spinner label="Running scenarios…" />
          </p>
        )}
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
      {data.run.target === 'agent' && (
        <AgentRunSection
          runId={data.run.id}
          findings={data.findings}
          reload={reload}
          client={client}
          eventSourceCtor={eventSourceCtor}
        />
      )}
    </section>
  );
}
