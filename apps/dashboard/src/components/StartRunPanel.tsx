import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RunMode, ScenarioInfo } from '@payclinic/contracts';
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
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  useEffect(() => {
    if (scenarios)
      setChecked(
        new Set(
          scenarios
            .filter((scenario) => scenario.target === 'store' && scenario.key !== 'B6')
            .map((scenario) => scenario.key),
        ),
      );
  }, [scenarios]);

  const mode: RunMode | undefined = health?.mode;
  const canStart = Boolean(scenarios && mode) && !posting;

  const onDiagnose = useCallback(async () => {
    const list: ScenarioInfo[] | null = scenarios;
    if (!list || !mode || posting) return; // never post without the health mode label
    setPosting(true);
    setPostError(null);
    try {
      const { runId } = await clientRef.current.createRun({
        target: 'store',
        mode,
        scenarios: list
          .filter((scenario) => checked.has(scenario.key))
          .map((scenario) => scenario.key),
      });
      navigate(`/runs/${runId}`);
    } catch (reason: unknown) {
      setPostError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPosting(false);
    }
  }, [checked, mode, navigate, posting, scenarios]);

  return (
    <Card className="start-run">
      <h2>Diagnose</h2>
      {mode && <p>Mode: {mode}</p>}
      {scenariosLoading && <Spinner label="Loading scenarios..." />}
      <ul className="start-run__scenarios">
        {(scenarios ?? [])
          .filter((scenario) => scenario.target === 'store')
          .map((scenario) => (
            <li key={scenario.key}>
              <label>
                <input
                  type="checkbox"
                  checked={checked.has(scenario.key)}
                  onChange={() =>
                    setChecked((current) => {
                      const next = new Set(current);
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
      <Button onClick={onDiagnose} disabled={!canStart}>
        Diagnose
      </Button>
      {postError && (
        <p className="start-run__error" role="alert">
          {postError}
        </p>
      )}
    </Card>
  );
}
