import type { ProtectStage } from '../api/useProtect';
import { Button } from './ui/Button';

export interface ProtectButtonProps {
  stage: ProtectStage;
  message: string | null;
  onStart: () => void;
}

/**
 * The Protect action: enabled while idle, disabled while a stage is running,
 * and replaced by the failure message plus a Retry button on failure. The page
 * hides it entirely once every finding is protected.
 */
export function ProtectButton({ stage, message, onStart }: ProtectButtonProps) {
  if (stage === 'done') return null;

  if (stage === 'failed') {
    return (
      <div className="protect-button" data-testid="protect-button">
        <p role="alert">{message}</p>
        <Button onClick={onStart}>Retry</Button>
      </div>
    );
  }

  const running = stage !== 'idle';
  return (
    <div className="protect-button" data-testid="protect-button">
      <Button onClick={onStart} disabled={running}>
        {running ? 'Protecting…' : 'Protect'}
      </Button>
    </div>
  );
}
