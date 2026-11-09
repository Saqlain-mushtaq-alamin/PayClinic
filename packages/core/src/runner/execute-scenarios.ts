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
import type { Repos } from '../db/repos';
import { INVARIANTS, runInvariants } from '../invariants';
import { decrypt } from '../settings/crypto';
import { createRecorder, type StepRecorder } from '../trace/recorder';
import {
  clearProxyMockRules,
  setProxyMockRule,
  startTraceProxy,
  type TraceProxy,
} from '../trace/proxy';
import { createApprover as selectApprover, type BuyerApprover } from './approvers';
import { buildContext, createRecordedHttp, type RecordedHttp, type ScenarioFn } from './context';
import { startStore, type RunningStore, type StartStoreOptions } from './store-process';
import { assertSafeTarget } from './target-guard';

export type StoreFactory = (opts: StartStoreOptions) => Promise<RunningStore>;

export interface RemoteProjectTarget {
  id: string;
  name?: string;
  kind: 'builtin' | 'remote';
  baseUrl?: string | null;
  base_url?: string | null;
  adminSecret?: string | null;
  adminSecretEncrypted?: string | null;
  admin_secret_encrypted?: string | null;
  proxyToken?: string;
  proxy_token?: string;
}

export interface ExecuteScenariosEnv {
  config: Config;
  getConfig?: () => Config;
  scenarios: Partial<Record<ScenarioKey, ScenarioFn>>;
  storeSourceDir: string;
  newId: () => string;
  now: () => Date;
  scenarioTimeoutMs?: number;
  runId: string;
  signal?: AbortSignal;
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
  project?: RemoteProjectTarget | null;
  repos?: Repos;
  simUrl?: string | (() => Promise<string>);
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

function withTimeout<T>(
  promise: Promise<T>,
  key: ScenarioKey,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error(String(signal.reason ?? 'aborted')),
      );
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error(String(signal?.reason ?? 'aborted')),
      );
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      reject(new ScenarioTimeoutError(key, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
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
  const config = env.getConfig ? env.getConfig() : env.config;

  const isRemote = env.project?.kind === 'remote';

  let sim: Awaited<ReturnType<typeof startSim>> | undefined;
  let proxy: TraceProxy | undefined;
  let store: RunningStore | undefined;
  let http: RecordedHttp | undefined;
  let approver: BuyerApprover | undefined;
  let catalog: ProductModel[] = [];
  const executed: ExecutedScenario[] = [];

  const createApprover = (httpClient: RecordedHttp, approverSimUrl?: string): BuyerApprover =>
    selectApprover({
      config,
      http: httpClient,
      ...(approverSimUrl === undefined ? {} : { simUrl: approverSimUrl }),
      ask: askInTerminal,
      buyerEmail: process.env.PAYPAL_BUYER_EMAIL,
      buyerPassword: process.env.PAYPAL_BUYER_PASSWORD,
    });

  const launchStore = async (): Promise<void> => {
    if (!proxy) throw new DiagnoseError('Trace proxy is not running');
    const running = await launch({
      sourceDir: env.storeSourceDir,
      paypalBaseUrl: proxy.url,
      paypalClientId: config.paypalClientId,
      paypalClientSecret: config.paypalClientSecret,
    });
    store = running;
    http = createRecordedHttp({ recorder, baseUrl: running.url });
    approver = createApprover(http, sim?.url);
  };

  const drain = (recorderRef: StepRecorder): Step[] => recorderRef.drain();

  let adminHeaders: Record<string, string> = {};
  let remoteStoreUrl: string | undefined;
  let activeSimUrl: string | undefined;

  try {
    if (isRemote) {
      const rawBaseUrl = env.project?.baseUrl ?? env.project?.base_url;
      if (!rawBaseUrl) throw new DiagnoseError('Remote project has no base URL configured');
      await assertSafeTarget(rawBaseUrl);
      remoteStoreUrl = rawBaseUrl.replace(/\/+$/, '');

      let adminSecret = env.project?.adminSecret ?? '';
      if (!adminSecret) {
        const enc = env.project?.adminSecretEncrypted ?? env.project?.admin_secret_encrypted;
        if (enc) {
          try {
            adminSecret = decrypt(enc);
          } catch {
            adminSecret = '';
          }
        }
      }
      if (adminSecret) {
        adminHeaders = { 'x-payclinic-admin': adminSecret };
      }

      if (config.mode === 'offline') {
        if (env.simUrl) {
          activeSimUrl = typeof env.simUrl === 'function' ? await env.simUrl() : env.simUrl;
        } else {
          sim = await startSim();
          activeSimUrl = sim.url;
        }
      }

      http = createRecordedHttp({ recorder, baseUrl: remoteStoreUrl });
      approver = createApprover(http, activeSimUrl);

      try {
        catalog = Product.array().parse(await fetchJson(`${remoteStoreUrl}/api/products`));
      } catch {
        catalog = [];
      }
    } else {
      if (config.mode === 'offline') {
        sim = await startSim();
        activeSimUrl = sim.url;
      } else if (!config.paypalBaseUrl) {
        throw new DiagnoseError('Online mode requires PAYPAL_BASE_URL');
      }

      const paypalTarget = sim?.url ?? config.paypalBaseUrl;
      if (!paypalTarget) throw new DiagnoseError('No PayPal target is available');
      proxy = await startTraceProxy({ target: paypalTarget, recorder });
      await launchStore();

      if (!store || !http || !approver) throw new DiagnoseError('Store did not start');
      catalog = Product.array().parse(await fetchJson(`${store.url}/api/products`));
    }

    const effectiveStoreUrl = isRemote ? remoteStoreUrl! : store!.url;
    const timeoutMs = env.scenarioTimeoutMs ?? 60_000;

    for (const key of keys) {
      if (env.signal?.aborted) {
        throw env.signal.reason instanceof Error
          ? env.signal.reason
          : new Error(String(env.signal.reason ?? 'aborted'));
      }
      const scenarioFn = env.scenarios[key];
      if (!scenarioFn) throw new DiagnoseError(`No scenario registered for ${key}`);

      const scenarioId = env.newId();
      await env.onScenarioStart?.(key, scenarioId);

      let status: ScenarioStatus;
      let error: string | undefined;
      let state = emptyState();
      let results: InvariantResult[] = [];

      try {
        if (activeSimUrl) await fetchJson(`${activeSimUrl}/__sim/reset`, { method: 'POST' });
        recorder.setScenario(scenarioId);
        if (!isRemote) {
          if (!store) throw new DiagnoseError('Store is not running');
          await fetchJson(`${store.url}/__admin/reset`, { method: 'POST' });

          if (!proxy) throw new DiagnoseError('Trace proxy is not running');
          proxy.setScenario({ runId: env.runId, scenarioId });
        } else {
          await fetchJson(`${effectiveStoreUrl}/__admin/reset`, {
            method: 'POST',
            headers: adminHeaders,
          });
        }

        const ctx = buildContext({
          runId: env.runId,
          scenarioKey: key,
          storeUrl: effectiveStoreUrl,
          catalog,
          http: http!,
          approver: approver!,
          chaos: {
            mockNext: (rule) => {
              if (proxy) proxy.mockNext(rule);
              else setProxyMockRule(env.runId, rule);
            },
            clear: () => {
              if (proxy) proxy.clearMocks();
              else clearProxyMockRules(env.runId);
            },
          },
          now: () => env.now().getTime(),
        });

        await withTimeout(scenarioFn(ctx), key, timeoutMs, env.signal);

        const adminState = asRecord(
          await fetchJson(`${effectiveStoreUrl}/__admin/state`, { headers: adminHeaders }),
        );
        if (!adminState) throw new DiagnoseError('Store admin state was not an object');

        const declared = ctx.getDeclared();
        state = {
          carts: declared.carts,
          merchantOrders: MerchantOrder.array().parse(adminState.merchantOrders),
          webhookDeliveries: WebhookDelivery.array().parse(adminState.webhookDeliveries),
          forgedDeliveryIds: declared.forgedDeliveryIds,
          ...(declared.agent === undefined ? {} : { agent: declared.agent }),
        };

        const invariantKeys = SCENARIO_META[key].invariantKeys.filter(
          (invariantKey) => INVARIANTS[invariantKey] !== undefined,
        );

        const runnerSteps = drain(recorder);
        const proxySteps = isRemote && env.repos ? env.repos.listSteps(env.runId, scenarioId) : [];
        const runnerIds = new Set(runnerSteps.map((s) => s.id));
        const scenarioSteps = [
          ...runnerSteps,
          ...proxySteps.filter((s) => !runnerIds.has(s.id)),
        ].sort((a, b) => a.seq - b.seq);

        results = runInvariants(invariantKeys, { trace: scenarioSteps, state });
        status = results.some((result) => !result.passed) ? 'failed' : 'passed';

        const info = { scenarioId, status, steps: scenarioSteps, state, results };
        await env.onScenario?.(key, info);
        executed.push({ key, ...info });
      } catch (caught) {
        if (env.signal?.aborted) {
          throw caught;
        }
        const timedOut = caught instanceof ScenarioTimeoutError;
        try {
          if (timedOut && !isRemote) {
            if (store) await store.stop();
            await launchStore();
          }
        } finally {
          clearProxyMockRules(env.runId);
          const runnerSteps = drain(recorder);
          const proxySteps =
            isRemote && env.repos ? env.repos.listSteps(env.runId, scenarioId) : [];
          const runnerIds = new Set(runnerSteps.map((s) => s.id));
          const steps = [...runnerSteps, ...proxySteps.filter((s) => !runnerIds.has(s.id))].sort(
            (a, b) => a.seq - b.seq,
          );
          error = errorMessage(caught);
          const info = { scenarioId, status: 'error' as const, error, steps, state, results };
          await env.onScenario?.(key, info);
          executed.push({ key, ...info });
        }
      } finally {
        clearProxyMockRules(env.runId);
      }
    }

    return executed;
  } finally {
    clearProxyMockRules(env.runId);
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
