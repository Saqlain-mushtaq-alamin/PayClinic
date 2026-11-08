import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Play, ShieldAlert, Sparkles } from 'lucide-react';
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

  // Synchronous ref tracking ensures instant updates even if click and post occur in same tick
  const userToggledRef = useRef<Set<string>>(new Set());
  const initializedTargetsRef = useRef<Set<string>>(new Set());
  const checkedRef = useRef<Set<string>>(new Set());

  const defaultKeys = useMemo(
    () =>
      new Set(
        (scenarios ?? [])
          .filter((s) => s.target === target && !(target === 'store' && s.key === 'B6'))
          .map((s) => s.key),
      ),
    [scenarios, target],
  );

  useEffect(() => {
    if (scenarios && !initializedTargetsRef.current.has(target)) {
      initializedTargetsRef.current.add(target);
      if (!userToggledRef.current.has(target)) {
        setChecked(defaultKeys);
        checkedRef.current = defaultKeys;
      }
    }
  }, [scenarios, target, defaultKeys]);

  const selectTarget = (nextTarget: RunTarget) => {
    if (nextTarget === target) return;
    setTarget(nextTarget);
    if (scenarios && !userToggledRef.current.has(nextTarget)) {
      initializedTargetsRef.current.add(nextTarget);
      const nextDefaults = new Set(
        scenarios
          .filter((s) => s.target === nextTarget && !(nextTarget === 'store' && s.key === 'B6'))
          .map((s) => s.key),
      );
      setChecked(nextDefaults);
      checkedRef.current = nextDefaults;
    }
  };

  const toggleScenario = (key: string) => {
    userToggledRef.current.add(target);
    const base = checkedRef.current.size > 0 ? checkedRef.current : defaultKeys;
    const next = new Set(base);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    checkedRef.current = next;
    setChecked(next);
  };

  const effectiveChecked = userToggledRef.current.has(target) ? checked : defaultKeys;

  const mode: RunMode | undefined = health?.mode;
  const canStart = Boolean(scenarios && mode) && !posting && effectiveChecked.size > 0;

  const onDiagnose = useCallback(async () => {
    const list: ScenarioInfo[] | null = scenarios;
    if (!list || !mode || posting) return;
    const activeChecked = userToggledRef.current.has(target) ? checkedRef.current : defaultKeys;
    if (activeChecked.size === 0) return;
    setPosting(true);
    setPostError(null);
    try {
      const { runId } = await clientRef.current.createRun({
        target,
        mode,
        scenarios: list
          .filter((scenario) => activeChecked.has(scenario.key))
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
  }, [defaultKeys, mode, navigate, posting, scenarios, target]);

  return (
    <Card className="start-run start-run--tall" id="diagnose-card" data-testid="diagnose-panel">
      {/* Top Gradient Mini-Card */}
      <div className="diagnose-minicard">
        <div className="diagnose-minicard__top">
          <span className="diagnose-minicard__badge">
            <Sparkles size={13} />
            SCANNER ENGINE
          </span>
          <ShieldAlert size={20} className="diagnose-minicard__icon" />
        </div>
        <div className="diagnose-minicard__bottom">
          <span className="diagnose-minicard__status">Ready to scan</span>
          {mode && <p className="diagnose-minicard__mode">Mode: {mode}</p>}
        </div>
      </div>

      <div className="start-run__body">
        <div className="start-run__header">
          <h2>Diagnose</h2>
          <span className="start-run__subtitle">Select targets & scenarios</span>
        </div>

        {/* Segmented Toggle */}
        <div className="segmented-toggle" role="group" aria-label="Target">
          <button
            type="button"
            className={`segmented-toggle__btn ${target === 'store' ? 'segmented-toggle__btn--active' : ''}`}
            onClick={() => selectTarget('store')}
          >
            Store bugs
          </button>
          <button
            type="button"
            className={`segmented-toggle__btn ${target === 'agent' ? 'segmented-toggle__btn--active' : ''}`}
            onClick={() => selectTarget('agent')}
          >
            Agent attacks
          </button>
        </div>

        {scenariosLoading && <Spinner label="Loading scenarios..." />}

        {/* Scenario checkboxes as selectable chip rows */}
        <ul className="start-run__scenario-chips">
          {(scenarios ?? [])
            .filter((scenario) => scenario.target === target)
            .map((scenario) => {
              const isChecked = effectiveChecked.has(scenario.key);
              return (
                <li key={scenario.key} className="start-run__scenario-item">
                  <label className={`scenario-chip ${isChecked ? 'scenario-chip--checked' : ''}`}>
                    <input
                      type="checkbox"
                      className="scenario-chip__input"
                      checked={isChecked}
                      onChange={() => toggleScenario(scenario.key)}
                    />
                    <span className="scenario-chip__box">
                      {isChecked ? <Check size={12} strokeWidth={3} /> : null}
                    </span>
                    <span className="scenario-chip__text">
                      <strong>{scenario.key}</strong> — {scenario.title}
                    </span>
                  </label>
                </li>
              );
            })}
        </ul>

        {/* Full-width green "Start diagnosis" button with a Play icon */}
        <Button
          className="button--primary button--fullwidth button--diagnose"
          aria-label="Diagnose"
          onClick={onDiagnose}
          disabled={!canStart}
        >
          {posting ? (
            <>
              <Spinner label="" /> Starting…
            </>
          ) : (
            <>
              <Play size={16} fill="currentColor" /> Start diagnosis
            </>
          )}
        </Button>

        {postError && (
          <p className="start-run__error" role="alert">
            {postError}
          </p>
        )}
      </div>
    </Card>
  );
}
