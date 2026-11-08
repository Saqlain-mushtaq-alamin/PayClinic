import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LiveConnectionStatus } from '../api/useLiveRun';
import { api, type ApiClient } from '../api/client';

export interface DashboardContextValue {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  liveConnection: LiveConnectionStatus;
  setLiveConnection: (c: LiveConnectionStatus) => void;
  mode: string;
  refreshHealth: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export interface DashboardProviderProps {
  children: ReactNode;
  client?: Pick<ApiClient, 'health'>;
}

export function DashboardProvider({ children, client = api }: DashboardProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = searchParams.get('q') ?? '';
  const [searchQuery, setSearchQueryState] = useState(urlQ);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionStatus>('offline');
  const [mode, setMode] = useState<string>('checking...');

  useEffect(() => {
    const currentQ = searchParams.get('q') ?? '';
    if (currentQ !== searchQuery) {
      setSearchQueryState(currentQ);
    }
  }, [searchParams]);

  const setSearchQuery = (q: string) => {
    setSearchQueryState(q);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (q) next.set('q', q);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  };

  const refreshHealth = () => {
    client
      .health()
      .then((h) => setMode(h.mode))
      .catch(() => setMode('offline'));
  };

  useEffect(() => {
    refreshHealth();
  }, []);

  return (
    <DashboardContext.Provider
      value={{
        searchQuery,
        setSearchQuery,
        liveConnection,
        setLiveConnection,
        mode,
        refreshHealth,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    return {
      searchQuery: '',
      setSearchQuery: () => {},
      liveConnection: 'offline',
      setLiveConnection: () => {},
      mode: 'offline',
      refreshHealth: () => {},
    };
  }
  return ctx;
}
