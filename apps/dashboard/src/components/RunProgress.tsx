import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitCommit,
  PlayCircle,
  Shield,
  ShieldAlert,
  TrendingUp,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { RunEvent } from '@payclinic/contracts';
import { Badge, type BadgeTone } from './ui/Badge';

export function severityTone(severity: string): BadgeTone {
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

export interface ProgressLine {
  text: string;
  severity?: string;
  type?: RunEvent['type'];
  id?: string;
  timestamp?: number;
}

/** Folds the ordered event stream into display lines. Pure. */
export function progressLines(events: RunEvent[]): ProgressLine[] {
  const lines: ProgressLine[] = [];
  let lastScore: number | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    switch (event.type) {
      case 'scenario.started':
        lines.push({
          id: `scn-${event.scenario.key}-${i}`,
          type: event.type,
          text: `Running ${event.scenario.key}…`,
        });
        break;
      case 'finding.created':
        lines.push({
          id: `fnd-${event.finding.id}-${i}`,
          type: event.type,
          text: event.finding.title,
          severity: event.finding.severity,
        });
        break;
      case 'score.updated':
        lastScore = event.score.score;
        break;
      case 'prescribe.progress':
        lines.push({
          id: `pre-${event.findingId}-${i}`,
          type: event.type,
          text: `Prescribing: ${event.stage} - ${event.message}`,
        });
        break;
      case 'decision.recorded':
        lines.push({
          id: `dec-${event.decision.id}-${i}`,
          type: event.type,
          text: `Firewall ${event.decision.action}: ${event.decision.ruleId}`,
        });
        break;
      case 'run.completed':
        lines.push({
          id: `rc-${i}`,
          type: event.type,
          text: `Done, score ${event.run.scoreAfter ?? lastScore ?? '—'}`,
        });
        break;
      case 'run.failed':
        lines.push({
          id: `rf-${i}`,
          type: event.type,
          text: `Failed: ${event.error}`,
        });
        break;
      default:
        break;
    }
  }

  return lines;
}

export function deriveCurrentState(
  events: RunEvent[],
  isBusy: boolean,
  error?: string | null,
): string {
  if (error) return `Failed: ${error}`;

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'run.failed') return `Failed: ${e.error}`;
    if (e.type === 'prescribe.progress') {
      if (e.stage === 'done') return 'Prescribing: verified';
      if (e.stage === 'failed') return `Prescribing: failed`;
      const stageMap: Record<string, string> = {
        explaining: 'explaining (step 1 of 4)',
        patching: 'patching (step 2 of 4)',
        verifying: 'verifying (step 3 of 4)',
      };
      return `Prescribing: ${stageMap[e.stage] ?? e.stage}`;
    }
    if (e.type === 'decision.recorded') {
      return 'Protecting: re-running attack';
    }
    if (e.type === 'scenario.started') {
      return `Running scenario ${e.scenario.key}…`;
    }
    if (e.type === 'run.completed') {
      return 'Completed';
    }
  }

  if (isBusy) return 'Running scenarios…';
  return 'Idle';
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export interface RunProgressProps {
  events: RunEvent[];
  isBusy?: boolean;
  lastEventAt?: number | null;
  runStatus?: string;
  runStartedAt?: string;
  error?: string | null;
  newestFirst?: boolean;
}

function renderEventIcon(type?: RunEvent['type'], severity?: string) {
  switch (type) {
    case 'scenario.started':
      return <PlayCircle size={15} className="activity-item__icon activity-item__icon--primary" />;
    case 'finding.created':
      return severity === 'critical' || severity === 'high' ? (
        <ShieldAlert size={15} className="activity-item__icon activity-item__icon--danger" />
      ) : (
        <AlertTriangle size={15} className="activity-item__icon activity-item__icon--warn" />
      );
    case 'score.updated':
      return <TrendingUp size={15} className="activity-item__icon activity-item__icon--ok" />;
    case 'prescribe.progress':
      return <Wrench size={15} className="activity-item__icon activity-item__icon--accent" />;
    case 'decision.recorded':
      return <Shield size={15} className="activity-item__icon activity-item__icon--info" />;
    case 'run.completed':
      return <CheckCircle2 size={15} className="activity-item__icon activity-item__icon--ok" />;
    case 'run.failed':
      return <XCircle size={15} className="activity-item__icon activity-item__icon--danger" />;
    default:
      return <GitCommit size={15} className="activity-item__icon activity-item__icon--muted" />;
  }
}

/** Vertical live-progress list built from the SSE event stream. */
export function RunProgress({
  events,
  isBusy = false,
  lastEventAt,
  runStatus,
  runStartedAt,
  error,
  newestFirst = false,
}: RunProgressProps) {
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isBusy) return;
    const startTime = runStartedAt ? new Date(runStartedAt).getTime() : Date.now();
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      setElapsed(Math.max(0, Math.floor((current - startTime) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [isBusy, runStartedAt]);

  const lines = useMemo(() => progressLines(events), [events]);
  const currentState = useMemo(
    () => deriveCurrentState(events, isBusy, error),
    [events, isBusy, error],
  );

  const isStalled = Boolean(
    isBusy && lastEventAt && now - lastEventAt >= 20_000,
  );

  if (lines.length === 0 && !newestFirst) return null;

  // Simple mode for unit tests and fallback
  if (!newestFirst) {
    return (
      <ol className="run-progress" data-testid="run-progress">
        {lines.map((line, index) => (
          <li key={`${line.text}-${index}`} data-testid="run-progress-line">
            {line.severity && <Badge tone={severityTone(line.severity)}>{line.severity}</Badge>}
            <span>{line.text}</span>
          </li>
        ))}
      </ol>
    );
  }

  // Live Activity Card Mode (Phase 4 interactive design)
  const displayLines = lines.slice(-50).reverse();

  return (
    <div className="activity-feed" data-testid="run-progress">
      <div className="activity-feed__header" aria-live="polite">
        <div className="activity-feed__state-wrapper">
          <span
            className={`activity-feed__dot ${
              isBusy
                ? 'activity-feed__dot--live pulse-dot pulse-dot--live'
                : runStatus === 'failed'
                  ? 'activity-feed__dot--failed'
                  : 'activity-feed__dot--idle'
            }`}
          />
          <span className="activity-feed__state-text" title={currentState}>
            {currentState}
          </span>
        </div>
        {isBusy && (
          <div className="activity-feed__timer" title="Elapsed execution time">
            <span className="activity-feed__timer-label">Elapsed</span>
            <span className="activity-feed__timer-val font-mono">{formatElapsed(elapsed)}</span>
          </div>
        )}
      </div>

      {isStalled && (
        <div className="activity-feed__stall-alert" role="status">
          <AlertTriangle size={14} />
          <span>Still working… no updates for 20s</span>
        </div>
      )}

      {displayLines.length === 0 ? (
        <div className="activity-feed__empty">Waiting for events…</div>
      ) : (
        <ol className="activity-feed__list">
          {displayLines.map((line, index) => (
            <li
              key={line.id ?? `${line.text}-${index}`}
              className="activity-feed__item"
              data-testid="run-progress-line"
            >
              <div className="activity-feed__item-icon-wrap">
                {renderEventIcon(line.type, line.severity)}
              </div>
              <div className="activity-feed__item-content">
                <span className="activity-feed__item-text">{line.text}</span>
                {line.severity && (
                  <Badge tone={severityTone(line.severity)}>{line.severity}</Badge>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
