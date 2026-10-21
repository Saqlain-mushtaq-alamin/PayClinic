import { createInterface } from 'node:readline/promises';
import { MerchantOrder, Product, SCENARIO_META, WebhookDelivery } from '@payclinic/contracts';
import type {
  Finding,
  Product as ProductModel,
  Run,
  RunEvent,
  RunMode,
  RunState,
  ScenarioKey,
  ScenarioResult,
  Score,
} from '@payclinic/contracts';
import { startSim } from '@payclinic/sim';
import type { Config } from '../config';
import type { Repos } from '../db/repos';
import { findingsFromResults } from '../findings';
import { INVARIANTS, runInvariants } from '../invariants';
import { computeScore } from '../score';
import { createRecorder } from '../trace/recorder';
import { startTraceProxy, type TraceProxy } from '../trace/proxy';
import { createManualApprover, createSimApprover, type BuyerApprover } from './approvers';
import { buildContext, createRecordedHttp, type RecordedHttp, type ScenarioFn } from './context';
import { startStore, type RunningStore } from './store-process';

export interface DiagnoseDeps {
  repos: Repos;
  config: Config;
  scenarios: Partial<Record<ScenarioKey, ScenarioFn>>;
  storeSourceDir: string;
  newId: () => string;
  now: () => Date;
  emit?: (e: RunEvent) => void;
  scenarioTimeoutMs?: number;
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

export class DiagnoseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagnoseError';
  }
}

class ScenarioTimeoutError extends Error {
  constructor(key: ScenarioKey, timeoutMs: number) {
    super(`Scenario ${key} timed out after ${timeoutMs} ms`);
    this.name = 'ScenarioTimeoutError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new DiagnoseError(
      `Request ${init?.method ?? 'GET'} ${url} failed with ${response.status}` +
        (text === '' ? '' : `: ${text}`),
    );
  }
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function askInTerminal(url: string): Promise<void> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await readline.question(`Approve the PayPal order at ${url}\nPress Enter when approved.`);
  } finally {
    readline.close();
  }
}

function withTimeout<T>(promise: Promise<T>, key: ScenarioKey, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ScenarioTimeoutError(key, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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

  const recorder = createRecorder({ runId, newId: deps.newId, now: deps.now });
  recorder.onStep((step) => deps.emit?.({ type: 'step.recorded', step }));

  let sim: Awaited<ReturnType<typeof startSim>> | undefined;
  let proxy: TraceProxy | undefined;
  let store: RunningStore | undefined;
  let http: RecordedHttp | undefined;
  let approver: BuyerApprover | undefined;
  let catalog: ProductModel[] = [];
  const findings: Finding[] = [];

  const createApprover = (httpClient: RecordedHttp): BuyerApprover => {
    if (sim) return createSimApprover({ simUrl: sim.url, http: httpClient });
    if (deps.config.buyerApprover === 'manual') {
      return createManualApprover({ ask: askInTerminal });
    }
    throw new DiagnoseError(
      `Buyer approver "${deps.config.buyerApprover}" is not available for this run`,
    );
  };

  const launchStore = async (): Promise<void> => {
    if (!proxy) throw new DiagnoseError('Trace proxy is not running');
    const running = await startStore({
      sourceDir: deps.storeSourceDir,
      paypalBaseUrl: proxy.url,
      paypalClientId: deps.config.paypalClientId,
      paypalClientSecret: deps.config.paypalClientSecret,
    });
    store = running;
    http = createRecordedHttp({ recorder, baseUrl: running.url });
    approver = createApprover(http);
  };

  try {
    if (req.mode === 'offline') {
      sim = await startSim();
    } else if (!deps.config.paypalBaseUrl) {
      throw new DiagnoseError('Online mode requires PAYPAL_BASE_URL');
    }

    const paypalTarget = sim?.url ?? deps.config.paypalBaseUrl;
    if (!paypalTarget) throw new DiagnoseError('No PayPal target is available');
    proxy = await startTraceProxy({ target: paypalTarget, recorder });
    await launchStore();

    if (!store || !http || !approver) throw new DiagnoseError('Store did not start');
    catalog = Product.array().parse(await fetchJson(`${store.url}/api/products`));

    const timeoutMs = deps.scenarioTimeoutMs ?? 60_000;

    for (const key of req.scenarios) {
      const scenarioFn = deps.scenarios[key];
      if (!scenarioFn) throw new DiagnoseError(`No scenario registered for ${key}`);

      const scenario: ScenarioResult = {
        id: deps.newId(),
        runId,
        key,
        status: 'running',
        startedAt: deps.now().toISOString(),
      };
      deps.repos.insertScenario(scenario);
      deps.emit?.({ type: 'scenario.started', scenario });

      try {
        if (sim) await fetchJson(`${sim.url}/__sim/reset`, { method: 'POST' });
        if (!store) throw new DiagnoseError('Store is not running');
        await fetchJson(`${store.url}/__admin/reset`, { method: 'POST' });

        if (!proxy) throw new DiagnoseError('Trace proxy is not running');
        proxy.setScenario({ runId, scenarioId: scenario.id });

        const ctx = buildContext({
          runId,
          scenarioKey: key,
          storeUrl: store.url,
          catalog,
          http,
          approver,
          chaos: {
            mockNext: (rule) => proxy!.mockNext(rule),
            clear: () => proxy!.clearMocks(),
          },
        });

        await withTimeout(scenarioFn(ctx), key, timeoutMs);

        const adminState = asRecord(await fetchJson(`${store.url}/__admin/state`));
        if (!adminState) throw new DiagnoseError('Store admin state was not an object');

        const declared = ctx.getDeclared();
        const state: RunState = {
          carts: declared.carts,
          merchantOrders: MerchantOrder.array().parse(adminState.merchantOrders),
          webhookDeliveries: WebhookDelivery.array().parse(adminState.webhookDeliveries),
          forgedDeliveryIds: declared.forgedDeliveryIds,
        };

        const invariantKeys = SCENARIO_META[key].invariantKeys.filter(
          (invariantKey) => INVARIANTS[invariantKey] !== undefined,
        );
        const results = runInvariants(invariantKeys, { trace: recorder.steps(), state });

        deps.repos.insertSteps(recorder.drain());
        deps.repos.insertInvariantResults(runId, scenario.id, results);

        const scenarioFindings = findingsFromResults({
          runId,
          scenarioKey: key,
          results,
          newId: deps.newId,
          now: () => deps.now().toISOString(),
        });
        for (const finding of scenarioFindings) {
          deps.repos.insertFinding(finding);
          findings.push(finding);
          deps.emit?.({ type: 'finding.created', finding });
        }

        const status = results.some((result) => !result.passed) ? 'failed' : 'passed';
        const finishedAt = deps.now().toISOString();
        const finished: ScenarioResult = { ...scenario, status, finishedAt };
        deps.repos.updateScenario(scenario.id, { status, finishedAt });
        deps.emit?.({ type: 'scenario.finished', scenario: finished });
      } catch (error) {
        const timedOut = error instanceof ScenarioTimeoutError;
        try {
          if (timedOut) {
            if (store) await store.stop();
            await launchStore();
          }
        } finally {
          deps.repos.insertSteps(recorder.drain());
          const finishedAt = deps.now().toISOString();
          const message = errorMessage(error);
          const finished: ScenarioResult = {
            ...scenario,
            status: 'error',
            finishedAt,
            error: message,
          };
          deps.repos.updateScenario(scenario.id, { status: 'error', finishedAt, error: message });
          deps.emit?.({ type: 'scenario.finished', scenario: finished });
        }
      }
    }

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
  } finally {
    try {
      if (store) await store.stop();
    } finally {
      try {
        if (proxy) await proxy.stop();
      } finally {
        if (sim) await sim.close();
      }
    }
  }
}
