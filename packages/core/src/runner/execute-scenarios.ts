import { createInterface } from 'node:readline/promises';
import { MerchantOrder, Product, SCENARIO_META, WebhookDelivery } from '@payclinic/contracts';
import type {
  InvariantResult,
  Product as ProductModel,
  RunState,
  ScenarioKey,
  ScenarioStatus,
  Step,
} from '@payclinic/contracts';
import { startSim } from '@payclinic/sim';
import type { Config } from '../config';
import { INVARIANTS, runInvariants } from '../invariants';
import { createRecorder, type StepRecorder } from '../trace/recorder';
import { startTraceProxy, type TraceProxy } from '../trace/proxy';
import { createManualApprover, createSimApprover, type BuyerApprover } from './approvers';
import { buildContext, createRecordedHttp, type RecordedHttp, type ScenarioFn } from './context';
import { startStore, type RunningStore, type StartStoreOptions } from './store-process';

export type StoreFactory = (opts: StartStoreOptions) => Promise<RunningStore>;

export interface ExecuteScenariosEnv {
  config: Config;
  scenarios: Partial<Record<ScenarioKey, ScenarioFn>>;
  storeSourceDir: string;
  newId: () => string;
  now: () => Date;
  scenarioTimeoutMs?: number;
  runId: string;
  storeFactory?: StoreFactory;
  onStep?: (step: Step) => void;
  onScenarioStart?: (key: ScenarioKey, scenarioId: string) => void | Promise<void>;
  onScenario?: (
    key: ScenarioKey,
    info: {
      scenarioId: string;
      status: ScenarioStatus;
      error?: string;
      steps: Step[];
      state: RunState;
      results: InvariantResult[];
    },
  ) => void | Promise<void>;
}

export interface ExecutedScenario {
  key: ScenarioKey;
  scenarioId: string;
  status: ScenarioStatus;
  error?: string;
  steps: Step[];
  state: RunState;
  results: InvariantResult[];
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

function emptyState(): RunState {
  return { carts: [], merchantOrders: [], webhookDeliveries: [], forgedDeliveryIds: [] };
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

/** Runs scenarios without touching the database, starting and stopping all child processes. */
export async function executeScenarios(
  env: ExecuteScenariosEnv,
  keys: ScenarioKey[],
): Promise<ExecutedScenario[]> {
  const recorder = createRecorder({ runId: env.runId, newId: env.newId, now: env.now });
  recorder.onStep((step) => env.onStep?.(step));
  const launch = env.storeFactory ?? startStore;

  let sim: Awaited<ReturnType<typeof startSim>> | undefined;
  let proxy: TraceProxy | undefined;
  let store: RunningStore | undefined;
  let http: RecordedHttp | undefined;
  let approver: BuyerApprover | undefined;
  let catalog: ProductModel[] = [];
  const executed: ExecutedScenario[] = [];

  const createApprover = (httpClient: RecordedHttp): BuyerApprover => {
    if (sim) return createSimApprover({ simUrl: sim.url, http: httpClient });
    if (env.config.buyerApprover === 'manual') {
      return createManualApprover({ ask: askInTerminal });
    }
    throw new DiagnoseError(
      `Buyer approver "${env.config.buyerApprover}" is not available for this run`,
    );
  };

  const launchStore = async (): Promise<void> => {
    if (!proxy) throw new DiagnoseError('Trace proxy is not running');
    const running = await launch({
      sourceDir: env.storeSourceDir,
      paypalBaseUrl: proxy.url,
      paypalClientId: env.config.paypalClientId,
      paypalClientSecret: env.config.paypalClientSecret,
    });
    store = running;
    http = createRecordedHttp({ recorder, baseUrl: running.url });
    approver = createApprover(http);
  };

  const drain = (recorderRef: StepRecorder): Step[] => recorderRef.drain();

  try {
    if (env.config.mode === 'offline') {
      sim = await startSim();
    } else if (!env.config.paypalBaseUrl) {
      throw new DiagnoseError('Online mode requires PAYPAL_BASE_URL');
    }

    const paypalTarget = sim?.url ?? env.config.paypalBaseUrl;
    if (!paypalTarget) throw new DiagnoseError('No PayPal target is available');
    proxy = await startTraceProxy({ target: paypalTarget, recorder });
    await launchStore();

    if (!store || !http || !approver) throw new DiagnoseError('Store did not start');
    catalog = Product.array().parse(await fetchJson(`${store.url}/api/products`));

    const timeoutMs = env.scenarioTimeoutMs ?? 60_000;

    for (const key of keys) {
      const scenarioFn = env.scenarios[key];
      if (!scenarioFn) throw new DiagnoseError(`No scenario registered for ${key}`);

      const scenarioId = env.newId();
      await env.onScenarioStart?.(key, scenarioId);

      let status: ScenarioStatus;
      let error: string | undefined;
      let state = emptyState();
      let results: InvariantResult[] = [];

      try {
        if (sim) await fetchJson(`${sim.url}/__sim/reset`, { method: 'POST' });
        if (!store) throw new DiagnoseError('Store is not running');
        await fetchJson(`${store.url}/__admin/reset`, { method: 'POST' });

        if (!proxy) throw new DiagnoseError('Trace proxy is not running');
        proxy.setScenario({ runId: env.runId, scenarioId });

        const ctx = buildContext({
          runId: env.runId,
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
        state = {
          carts: declared.carts,
          merchantOrders: MerchantOrder.array().parse(adminState.merchantOrders),
          webhookDeliveries: WebhookDelivery.array().parse(adminState.webhookDeliveries),
          forgedDeliveryIds: declared.forgedDeliveryIds,
        };

        const invariantKeys = SCENARIO_META[key].invariantKeys.filter(
          (invariantKey) => INVARIANTS[invariantKey] !== undefined,
        );
        const scenarioSteps = drain(recorder);
        results = runInvariants(invariantKeys, { trace: scenarioSteps, state });
        status = results.some((result) => !result.passed) ? 'failed' : 'passed';

        const info = { scenarioId, status, steps: scenarioSteps, state, results };
        await env.onScenario?.(key, info);
        executed.push({ key, ...info });
      } catch (caught) {
        const timedOut = caught instanceof ScenarioTimeoutError;
        try {
          if (timedOut) {
            if (store) await store.stop();
            await launchStore();
          }
        } finally {
          const steps = drain(recorder);
          error = errorMessage(caught);
          const info = { scenarioId, status: 'error' as const, error, steps, state, results };
          await env.onScenario?.(key, info);
          executed.push({ key, ...info });
        }
      }
    }

    return executed;
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
