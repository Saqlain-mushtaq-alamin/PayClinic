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
import { startSim } from '@payclinic/sim';
import type { ProjectRow } from '../db/projects-repo';
import { computeScore } from '../score';
import { executeScenarios } from '../runner/execute-scenarios';
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
      progress(finding.id, 'failed', result.explanation?.fixSummary || 'No patches were returned');
      return;
    }

    const project = run.projectId ? deps.projectsRepo?.getProject(run.projectId) : null;
    const isRemote = project?.kind === 'remote';

    if (isRemote) {
      for (const patch of result.patches) {
        deps.repos.insertPatch(patch);
      }
      setFindingState(finding.id, 'patched');
      progress(finding.id, 'done', 'Patch generated. Needs review.');
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
  let activeSim: Awaited<ReturnType<typeof startSim>> | null = null;
  const getSimUrl = async (): Promise<string> => {
    if (deps.getSimUrl) return deps.getSimUrl();
    if (!activeSim) {
      activeSim = await startSim();
    }
    return activeSim.url;
  };

  const startRun = (req: RunCreateRequest): string => {
    const currentConfig = deps.getConfig ? deps.getConfig() : deps.config;
    if (
      req.mode === 'online' &&
      (!currentConfig.paypalClientId || !currentConfig.paypalClientSecret)
    ) {
      throw new Error('online mode requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
    }

    const projectId = req.projectId ?? 'builtin';
    let project: ProjectRow | null = null;
    if (deps.projectsRepo) {
      project = deps.projectsRepo.getProject(projectId);
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }
    }

    if (project && project.kind === 'remote') {
      // 3. Only store scenarios B1-B5 (and optional B6) are allowed for remote projects. Reject A1/A2 with a clear error.
      if (req.target === 'agent') {
        throw new Error(
          'Remote projects only support store scenarios (B1-B5, B6). Agent attacks (A1, A2) are not supported.',
        );
      }
      const disallowed = req.scenarios.filter((k) => k === 'A1' || k === 'A2');
      if (disallowed.length > 0) {
        throw new Error(
          `Remote projects only support store scenarios (B1-B5, B6). Agent scenarios (${disallowed.join(', ')}) are not supported.`,
        );
      }

      // 2. Run lock: only one run per remote project at a time (queue or reject with a clear message)
      const runs = deps.repos.listRuns();
      const activeOrQueued = runs.find(
        (r) => (r.status === 'running' || r.status === 'queued') && r.projectId === projectId,
      );
      if (activeOrQueued) {
        throw new Error(
          `A run is already active or queued for project '${project.name}' (${activeOrQueued.id}). Please wait for it to complete.`,
        );
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
            { ...deps, getSimUrl, config: currentConfig, emit, signal: controller.signal },
            {
              target: req.target,
              mode: req.mode,
              scenarios: req.scenarios,
              runId: id,
              projectId,
            },
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

  const retest = async (
    projectId: string,
    runId: string,
  ): Promise<{ ok: boolean; score: number; findings: Finding[] }> => {
    const project = deps.projectsRepo?.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const run = deps.repos.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    deps.repos.updateRun(run.id, { status: 'running' });

    try {
      const simUrl = await getSimUrl();
      const currentConfig = deps.getConfig ? deps.getConfig() : deps.config;
      const executed = await executeScenarios(
        {
          config: currentConfig,
          getConfig: deps.getConfig,
          scenarios: deps.scenarios,
          storeSourceDir: deps.storeSourceDir,
          newId: deps.newId,
          now: deps.now,
          simUrl,
          runId: run.id,
          project:
            project.kind === 'remote'
              ? {
                  id: project.id,
                  name: project.name,
                  kind: project.kind,
                  baseUrl: project.baseUrl,
                  base_url: project.baseUrl,
                  adminSecretEncrypted: project.adminSecretEncrypted,
                  admin_secret_encrypted: project.adminSecretEncrypted,
                  proxyToken: project.proxyToken,
                  proxy_token: project.proxyToken,
                }
              : undefined,
          repos: deps.repos,
          onStep: (step) => emit({ type: 'step.recorded', step }),
          onScenarioStart: (key, scenarioId) => {
            const scenario: ScenarioResult = {
              id: scenarioId,
              runId: run.id,
              key,
              status: 'running',
              startedAt: deps.now().toISOString(),
            };
            deps.repos.insertScenario(scenario);
            emit({ type: 'scenario.started', scenario });
          },
          onScenario: async (key, info) => {
            const existingStepIds = new Set(
              deps.repos.listSteps(run.id, info.scenarioId).map((s) => s.id),
            );
            const newSteps = info.steps.filter((s) => !existingStepIds.has(s.id));
            if (newSteps.length > 0) {
              deps.repos.insertSteps(newSteps);
            }
            deps.repos.updateScenario(info.scenarioId, {
              status: info.status,
              finishedAt: deps.now().toISOString(),
            });
          },
        },
        run.scenarioKeys,
      );

      const priorFindings = deps.repos.listFindings(run.id);
      for (const prior of priorFindings) {
        const scenario = executed.find((s) => s.key === prior.scenarioKey);
        const inv = scenario?.results.find((r) => r.key === prior.invariantKey);
        if (inv && inv.passed) {
          setFindingState(prior.id, 'verified');
        }
      }

      const updatedFindings = deps.repos.listFindings(run.id);
      const score = computeScore(updatedFindings);
      deps.repos.updateRun(run.id, {
        status: 'completed',
        completedAt: deps.now().toISOString(),
        scoreAfter: score.score,
      });
      emit({ type: 'score.updated', score });

      return { ok: true, score: score.score, findings: updatedFindings };
    } finally {
      const current = deps.repos.getRun(run.id);
      if (current && current.status === 'running') {
        const score = computeScore(deps.repos.listFindings(run.id));
        deps.repos.updateRun(run.id, {
          status: 'completed',
          completedAt: deps.now().toISOString(),
          scoreAfter: score.score,
        });
      }
    }
  };

  return {
    startRun,
    prescribe,
    protect,
    retest,
    idle: () => Promise.all([tail, prescribeChain]).then(() => undefined),
    getSimUrl,
  };
}
