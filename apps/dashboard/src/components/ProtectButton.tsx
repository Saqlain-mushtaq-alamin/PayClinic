import { useState } from 'react';
import type { ProtectStage } from '../api/useProtect';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

export interface ProtectButtonProps {
  stage: ProtectStage;
  message: string | null;
  onStart: () => void;
}

/**
 * The Protect action: enabled while idle, disabled immediately on click
 * with an optimistic busy state, and replaced by failure message + Retry on failure.
 */
export function ProtectButton({ stage, message, onStart }: ProtectButtonProps) {
  const [busy, setBusy] = useState(false);

  if (stage === 'done') return null;

  if (stage === 'failed') {
    return (
      <div className="protect-button" data-testid="protect-button">
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
    <div className="protect-button" data-testid="protect-button">
      <Button
        aria-label={running ? 'Protecting…' : 'Protect'}
        onClick={handleClick}
        disabled={running}
      >
        {busy && stage === 'idle' ? (
          <>
            <Spinner label="" /> Starting…
          </>
        ) : running ? (
          'Protecting…'
        ) : (
          'Protect'
        )}
      </Button>
    </div>
  );
}
