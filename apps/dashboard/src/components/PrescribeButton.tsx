import type { PrescribeStage } from '../api/usePrescribe';
import { Button } from './ui/Button';

export interface PrescribeButtonProps {
  stage: PrescribeStage;
  message: string | null;
  onStart: () => void;
}

/**
 * The Prescribe action: enabled while idle, disabled while a stage is
 * running, and replaced by the failure message plus a Retry button on failure.
 * The page hides it entirely once the finding is verified.
 */
export function PrescribeButton({ stage, message, onStart }: PrescribeButtonProps) {
  if (stage === 'done') return null;

  if (stage === 'failed') {
    return (
      <div className="prescribe-button" data-testid="prescribe-button">
        <p role="alert">{message}</p>
        <Button onClick={onStart}>Retry</Button>
      </div>
    );
  }

  const running = stage !== 'idle';
  return (
    <div className="prescribe-button" data-testid="prescribe-button">
      <Button onClick={onStart} disabled={running}>
        {running ? 'Prescribing…' : 'Prescribe'}
      </Button>
    </div>
  );
}
