import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { FindingDetail, RunDetail } from '@payclinic/contracts';
import { api, type ApiClient } from '../api/client';
import { usePrescribe } from '../api/usePrescribe';
import type { RunEventSourceCtor } from '../api/useRunEvents';
import { ExplanationPanel } from '../components/ExplanationPanel';
import { OpenPrButton } from '../components/OpenPrButton';
import { PrescribeButton } from '../components/PrescribeButton';
import { PrescribeStepper } from '../components/PrescribeStepper';
import { TraceReplay } from '../components/TraceReplay';
import { UnifiedDiff } from '../components/UnifiedDiff';
import { VerifyBadge } from '../components/VerifyBadge';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { Spinner } from '../components/ui/Spinner';

export interface FindingPageProps {
  client?: Pick<ApiClient, 'getFinding' | 'getRun' | 'prescribe'> &
    Partial<Pick<ApiClient, 'openPr'>>;
  eventSourceCtor?: RunEventSourceCtor;
}

function severityTone(severity: string): BadgeTone {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    default:
      return 'low';
  }
}

function stateTone(state: string): BadgeTone {
  switch (state) {
    case 'verified':
    case 'protected':
      return 'ok';
    case 'patched':
    case 'unverified':
      return 'medium';
    default:
      return 'neutral';
  }
}

export function FindingPage({ client: injectedClient, eventSourceCtor }: FindingPageProps) {
  const client = injectedClient ?? api;
  const clientRef = useRef(client);
  clientRef.current = client;
  const [detail, setDetail] = useState<FindingDetail | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const { fid = '' } = useParams();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    clientRef.current
      .getFinding(fid)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setDetail(null);
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fid, tick]);

  // The run score is auxiliary context here; a failed fetch keeps the
  // previous value instead of replacing the page with an error.
  useEffect(() => {
    if (!detail) return;
    let active = true;
    clientRef.current
      .getRun(detail.finding.runId)
      .then((run) => {
        if (active) setRunDetail(run);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [detail]);

  const prescribe = usePrescribe(detail?.finding.id ?? '', detail?.finding.runId ?? '', {
    client,
    eventSourceCtor,
  });

  useEffect(() => {
    if (prescribe.stage === 'done') {
      toast.success('Prescription verified and patch ready');
      reload();
    } else if (prescribe.stage === 'failed') {
      toast.error(prescribe.message ?? 'Prescribe failed');
    }
  }, [prescribe.stage, prescribe.message, reload]);

  if (loading && !detail) return <Spinner label="Loading finding..." />;
  if (error)
    return <ErrorState message={`Failed to load finding: ${error.message}`} onRetry={reload} />;
  if (!detail) return null;

  return (
    <section className="finding-page" data-testid="finding-page">
      <Link to={`/runs/${detail.finding.runId}`}>← Back to run</Link>
      <header className="page-header">
        <h1>{detail.finding.title}</h1>
        <Badge tone={severityTone(detail.finding.severity)}>{detail.finding.severity}</Badge>
        <Badge tone={stateTone(detail.finding.state)}>{detail.finding.state}</Badge>
        <VerifyBadge verify={detail.verify} />
      </header>
      <Card className="finding-summary">
        <p>{detail.finding.summary}</p>
        {runDetail && <p className="finding-summary__score">Run score: {runDetail.score.score}</p>}
      </Card>
      {detail.finding.state !== 'verified' && detail.finding.state !== 'protected' && (
        <Card>
          <PrescribeButton
            stage={prescribe.stage}
            message={prescribe.message}
            onStart={prescribe.start}
          />
          {prescribe.stage !== 'idle' && <PrescribeStepper stage={prescribe.stage} />}
        </Card>
      )}
      {detail.finding.state === 'verified' && (
        <Card>
          <OpenPrButton
            findingId={detail.finding.id}
            client={client.openPr ? (client as Pick<ApiClient, 'openPr'>) : undefined}
          />
        </Card>
      )}
      {detail.explanation && (
        <Card>
          <ExplanationPanel explanation={detail.explanation} />
        </Card>
      )}
      {detail.patch && (
        <Card>
          <h2>Proposed patch</h2>
          <UnifiedDiff diff={detail.patch.diff} />
        </Card>
      )}
      <Card>
        <h2>Trace replay</h2>
        <TraceReplay
          steps={detail.steps}
          evidenceStepIds={detail.finding.evidenceStepIds}
          verdict={detail.finding.summary}
        />
      </Card>
    </section>
  );
}
