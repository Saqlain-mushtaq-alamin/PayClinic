import type {
  Finding,
  FindingState,
  Run,
  RunCreateRequest,
  RunEvent,
  ScenarioResult,
  Step,
  VerifyResult,
} from '@payclinic/contracts';
import { computeScore } from '../score';
import { runDiagnose } from '../runner/diagnose';
import { defaultChildRegistry } from '../runner/child-registry';
import { createVerify } from '../verify/verify';
import { ProtectNotApplicableError, ProtectNotConfiguredError } from './types';
import type { Orchestrator, OrchestratorDeps } from './types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Creates the queue-based orchestrator that diagnoses, prescribes, verifies and protects. */
export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const timeoutMs =
    deps.runTimeoutMs ??
    (process.env.RUN_TIMEOUT_MS ? Number(process.env.RUN_TIMEOUT_MS) : 180_000);

  const onSignal = (): void => {
    void defaultChildRegistry.disposeAll();
  };
  process.once('exit', onSignal);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const { verifyDetailed } = createVerify({
    repoRoot: deps.repoRoot,
    config: deps.config,
    scenarios: deps.scenarios,
    newId: deps.newId,
    now: deps.now,
  });

  const emit = (event: RunEvent): void => {
    deps.bus.emit('event', event);
  };

  const progress = (
    findingId: string,
    stage: 'explaining' | 'patching' | 'verifying' | 'done' | 'failed',
    message: string,
  ): void => {
    emit({ type: 'prescribe.progress', findingId, stage, message });
  };

  const setFindingState = (findingId: string, state: FindingState): Finding => {
    deps.repos.updateFindingState(findingId, state);
    const updated = deps.repos.getFinding(findingId);
    if (!updated) throw new Error(`Finding ${findingId} not found after update`);

    const score = computeScore(deps.repos.listFindings(updated.runId));
    deps.repos.updateRun(updated.runId, { scoreAfter: score.score });
    emit({ type: 'finding.updated', finding: updated });
    emit({ type: 'score.updated', score });
    return updated;
  };

  const persistRerun = (
    finding: Finding,
    patchId: string,
    steps: Step[],
    verify: VerifyResult,
  ): void => {
    const base = deps.repos
      .listScenarios(finding.runId)
      .find((scenario) => scenario.key === finding.scenarioKey);
    if (!base) {
      throw new Error(`No scenario ${finding.scenarioKey} found for run ${finding.runId}`);
    }

    const scenarioId = `${base.id}-verify-${patchId}`;
    const timestamp = deps.now().toISOString();
    const scenario: ScenarioResult = {
      id: scenarioId,
      runId: finding.runId,
      key: finding.scenarioKey,
      status: verify.started ? (verify.invariantPassed ? 'passed' : 'failed') : 'error',
      startedAt: timestamp,
      finishedAt: timestamp,
    };
    deps.repos.insertScenario(scenario);
    deps.repos.insertSteps(steps.map((step) => ({ ...step, scenarioId })));
  };

  const doPrescribe = async (findingId: string): Promise<void> => {
    const finding = deps.repos.getFinding(findingId);
    if (!finding) throw new Error(`Finding ${findingId} not found`);
    const run = deps.repos.getRun(finding.runId);
    if (!run) throw new Error(`Run ${finding.runId} not found`);

    const steps = deps.repos.listStepsByIds(finding.evidenceStepIds);
    progress(finding.id, 'explaining', `Explaining finding ${finding.id}`);

    let result: Awaited<ReturnType<OrchestratorDeps['prescriber']>>;
    try {
      result = await deps.prescriber(finding, steps);
    } catch (error) {
      progress(finding.id, 'failed', errorMessage(error));
      throw error;
    }

    deps.repos.upsertExplanation(result.explanation);
    progress(
      finding.id,
      'patching',
      `Trying ${result.patches.length} patch${result.patches.length === 1 ? '' : 'es'}`,
    );

    if (result.patches.length === 0) {
      setFindingState(finding.id, 'unverified');
      progress(finding.id, 'failed', 'No patches were returned');
      return;
    }

    let lastLog = 'No patch verified';
    for (const patch of result.patches) {
      deps.repos.insertPatch(patch);
      if (deps.repos.getFinding(finding.id)?.state === 'open') {
        setFindingState(finding.id, 'patched');
      }

      progress(finding.id, 'verifying', `Verifying patch ${patch.id}`);
      const detailed = await verifyDetailed(finding, patch, {
        mode: run.mode,
        runId: finding.runId,
      });
      deps.repos.upsertVerify(finding.runId, detailed.result);
      persistRerun(finding, patch.id, detailed.steps, detailed.result);

      lastLog = detailed.result.log.at(-1) ?? lastLog;
      if (detailed.result.verified) {
        setFindingState(finding.id, 'verified');
        progress(finding.id, 'done', `Patch ${patch.id} verified`);
        return;
      }
    }

    setFindingState(finding.id, 'unverified');
    progress(finding.id, 'failed', lastLog);
  };

  let prescribeChain: Promise<void> = Promise.resolve();
  const prescribe = (findingId: string): Promise<void> => {
    const next = prescribeChain.then(() => doPrescribe(findingId));
    prescribeChain = next.catch(() => undefined);
    return next;
  };

  let tail: Promise<void> = Promise.resolve();

  const startRun = (req: RunCreateRequest): string => {
    const currentConfig = deps.getConfig ? deps.getConfig() : deps.config;
    if (
      req.mode === 'online' &&
      (!currentConfig.paypalClientId || !currentConfig.paypalClientSecret)
    ) {
      throw new Error('online mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
    }

    const projectId = req.projectId ?? 'builtin';
    if (deps.projectsRepo) {
      const project = deps.projectsRepo.getProject(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }
    }

    const id = deps.newId();
    const run: Run = {
      id,
      projectId,
      target: req.target,
      mode: req.mode,
      scenarioKeys: req.scenarios,
      status: 'queued',
      startedAt: deps.now().toISOString(),
    };
    deps.repos.insertRun(run);

    const task = async (): Promise<void> => {
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error('run timed out'));
          reject(new Error('run timed out'));
        }, timeoutMs);
        timer.unref();
      });

      try {
        await Promise.race([
          runDiagnose(
            { ...deps, config: currentConfig, emit, signal: controller.signal },
            { target: req.target, mode: req.mode, scenarios: req.scenarios, runId: id },
          ),
          timeoutPromise,
        ]);
      } catch (error) {
        await defaultChildRegistry.disposeAll();
        const current = deps.repos.getRun(id);
        if (current && current.status !== 'failed' && current.status !== 'completed') {
          const message = errorMessage(error);
          deps.repos.updateRun(id, {
            status: 'failed',
            completedAt: deps.now().toISOString(),
            error: message,
          });
          emit({ type: 'run.failed', runId: id, error: message });
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    tail = tail.then(task, task);
    return id;
  };

  const protect = async (runId: string): Promise<void> => {
    const run = deps.repos.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.target !== 'agent') throw new ProtectNotApplicableError(runId);
    if (!deps.protector) throw new ProtectNotConfiguredError();

    const before = deps.repos.listFindings(runId);
    await deps.protector(run, before);

    // Persist what the protector changed and emit the dashboard events (spec items 4-5).
    const previous = new Map(before.map((finding) => [finding.id, finding]));
    for (const finding of deps.repos.listFindings(runId)) {
      const prior = previous.get(finding.id);
      if (prior && prior.state === finding.state && prior.summary === finding.summary) continue;
      emit({ type: 'finding.updated', finding });
    }

    const score = computeScore(deps.repos.listFindings(runId));
    deps.repos.updateRun(runId, { scoreAfter: score.score });
    emit({ type: 'score.updated', score });
  };

  return {
    startRun,
    prescribe,
    protect,
    idle: () => Promise.all([tail, prescribeChain]).then(() => undefined),
  };
}
