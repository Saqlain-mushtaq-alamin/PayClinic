import type { Step } from '@payclinic/contracts';

const ORDER_ID = /ORD\d+/g;
const CAPTURE_ID = /CAP\d+/g;

interface IdState {
  orders: Map<string, string>;
  captures: Map<string, string>;
}

function placeholder(map: Map<string, string>, id: string, prefix: string): string {
  const existing = map.get(id);
  if (existing !== undefined) return existing;
  const next = `${prefix}_${map.size + 1}`;
  map.set(id, next);
  return next;
}

function replaceIdsInString(value: string, state: IdState): string {
  return value
    .replace(ORDER_ID, (id) => placeholder(state.orders, id, 'ORDER'))
    .replace(CAPTURE_ID, (id) => placeholder(state.captures, id, 'CAPTURE'));
}

function replaceIds(value: unknown, state: IdState): unknown {
  if (typeof value === 'string') return replaceIdsInString(value, state);
  if (Array.isArray(value)) return value.map((item) => replaceIds(item, state));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[replaceIdsInString(key, state)] = replaceIds(nested, state);
    }
    return out;
  }
  return value;
}

function pathOf(url: string): string {
  try {
    return new URL(url, 'http://payclinic.invalid').pathname;
  } catch {
    return url;
  }
}

/**
 * Turns recorded steps into deterministic evidence: only request/response data remains and
 * PayPal ids become stable placeholders so prompts do not depend on a particular run.
 */
export function normalizeEvidence(steps: Step[]): unknown[] {
  const state: IdState = { orders: new Map(), captures: new Map() };

  return steps.map((step, index) => ({
    n: index + 1,
    actor: step.actor,
    method: step.method,
    path: replaceIdsInString(pathOf(step.url), state),
    status: step.responseStatus,
    requestBody: replaceIds(step.requestBody, state),
    responseBody: replaceIds(step.responseBody, state),
  }));
}
