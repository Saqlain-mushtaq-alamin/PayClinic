import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, FolderGit2, Sparkles, Store } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { RunEvent } from '@payclinic/contracts';
import { useRun } from '../api/hooks';
import { useLiveRun } from '../api/useLiveRun';
import type { RunEventSourceCtor } from '../api/useRunEvents';
import { api, type ApiClient } from '../api/client';
import { AgentRunSection } from './AgentRunSection';
import { FindingsGrid } from '../components/FindingsGrid';
import { RunProgress } from '../components/RunProgress';
import { SegmentedGauge } from '../components/SegmentedGauge';
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
  const [fixing, setFixing] = useState(false);
  const [fixingIndex, setFixingIndex] = useState<number | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [flashGauge, setFlashGauge] = useState(false);

  const pendingPrescribesRef = useRef<Map<string, () => void>>(new Map());
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStatesRef = useRef<Map<string, string>>(new Map());

  const debouncedReload = useCallback(() => {
    if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
    reloadDebounceRef.current = setTimeout(() => {
      reload();
    }, 300);
  }, [reload]);

  const onLiveEvent = useCallback(
    (event: RunEvent) => {
      // Unblock sequential Fix all when done or failed arrives for a finding
      if (
        event.type === 'prescribe.progress' &&
        (event.stage === 'done' || event.stage === 'failed')
      ) {
        const resolver = pendingPrescribesRef.current.get(event.findingId);
        if (resolver) {
          pendingPrescribesRef.current.delete(event.findingId);
          resolver();
        }
      }

      // Live event driven reload with debounce
      const shouldReload =
        event.type === 'finding.created' ||
        event.type === 'score.updated' ||
        event.type === 'scenario.finished' ||
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        (event.type === 'prescribe.progress' &&
          (event.stage === 'done' || event.stage === 'failed')) ||
        (event.type === 'finding.updated' && event.finding.state === 'protected');

      if (shouldReload) {
        debouncedReload();
      }
    },
    [debouncedReload],
  );

  const { events, connection, lastEventAt } = useLiveRun(id, {
    eventSourceCtor,
    onEvent: onLiveEvent,
  });

  // Detect resolved findings to trigger green flash on the gauge
  useEffect(() => {
    if (!data?.findings) return;
    let hasNewlyResolved = false;
    for (const f of data.findings) {
      const prev = prevStatesRef.current.get(f.id);
      if (prev && prev !== f.state && (f.state === 'verified' || f.state === 'protected')) {
        hasNewlyResolved = true;
        break;
      }
    }
    const nextMap = new Map<string, string>();
    for (const f of data.findings) nextMap.set(f.id, f.state);
    prevStatesRef.current = nextMap;

    if (hasNewlyResolved) {
      setFlashGauge(true);
      const timer = setTimeout(() => setFlashGauge(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [data?.findings]);

  const openFindings = (data?.findings ?? []).filter((finding) => finding.state === 'open');
  const status = data?.run.status;
  const isBusy = status === 'queued' || status === 'running' || fixing;

  // Fallback poll every 5s ONLY while connection !== 'live' and a run/prescribe is in progress
  useEffect(() => {
    if (connection === 'live' || !isBusy) return;
    const timer = setInterval(() => {
      reload();
    }, 5000);
    return () => clearInterval(timer);
  }, [connection, isBusy, reload]);

  const fixAll = useCallback(async () => {
    if (fixing || openFindings.length === 0) return;
    setFixing(true);
    setFixError(null);
    try {
      for (let i = 0; i < openFindings.length; i++) {
        const finding = openFindings[i]!;
        setFixingIndex(i);

        // Optimistically post prescribe
        await clientRef.current.prescribe(finding.id);

        // Truly sequential: wait for prescribe.progress done or failed when SSE stream is active
        if (connection === 'live' || eventSourceCtor) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              pendingPrescribesRef.current.delete(finding.id);
              resolve();
            };
            const timer = setTimeout(done, 120_000);
            pendingPrescribesRef.current.set(finding.id, done);
          });
        }
      }
      reload();
      toast.success('Fix all complete');
    } catch (reason: unknown) {
      const msg = reason instanceof Error ? reason.message : String(reason);
      setFixError(msg);
      toast.error(`Fix all failed: ${msg}`);
    } finally {
      setFixing(false);
      setFixingIndex(null);
      pendingPrescribesRef.current.clear();
    }
  }, [connection, eventSourceCtor, fixing, openFindings, reload]);

  if (loading && !data) return <Spinner label="Loading run..." />;
  if (error)
    return <ErrorState message={`Failed to load run: ${error.message}`} onRetry={reload} />;
  if (!data) return null;

  const live = liveScore(events);
  const currentScore = live ?? data.score.score;
  const scoreBefore = data.run.scoreBefore;
  const scoreAfter =
    data.run.scoreAfter ?? (live !== null && live !== data.run.scoreBefore ? live : undefined);

  const isStore = data.run.target === 'store';

  return (
    <section className="run-page">
      {/* 12-Column Header */}
      <header className="run-header">
        <div className="run-header__nav">
          <Link to="/runs" className="back-link">
            <ArrowLeft size={16} />
            <span>Back to runs</span>
          </Link>
        </div>
        <div className="run-header__main">
          <div className="run-header__left">
            <div className="run-header__title-row">
              <h1 className="run-header__title">Run {data.run.id}</h1>
              <span className="chip chip--project" data-testid="run-project-name">
                <FolderGit2 size={14} />
                <span>
                  {data.run.projectName ??
                    (data.run.projectId && data.run.projectId !== 'builtin'
                      ? data.run.projectId
                      : 'Demo store')}
                </span>
              </span>
              <span className="chip chip--target">
                {isStore ? <Store size={14} /> : <Bot size={14} />}
                <span>{isStore ? 'Store' : 'Agent'}</span>
              </span>
              <Badge tone={statusTone(data.run.status)}>{data.run.status}</Badge>
            </div>
          </div>

          <div className="run-header__actions">
            {isStore && openFindings.length > 0 && (
              <Button
                variant="primary"
                aria-label={
                  fixing && fixingIndex !== null
                    ? `Fixing ${fixingIndex + 1} of ${openFindings.length}…`
                    : 'Fix all'
                }
                onClick={fixAll}
                disabled={fixing}
                className="run-header__fixall-btn"
              >
                <Sparkles size={15} />
                <span>
                  {fixing && fixingIndex !== null
                    ? `Fixing ${fixingIndex + 1} of ${openFindings.length}…`
                    : 'Fix all'}
                </span>
              </Button>
            )}
          </div>
        </div>
        {fixError && (
          <div className="run-header__alert" role="alert">
            {fixError}
          </div>
        )}
      </header>

      {/* Failure Banner if run failed */}
      {data.run.status === 'failed' && (
        <div className="run-page__failure-banner">
          <ErrorState
            message={`Run failed: ${data.run.error ?? 'unknown error'}`}
            onRetry={reload}
          />
        </div>
      )}

      {/* 12-Column Grid */}
      <div className="run-grid">
        {/* Card "Score" (span 4) */}
        <div className="run-grid__col-4">
          <Card className="run-card run-card--score">
            <div className="run-card__header">
              <h3 className="run-card__title">Payment Safety</h3>
            </div>
            <SegmentedGauge
              score={currentScore}
              scoreBefore={scoreBefore}
              scoreAfter={scoreAfter}
              caption="Safety score"
              ariaLabel={`Payment Safety Score ${currentScore} out of 100`}
              flash={flashGauge}
              findingCounts={{
                critical: openFindings.filter((f) => f.severity === 'critical').length,
                high: openFindings.filter((f) => f.severity === 'high').length,
                medium: openFindings.filter((f) => f.severity === 'medium').length,
                low: openFindings.filter((f) => f.severity === 'low').length,
              }}
            />
          </Card>
        </div>

        {/* Card "Live activity" (span 8) */}
        <div className="run-grid__col-8">
          <Card className="run-card run-card--activity">
            <div className="run-card__header">
              <h3 className="run-card__title">Live Activity</h3>
            </div>
            <RunProgress
              events={events}
              isBusy={isBusy}
              lastEventAt={lastEventAt}
              runStatus={data.run.status}
              runStartedAt={data.run.startedAt}
              error={data.run.error}
              newestFirst={true}
            />
          </Card>
        </div>

        {/* Card "Findings" (span 12) */}
        <div className="run-grid__col-12">
          <Card className="run-card run-card--findings">
            <div className="run-card__header">
              <h3 className="run-card__title">Findings ({data.findings.length})</h3>
            </div>
            <FindingsGrid runId={data.run.id} findings={data.findings} />
          </Card>
        </div>

        {/* Agent Run Section (span 12) */}
        {data.run.target === 'agent' && (
          <div className="run-grid__col-12">
            <AgentRunSection
              runId={data.run.id}
              findings={data.findings}
              reload={reload}
              client={client}
              eventSourceCtor={eventSourceCtor}
            />
          </div>
        )}
      </div>
    </section>
  );
}
