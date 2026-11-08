import { useCallback, useEffect, useRef, useState } from 'react';
import type { Health, RunDetail, RunSummary, ScenarioInfo } from '@payclinic/contracts';
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
  const lastJsonRef = useRef<string>('');

  useEffect(() => {
    let active = true;
    // Silent reload: only set loading=true on initial fetch when data is null
    if (data === null) {
      setLoading(true);
    }
    setError(null);
    loadRef
      .current()
      .then((value) => {
        if (!active) return;
        const json = JSON.stringify(value);
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json;
          setData(value);
        }
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (data === null) setData(null);
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

export function useHealth(client: Pick<ApiClient, 'health'> = api): AsyncState<Health> {
  const clientRef = useRef(client);
  clientRef.current = client;
  return useAsync(() => clientRef.current.health(), []);
}

export function useScenarios(
  client: Pick<ApiClient, 'getScenarios'> = api,
): AsyncState<ScenarioInfo[]> {
  const clientRef = useRef(client);
  clientRef.current = client;
  return useAsync(() => clientRef.current.getScenarios(), []);
}
