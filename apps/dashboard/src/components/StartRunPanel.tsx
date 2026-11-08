import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunMode, RunTarget, ScenarioInfo } from '@payclinic/contracts';
import { useHealth, useScenarios } from '../api/hooks';
import { api, type ApiClient } from '../api/client';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Spinner } from './ui/Spinner';

export type StartRunClient = Pick<ApiClient, 'health' | 'getScenarios' | 'createRun'>;

export interface StartRunPanelProps {
  client?: StartRunClient;
}

/** Loads the scenario list and health mode, then creates a run on Diagnose. */
export function StartRunPanel({ client: injectedClient }: StartRunPanelProps) {
  const client = injectedClient ?? api;
  const clientRef = useRef(client);
  clientRef.current = client;
  const navigate = useNavigate();
  const { data: scenarios, loading: scenariosLoading } = useScenarios(injectedClient);
  const { data: health } = useHealth(injectedClient);
  const [target, setTarget] = useState<RunTarget>('store');
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  useEffect(() => {
    if (scenarios)
      setChecked(
        new Set(
          scenarios
            .filter((s) => s.target === target && !(target === 'store' && s.key === 'B6'))
            .map((s) => s.key),
        ),
      );
  }, [scenarios, target]);

  const effectiveChecked =
    checked ??
    new Set(
      (scenarios ?? [])
        .filter((s) => s.target === target && !(target === 'store' && s.key === 'B6'))
        .map((s) => s.key),
    );

  const mode: RunMode | undefined = health?.mode;
  const canStart = Boolean(scenarios && mode) && !posting && effectiveChecked.size > 0;

  const onDiagnose = useCallback(async () => {
    const list: ScenarioInfo[] | null = scenarios;
    if (!list || !mode || posting) return; // never post without the health mode label
    setPosting(true);
    setPostError(null);
    try {
      const { runId } = await clientRef.current.createRun({
        target,
        mode,
        scenarios: list
          .filter((scenario) => effectiveChecked.has(scenario.key))
          .map((scenario) => scenario.key),
      });
      navigate(`/runs/${runId}`);
    } catch (reason: unknown) {
      setPostError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPosting(false);
    }
  }, [effectiveChecked, mode, navigate, posting, scenarios, target]);

  return (
    <Card className="start-run">
      <h2>Diagnose</h2>
      {mode && <p>Mode: {mode}</p>}
      <div role="group" aria-label="Target">
        <Button
          variant={target === 'store' ? 'primary' : 'secondary'}
          onClick={() => {
            setTarget('store');
            setChecked(null);
          }}
        >
          Store bugs
        </Button>{' '}
        <Button
          variant={target === 'agent' ? 'primary' : 'secondary'}
          onClick={() => {
            setTarget('agent');
            setChecked(null);
          }}
        >
          Agent attacks
        </Button>
      </div>
      {scenariosLoading && <Spinner label="Loading scenarios..." />}
      <ul className="start-run__scenarios">
        {(scenarios ?? [])
          .filter((scenario) => scenario.target === target)
          .map((scenario) => (
            <li key={scenario.key}>
              <label>
                <input
                  type="checkbox"
                  checked={effectiveChecked.has(scenario.key)}
                  onChange={() =>
                    setChecked((current) => {
                      const next = new Set(current ?? effectiveChecked);
                      if (next.has(scenario.key)) next.delete(scenario.key);
                      else next.add(scenario.key);
                      return next;
                    })
                  }
                />{' '}
                {scenario.key} — {scenario.title}
              </label>
            </li>
          ))}
      </ul>
      <Button aria-label="Diagnose" onClick={onDiagnose} disabled={!canStart}>
        {posting ? 'Starting…' : 'Diagnose'}
      </Button>
      {postError && (
        <p className="start-run__error" role="alert">
          {postError}
        </p>
      )}
    </Card>
  );
}
