import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiClient } from '../../api/client';
import { Badge, type BadgeTone } from './Badge';

export interface LayoutProps {
  children: ReactNode;
  client?: Pick<ApiClient, 'health'>;
}

export function Layout({ children, client = api }: LayoutProps) {
  const clientRef = useRef(client);
  clientRef.current = client;
  const [mode, setMode] = useState('checking...');

  useEffect(() => {
    let active = true;
    clientRef.current
      .health()
      .then((health) => {
        if (active) setMode(health.mode);
      })
      .catch(() => {
        if (active) setMode('unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  const tone: BadgeTone = mode === 'online' ? 'medium' : mode === 'offline' ? 'ok' : 'neutral';

  return (
    <div className="layout">
      <header className="layout__header">
        <Link className="layout__brand" to="/">
          PayClinic
        </Link>
        <span className="layout__tagline">Diagnose · Prescribe · Protect</span>
      </header>
      <main className="layout__main">{children}</main>
      <footer className="layout__footer">
        <span>Mode</span>
        <Badge tone={tone}>{mode}</Badge>
      </footer>
    </div>
  );
}
