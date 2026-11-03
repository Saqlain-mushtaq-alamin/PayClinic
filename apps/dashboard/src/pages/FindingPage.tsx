import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { FindingDetail } from '@payclinic/contracts';
import { api, type ApiClient } from '../api/client';
import { ExplanationPanel } from '../components/ExplanationPanel';
import { TraceTimeline } from '../components/TraceTimeline';
import { UnifiedDiff } from '../components/UnifiedDiff';
import { VerifyBadge } from '../components/VerifyBadge';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { ErrorState } from '../components/ui/ErrorState';
import { Spinner } from '../components/ui/Spinner';

export interface FindingPageProps {
  client?: Pick<ApiClient, 'getFinding'>;
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
      return 'medium';
    case 'unverified':
      return 'medium';
    default:
      return 'neutral';
  }
}

export function FindingPage({ client: injectedClient }: FindingPageProps) {
  const client = injectedClient ?? api;
  const clientRef = useRef(client);
  clientRef.current = client;
  const [detail, setDetail] = useState<FindingDetail | null>(null);
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

  if (loading) return <Spinner label="Loading finding..." />;
  if (error)
    return <ErrorState message={`Failed to load finding: ${error.message}`} onRetry={reload} />;
  if (!detail) return null;

  return (
    <section className="finding-page" data-testid="finding-page">
      <header className="page-header">
        <h1>{detail.finding.title}</h1>
        <Badge tone={severityTone(detail.finding.severity)}>{detail.finding.severity}</Badge>
        <Badge tone={stateTone(detail.finding.state)}>{detail.finding.state}</Badge>
      </header>
      <Card className="finding-summary">
        <p>{detail.finding.summary}</p>
      </Card>
      <Card>
        <TraceTimeline steps={detail.steps} evidenceStepIds={detail.finding.evidenceStepIds} />
      </Card>
      {detail.explanation && (
        <Card className="explanation">
          <ExplanationPanel explanation={detail.explanation} />
        </Card>
      )}
      {detail.patch && (
        <Card className="patch">
          <UnifiedDiff diff={detail.patch.diff} />
        </Card>
      )}
      <Card>
        <VerifyBadge verify={detail.verify} />
      </Card>
    </section>
  );
}
