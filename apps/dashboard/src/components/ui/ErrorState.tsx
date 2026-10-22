import { Button } from './Button';

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
}
