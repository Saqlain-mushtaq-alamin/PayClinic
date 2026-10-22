import type { ReactNode } from 'react';

export interface EmptyStateProps {
  message: string;
  action?: ReactNode;
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <p>{message}</p>
      {action}
    </div>
  );
}
