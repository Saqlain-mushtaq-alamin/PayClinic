import type { ReactNode } from 'react';

export type BadgeTone = 'critical' | 'high' | 'medium' | 'low' | 'ok' | 'neutral';

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone, children }: BadgeProps) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
