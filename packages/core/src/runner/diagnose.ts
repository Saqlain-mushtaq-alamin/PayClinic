import type {
  Finding,
  InvariantResult,
  Run,
  RunEvent,
  RunMode,
  RunState,
  ScenarioKey,
  ScenarioResult,
  Score,
  Step,
} from '@payclinic/contracts';
import type { Config } from '../config';
import type { Repos } from '../db/repos';
import { findingsFromResults } from '../findings';
import { computeScore } from '../score';
import type { ScenarioFn } from './context';
import { executeScenarios } from './execute-scenarios';

export { DiagnoseError, executeScenarios } from './execute-scenarios';
export type { ExecuteScenariosEnv, ExecutedScenario, StoreFactory } from './execute-scenarios';

export interface DiagnoseDeps {
  repos: Repos;
  config: Config;
  scenarios: Partial<Record<ScenarioKey, ScenarioFn>>;
  storeSourceDir: string;
  newId: () => string;
  now: () => Date;
  emit?: (e: RunEvent) => void;
  scenarioTimeoutMs?: number;
  onScenarioFinished?: (
    key: ScenarioKey,
    info: { steps: Step[]; state: RunState; results: InvariantResult[] },
  ) => void | Promise<void>;
}

export interface DiagnoseRequest {
  target: 'store';
  mode: RunMode;
  scenarios: ScenarioKey[];
  runId?: string;
}

export interface DiagnoseResult {
  runId: string;
  findings: Finding[];
  score: Score;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs the selected merchant scenarios end to end and persists their traces and findings. */
export async function runDiagnose(
  deps: DiagnoseDeps,
  req: DiagnoseRequest,
): Promise<DiagnoseResult> {
  const runId = req.runId ?? deps.newId();
  const run: Run = {
    id: runId,
    target: req.target,
    mode: req.mode,
    scenarioKeys: req.scenarios,
    status: 'running',
    startedAt: deps.now().toISOString(),
  };
  deps.repos.insertRun(run);
  deps.emit?.({ type: 'run.started', run });

  const findings: Finding[] = [];
  const startedAt = new Map<string, string>();

  try {
    await executeScenarios(
      {
        config: deps.config,
        scenarios: deps.scenarios,
        storeSourceDir: deps.storeSourceDir,
        newId: deps.newId,
        now: deps.now,
        ...(deps.scenarioTimeoutMs === undefined
          ? {}
          : { scenarioTimeoutMs: deps.scenarioTimeoutMs }),
        runId,
        onStep: (step) => deps.emit?.({ type: 'step.recorded', step }),
        onScenarioStart: (key, scenarioId) => {
          const scenario: ScenarioResult = {
            id: scenarioId,
            runId,
            key,
            status: 'running',
            startedAt: deps.now().toISOString(),
          };
          startedAt.set(scenarioId, scenario.startedAt!);
          deps.repos.insertScenario(scenario);
          deps.emit?.({ type: 'scenario.started', scenario });
        },
        onScenario: async (key, info) => {
          const scenario: ScenarioResult = {
            id: info.scenarioId,
            runId,
            key,
            status: info.status,
            ...(startedAt.has(info.scenarioId)
              ? { startedAt: startedAt.get(info.scenarioId) }
              : {}),
          };
          deps.repos.insertSteps(info.steps);

          if (info.status === 'error') {
            const finishedAt = deps.now().toISOString();
            deps.repos.updateScenario(info.scenarioId, {
              status: 'error',
              finishedAt,
              error: info.error,
            });
            deps.emit?.({
              type: 'scenario.finished',
              scenario: { ...scenario, finishedAt, error: info.error },
            });
            return;
          }

          deps.repos.insertInvariantResults(runId, info.scenarioId, info.results);
          await deps.onScenarioFinished?.(key, {
            steps: info.steps,
            state: info.state,
            results: info.results,
          });

          const scenarioFindings = findingsFromResults({
            runId,
            scenarioKey: key,
            results: info.results,
            newId: deps.newId,
            now: () => deps.now().toISOString(),
          });
          for (const finding of scenarioFindings) {
            deps.repos.insertFinding(finding);
            findings.push(finding);
            deps.emit?.({ type: 'finding.created', finding });
          }

          const finishedAt = deps.now().toISOString();
          deps.repos.updateScenario(info.scenarioId, { status: info.status, finishedAt });
          deps.emit?.({
            type: 'scenario.finished',
            scenario: { ...scenario, finishedAt },
          });
        },
      },
      req.scenarios,
    );

    const score = computeScore(findings);
    const completedAt = deps.now().toISOString();
    deps.repos.updateRun(runId, {
      status: 'completed',
      completedAt,
      scoreBefore: score.score,
    });
    const completed: Run = { ...run, status: 'completed', completedAt, scoreBefore: score.score };
    deps.emit?.({ type: 'score.updated', score });
    deps.emit?.({ type: 'run.completed', run: completed });
    return { runId, findings, score };
  } catch (error) {
    const completedAt = deps.now().toISOString();
    const message = errorMessage(error);
    deps.repos.updateRun(runId, { status: 'failed', completedAt, error: message });
    deps.emit?.({ type: 'run.failed', runId, error: message });
    throw error;
  }
}
