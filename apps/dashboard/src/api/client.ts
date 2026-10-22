/// <reference types="vite/client" />
import {
  DecisionList,
  FindingDetail,
  Health,
  OpenPrResponse,
  PolicyResponse,
  RunCreateResponse,
  RunDetail,
  RunSummary,
  ScenarioInfo,
  StepList,
  type FirewallDecision,
  type RunCreateRequest,
  type RunSummary as RunSummaryType,
  type Step,
} from '@payclinic/contracts';

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
    const init: RequestInit = { method, headers: { accept: 'application/json' } };
    if (body !== undefined) {
      init.headers = { ...init.headers, 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const response = await fetchImpl(`${base}${path}`, init);
    if (!response.ok) {
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
  };
}

export const api = createApiClient(import.meta.env.VITE_API_URL ?? 'http://localhost:4001');
