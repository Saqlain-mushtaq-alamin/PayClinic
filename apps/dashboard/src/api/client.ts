/// <reference types="vite/client" />
import {
  AuthStatusResponse,
  DecisionList,
  FindingDetail,
  Health,
  OpenPrResponse,
  PolicyResponse,
  RunCreateResponse,
  RunDetail,
  RunSummary,
  ScenarioInfo,
  SettingsResponse,
  StepList,
  TestSettingsResponse,
  type FirewallDecision,
  type RunCreateRequest,
  type RunSummary as RunSummaryType,
  type Step,
} from '@payclinic/contracts';

let currentAdminToken: string | null = null;
const authListeners = new Set<() => void>();

export function setAdminToken(token: string | null): void {
  currentAdminToken = token;
}

export function getAdminToken(): string | null {
  return currentAdminToken;
}

export function onAuthRequired(listener: () => void): () => void {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
}

interface Schema<T> {
  parse(value: unknown): T;
}

interface AcceptedResponse {
  accepted: true;
}

const Accepted: Schema<AcceptedResponse> = {
  parse(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as { accepted?: unknown }).accepted !== true
    ) {
      throw new Error('invalid accepted response');
    }
    return { accepted: true };
  },
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiClient {
  health(): Promise<Health>;
  listRuns(): Promise<RunSummaryType[]>;
  createRun(body: RunCreateRequest): Promise<RunCreateResponse>;
  getRun(id: string): Promise<RunDetail>;
  getSteps(id: string, scenarioId?: string): Promise<Step[]>;
  getFinding(id: string): Promise<FindingDetail>;
  prescribe(id: string): Promise<AcceptedResponse>;
  openPr(id: string): Promise<OpenPrResponse>;
  protect(id: string): Promise<AcceptedResponse>;
  getPolicy(id: string): Promise<PolicyResponse>;
  getDecisions(id: string): Promise<FirewallDecision[]>;
  getScenarios(): Promise<ScenarioInfo[]>;
  getSettings(): Promise<SettingsResponse>;
  saveSettings(updates: Record<string, string | null>): Promise<SettingsResponse>;
  testSetting(kind: 'paypal' | 'gemini' | 'github'): Promise<TestSettingsResponse>;
  getAuthStatus(): Promise<AuthStatusResponse>;
}

/**
 * HTTP client for the PayClinic REST contract. Parses every body with the contract
 * schema and throws ApiError on non-2xx responses.
 */
export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ApiClient {
  const base = baseUrl.replace(/\/+$/, '');

  const request = async <T>(
    method: string,
    path: string,
    schema: Schema<T>,
    body?: unknown,
  ): Promise<T> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (currentAdminToken) {
      headers.authorization = `Bearer ${currentAdminToken}`;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const init: RequestInit = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };

    const response = await fetchImpl(`${base}${path}`, init);
    if (!response.ok) {
      if (response.status === 401) {
        for (const listener of authListeners) {
          listener();
        }
      }
      let message = `${method} ${path} failed with status ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload?.error === 'string') message = payload.error;
      } catch {
        // keep the status-based message when the body is not JSON
      }
      throw new ApiError(message, response.status);
    }
    return schema.parse(await response.json());
  };

  return {
    health: () => request('GET', '/api/health', Health),
    listRuns: () => request('GET', '/api/runs', RunSummary.array()),
    createRun: (body) => request('POST', '/api/runs', RunCreateResponse, body),
    getRun: (id) => request('GET', `/api/runs/${encodeURIComponent(id)}`, RunDetail),
    getSteps: (id, scenarioId) =>
      request(
        'GET',
        `/api/runs/${encodeURIComponent(id)}/steps${
          scenarioId ? `?scenarioId=${encodeURIComponent(scenarioId)}` : ''
        }`,
        StepList,
      ),
    getFinding: (id) => request('GET', `/api/findings/${encodeURIComponent(id)}`, FindingDetail),
    prescribe: (id) =>
      request('POST', `/api/findings/${encodeURIComponent(id)}/prescribe`, Accepted),
    openPr: (id) =>
      request('POST', `/api/findings/${encodeURIComponent(id)}/open-pr`, OpenPrResponse),
    protect: (id) => request('POST', `/api/runs/${encodeURIComponent(id)}/protect`, Accepted),
    getPolicy: (id) => request('GET', `/api/runs/${encodeURIComponent(id)}/policy`, PolicyResponse),
    getDecisions: (id) =>
      request('GET', `/api/runs/${encodeURIComponent(id)}/decisions`, DecisionList),
    getScenarios: () => request('GET', '/api/scenarios', ScenarioInfo.array()),
    getSettings: () => request('GET', '/api/settings', SettingsResponse),
    saveSettings: (updates) => request('PUT', '/api/settings', SettingsResponse, updates),
    testSetting: (kind) =>
      request('POST', `/api/settings/test/${encodeURIComponent(kind)}`, TestSettingsResponse),
    getAuthStatus: () => request('GET', '/api/auth/status', AuthStatusResponse),
  };
}

/**
 * Base URL the dashboard talks to. Same origin by default (the API serves the
 * built dashboard); the mock dev flow sets VITE_API_URL via `--mode mock`.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export const api = createApiClient(API_BASE_URL);
