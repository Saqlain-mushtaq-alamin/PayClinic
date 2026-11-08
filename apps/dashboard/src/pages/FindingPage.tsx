import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
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

function stateLabel(state: string): string {
  if (state === 'patched') return 'Needs review';
  return state;
}

export function FindingPage({ client: injectedClient, eventSourceCtor }: FindingPageProps) {
  const client = injectedClient ?? api;
  const clientRef = useRef(client);
  clientRef.current = client;
  const [detail, setDetail] = useState<FindingDetail | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [prUrl, setPrUrl] = useState<string | null>(null);
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
      {/* Sticky Header */}
      <header className="finding-header sticky-header">
        <div className="finding-header__nav">
          <Link to={`/runs/${detail.finding.runId}`} className="back-link">
            <ArrowLeft size={16} />
            <span>← Back to run</span>
          </Link>
        </div>
        <div className="finding-header__main">
          <div className="finding-header__title-row">
            <h1 className="finding-header__title">{detail.finding.title}</h1>
            <div className="finding-header__badges">
              <Badge tone={severityTone(detail.finding.severity)}>{detail.finding.severity}</Badge>
              <Badge tone={stateTone(detail.finding.state)}>{stateLabel(detail.finding.state)}</Badge>
              <VerifyBadge verify={detail.verify} />
            </div>
          </div>
        </div>
      </header>

      <div className="finding-layout">
        {/* Left Column: Details, Diff, Trace */}
        <div className="finding-layout__main">
          <Card className="finding-summary-card">
            <h3 className="section-title">Summary & Evidence</h3>
            <p className="finding-summary__text">{detail.finding.summary}</p>
            {runDetail && (
              <div className="finding-summary__meta">
                <span className="text-muted">Run score:</span>
                <span className="chip badge--neutral font-mono font-bold">
                  {runDetail.score.score}
                </span>
              </div>
            )}
          </Card>

          {detail.explanation && (
            <Card className="finding-explanation-card">
              <ExplanationPanel explanation={detail.explanation} />
            </Card>
          )}

          {detail.patch && (
            <Card className="finding-diff-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="section-title">Proposed patch</h3>
                <span className="chip chip--neutral" data-testid="patch-model-chip">
                  {detail.patch.source === 'template' ? (
                    'Reference fix'
                  ) : (
                    <>
                      AI: <span>{detail.patch.model ?? 'gemini'}</span>
                    </>
                  )}
                </span>
              </div>
              <UnifiedDiff diff={detail.patch.diff} />
            </Card>
          )}

          <Card className="finding-trace-card">
            <h3 className="section-title">Trace replay</h3>
            <TraceReplay
              steps={detail.steps}
              evidenceStepIds={detail.finding.evidenceStepIds}
              verdict={detail.finding.summary}
            />
          </Card>
        </div>

        {/* Right Column: Sticky Actions Sidebar */}
        <div className="finding-layout__sidebar">
          <div className="finding-sidebar-sticky">
            {detail.finding.state !== 'verified' &&
              detail.finding.state !== 'protected' &&
              detail.finding.state !== 'patched' && (
                <Card className="actions-card">
                  <h3 className="actions-card__title">Remediation</h3>
                  <p className="actions-card__desc">
                    Propose an AI patch and re-run invariant checks in sandbox.
                  </p>
                  <PrescribeButton
                    stage={prescribe.stage}
                    message={prescribe.message}
                    onStart={prescribe.start}
                  />
                  {prescribe.stage !== 'idle' && <PrescribeStepper stage={prescribe.stage} />}
                </Card>
              )}

            {(detail.finding.state === 'verified' || detail.finding.state === 'patched') && (
              <Card className="actions-card actions-card--verified">
                <h3 className="actions-card__title">
                  {detail.finding.state === 'patched' ? 'Patch Ready (Needs review)' : 'Patch Ready'}
                </h3>
                <p className="actions-card__desc">
                  {detail.finding.state === 'patched'
                    ? 'Remote patch generated. Submit pull request to review and deploy to your test environment.'
                    : 'The generated patch resolved all invariant checks in the sandbox.'}
                </p>
                <OpenPrButton
                  findingId={detail.finding.id}
                  client={client.openPr ? (client as Pick<ApiClient, 'openPr'>) : undefined}
                  onPrOpened={(url) => setPrUrl(url)}
                />
                {prUrl && (
                  <div className="mt-3 text-sm" data-testid="finding-pr-url-box">
                    <span className="text-muted">Pull Request: </span>
                    <a
                      data-testid="finding-pr-link"
                      href={prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline"
                      style={{ wordBreak: 'break-all' }}
                    >
                      {prUrl}
                    </a>
                  </div>
                )}
              </Card>
            )}

            <Card className="meta-card">
              <h4 className="meta-card__title">Metadata</h4>
              <dl className="meta-dl">
                <div className="meta-row">
                  <dt>Finding ID</dt>
                  <dd className="font-mono">{detail.finding.id}</dd>
                </div>
                <div className="meta-row">
                  <dt>Scenario</dt>
                  <dd className="font-mono">{detail.finding.scenarioKey}</dd>
                </div>
                <div className="meta-row">
                  <dt>Invariant</dt>
                  <dd className="font-mono">{detail.finding.invariantKey}</dd>
                </div>
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
