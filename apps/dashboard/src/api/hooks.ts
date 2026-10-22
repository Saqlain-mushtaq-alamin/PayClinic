import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunDetail, RunSummary } from '@payclinic/contracts';
import { api, type ApiClient } from './client';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

function useAsync<T>(load: () => Promise<T>, keys: readonly unknown[]): AsyncState<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((value) => {
        if (!active) return;
        setData(value);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setData(null);
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [...keys, tick]);

  return { data, error, loading, reload };
}

export function useRuns(client: Pick<ApiClient, 'listRuns'> = api): AsyncState<RunSummary[]> {
  const clientRef = useRef(client);
  clientRef.current = client;
  return useAsync(() => clientRef.current.listRuns(), []);
}

export function useRun(id: string, client: Pick<ApiClient, 'getRun'> = api): AsyncState<RunDetail> {
  const clientRef = useRef(client);
  clientRef.current = client;
  return useAsync(() => clientRef.current.getRun(id), [id]);
}
