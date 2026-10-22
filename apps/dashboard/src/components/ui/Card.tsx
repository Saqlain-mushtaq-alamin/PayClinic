import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  const classes = ['card', className].filter(Boolean).join(' ');
  return <section className={classes}>{children}</section>;
}
