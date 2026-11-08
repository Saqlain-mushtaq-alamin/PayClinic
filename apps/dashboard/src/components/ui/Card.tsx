import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

export function Card({ children, className, id }: CardProps) {
  const classes = ['card', className].filter(Boolean).join(' ');
  return (
    <section id={id} className={classes}>
      {children}
    </section>
  );
}
