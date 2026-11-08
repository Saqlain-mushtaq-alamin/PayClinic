import { useState } from 'react';
import { toast } from 'sonner';
import { api, type ApiClient } from '../api/client';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';

export interface OpenPrButtonProps {
  findingId: string;
  client?: Pick<ApiClient, 'openPr'>;
}

type OpenPrState =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'opened'; url: string }
  | { kind: 'reason'; message: string }
  | { kind: 'error'; message: string };

/**
 * Opens a pull request from a verified finding. Shows the PR link on success,
 * the server's reason (e.g. "GitHub is not configured") when no PR was opened,
 * and an error with retry when the request fails.
 */
export function OpenPrButton({ findingId, client = api }: OpenPrButtonProps) {
  const [state, setState] = useState<OpenPrState>({ kind: 'idle' });

  const open = () => {
    if (state.kind === 'opening' || state.kind === 'opened' || state.kind === 'reason') return;
    setState({ kind: 'opening' });
    client
      .openPr(findingId)
      .then((result) => {
        if (result.prUrl) {
          toast.success('Pull request opened');
          setState({ kind: 'opened', url: result.prUrl });
        } else {
          toast.info(result.reason ?? 'Pull request is not available');
          setState({ kind: 'reason', message: result.reason ?? 'Pull request is not available' });
        }
      })
      .catch((reason: unknown) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        toast.error(`Failed to open PR: ${msg}`);
        setState({
          kind: 'error',
          message: msg,
        });
      });
  };

  const disabled = state.kind === 'opening' || state.kind === 'opened' || state.kind === 'reason';

  return (
    <div className="open-pr-button" data-testid="open-pr-button">
      <Button
        onClick={open}
        disabled={disabled}
        title={state.kind === 'reason' ? state.message : undefined}
      >
        {state.kind === 'opening' ? (
          <>
            <Spinner label="" /> Opening…
          </>
        ) : state.kind === 'error' ? (
          'Retry'
        ) : (
          'Open PR'
        )}
      </Button>
      {state.kind === 'opened' && (
        <a data-testid="open-pr-link" href={state.url} target="_blank" rel="noreferrer">
          View pull request
        </a>
      )}
      {state.kind === 'reason' && <span data-testid="open-pr-reason">{state.message}</span>}
      {state.kind === 'error' && <p role="alert">{state.message}</p>}
    </div>
  );
}
