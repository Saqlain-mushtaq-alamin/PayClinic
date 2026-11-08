import { useState } from 'react';
import type { PrescribeStage } from '../api/usePrescribe';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

export interface PrescribeButtonProps {
  stage: PrescribeStage;
  message: string | null;
  onStart: () => void;
}

/**
 * The Prescribe action: enabled while idle, disabled immediately on click
 * with an optimistic busy state, and replaced by failure message + Retry on failure.
 */
export function PrescribeButton({ stage, message, onStart }: PrescribeButtonProps) {
  const [busy, setBusy] = useState(false);

  if (stage === 'done') return null;

  if (stage === 'failed') {
    return (
      <div className="prescribe-button" data-testid="prescribe-button">
        <p role="alert">{message}</p>
        <Button
          onClick={() => {
            setBusy(true);
            onStart();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const running = stage !== 'idle' || busy;

  const handleClick = () => {
    if (running) return;
    setBusy(true);
    onStart();
  };

  return (
    <div className="prescribe-button" data-testid="prescribe-button">
      <Button
        aria-label={running ? 'Prescribing…' : 'Prescribe'}
        onClick={handleClick}
        disabled={running}
      >
        {busy && stage === 'idle' ? (
          <>
            <Spinner label="" /> Starting…
          </>
        ) : running ? (
          'Prescribing…'
        ) : (
          'Prescribe'
        )}
      </Button>
    </div>
  );
}
