import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Guard to ensure checkbox state is independent of scenarios array identity
  const userToggledRef = useRef<Set<string>>(new Set());
  const initializedTargetsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (scenarios && !initializedTargetsRef.current.has(target)) {
      initializedTargetsRef.current.add(target);
      if (!userToggledRef.current.has(target)) {
        setChecked(
          new Set(
            scenarios
              .filter((s) => s.target === target && !(target === 'store' && s.key === 'B6'))
              .map((s) => s.key),
          ),
        );
      }
    }
  }, [scenarios, target]);

  const selectTarget = (nextTarget: RunTarget) => {
    if (nextTarget === target) return;
    setTarget(nextTarget);
    if (scenarios && !userToggledRef.current.has(nextTarget)) {
      initializedTargetsRef.current.add(nextTarget);
      setChecked(
        new Set(
          scenarios
            .filter((s) => s.target === nextTarget && !(nextTarget === 'store' && s.key === 'B6'))
            .map((s) => s.key),
        ),
      );
    }
  };

  const effectiveChecked = userToggledRef.current.has(target)
    ? checked
    : new Set(
        (scenarios ?? [])
          .filter((s) => s.target === target && !(target === 'store' && s.key === 'B6'))
          .map((s) => s.key),
      );

  const mode: RunMode | undefined = health?.mode;
  const canStart = Boolean(scenarios && mode) && !posting && effectiveChecked.size > 0;

  const onDiagnose = useCallback(async () => {
    const list: ScenarioInfo[] | null = scenarios;
    if (!list || !mode || posting) return; // never post without the health mode label
    // Immediate optimistic state before awaiting network call
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
      toast.success(`Run started: ${runId}`);
      navigate(`/runs/${runId}`);
    } catch (reason: unknown) {
      const msg = reason instanceof Error ? reason.message : String(reason);
      setPostError(msg);
      toast.error(`Failed to start run: ${msg}`);
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
          onClick={() => selectTarget('store')}
        >
          Store bugs
        </Button>{' '}
        <Button
          variant={target === 'agent' ? 'primary' : 'secondary'}
          onClick={() => selectTarget('agent')}
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
                      const base = userToggledRef.current.has(target) ? current : effectiveChecked;
                      userToggledRef.current.add(target);
                      const next = new Set(base);
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
        {posting ? (
          <>
            <Spinner label="" /> Starting…
          </>
        ) : (
          'Diagnose'
        )}
      </Button>
      {postError && (
        <p className="start-run__error" role="alert">
          {postError}
        </p>
      )}
    </Card>
  );
}
