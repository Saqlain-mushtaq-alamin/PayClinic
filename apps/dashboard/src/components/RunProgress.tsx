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

interface ProgressLine {
  text: string;
  severity?: string;
}

/** Folds the ordered event stream into display lines. Pure. */
export function progressLines(events: RunEvent[]): ProgressLine[] {
  const lines: ProgressLine[] = [];
  let lastScore: number | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'scenario.started':
        lines.push({ text: `Running ${event.scenario.key}…` });
        break;
      case 'finding.created':
        lines.push({ text: event.finding.title, severity: event.finding.severity });
        break;
      case 'score.updated':
        lastScore = event.score.score;
        break;
      case 'run.completed':
        lines.push({ text: `Done, score ${event.run.scoreAfter ?? lastScore ?? '—'}` });
        break;
      case 'run.failed':
        lines.push({ text: `Failed: ${event.error}` });
        break;
      default:
        break;
    }
  }

  return lines;
}

export interface RunProgressProps {
  events: RunEvent[];
}

/** Vertical live-progress list built from the SSE event stream. */
export function RunProgress({ events }: RunProgressProps) {
  const lines = progressLines(events);

  if (lines.length === 0) return null;

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
