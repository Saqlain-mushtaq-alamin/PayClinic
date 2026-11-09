import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Finding, FirewallDecision, Run, RunEvent } from '@payclinic/contracts';
import { API_BASE_URL } from './client';
import type { RunEventSourceLike } from './useRunEvents';
import { useProtect } from './useProtect';
import '../test-setup';

const instances: FakeEventSource[] = [];

class FakeEventSource implements RunEventSourceLike {
  readonly url: string;
  onopen: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data?: unknown }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    instances.push(this);
  }

  emit(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  close(): void {
    this.closed = true;
  }
}

const fakeRun: Run = {
  id: 'run-1',
  projectId: 'builtin',
  target: 'agent',
  mode: 'offline',
  scenarioKeys: ['A1', 'A2'],
  status: 'completed',
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
};

const fakeFinding: Finding = {
  id: 'fnd-1',
  runId: 'run-1',
  scenarioKey: 'A1',
  invariantKey: 'I-07',
  severity: 'high',
  state: 'protected',
  title: 'Spending limit exceeded',
  summary: 'Agent bypassed spending cap',
  evidenceStepIds: ['s1'],
  createdAt: new Date().toISOString(),
};

const fakeDecision: FirewallDecision = {
  id: 'dec-1',
  runId: 'run-1',
  action: 'allow',
  ruleId: null,
  reason: 'within cap',
  request: {
    tool: 'create_order',
    merchantId: 'merchant-1',
    sku: 'item-1',
    qty: 1,
    amount: '50.00',
    currency: 'USD',
  },
  ts: new Date().toISOString(),
};

function setup(protectImpl: () => Promise<{ accepted: true }> = async () => ({ accepted: true })) {
  const protect = vi.fn(protectImpl);
  const hook = renderHook(() =>
    useProtect('run-1', { client: { protect }, eventSourceCtor: FakeEventSource }),
  );
  return { protect, ...hook };
}

describe('useProtect', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('starts idle, calls protect and transitions to generating', () => {
    const { protect, result } = setup();

    expect(result.current.stage).toBe('idle');
    act(() => result.current.start());

    expect(protect).toHaveBeenCalledTimes(1);
    expect(protect).toHaveBeenCalledWith('run-1');
    expect(result.current.stage).toBe('generating');
    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toBe(`${API_BASE_URL}/api/runs/run-1/events`);
  });

  it('ignores replayed run.completed events from historical diagnose run', () => {
    const { result } = setup();
    act(() => result.current.start());
    const source = instances[0]!;

    const replayedCompleted: RunEvent = { type: 'run.completed', run: fakeRun };
    act(() => source.emit(JSON.stringify(replayedCompleted)));

    // Should NOT close or jump to done
    expect(result.current.stage).toBe('generating');
    expect(source.closed).toBe(false);
  });

  it('transitions from generating to rerunning on decision.recorded', () => {
    const { result } = setup();
    act(() => result.current.start());
    const source = instances[0]!;

    const decEvent: RunEvent = { type: 'decision.recorded', decision: fakeDecision };
    act(() => source.emit(JSON.stringify(decEvent)));

    expect(result.current.stage).toBe('rerunning');
    expect(result.current.decisions).toHaveLength(1);
  });

  it('transitions to verifying on finding.updated (open/patched) and done on protected', () => {
    const { result } = setup();
    act(() => result.current.start());
    const source = instances[0]!;

    const findingInProgress: Finding = { ...fakeFinding, state: 'patched' };
    act(() => source.emit(JSON.stringify({ type: 'finding.updated', finding: findingInProgress })));
    expect(result.current.stage).toBe('verifying');
    expect(source.closed).toBe(false);

    act(() => source.emit(JSON.stringify({ type: 'finding.updated', finding: fakeFinding })));
    expect(result.current.stage).toBe('done');
    expect(source.closed).toBe(true);
  });

  it('reports failed when client.protect rejects', async () => {
    const { result } = setup(async () => {
      throw new Error('Protect not applicable');
    });

    act(() => result.current.start());
    await waitFor(() => expect(result.current.stage).toBe('failed'));

    expect(result.current.message).toBe('Protect not applicable');
    expect(instances[0]!.closed).toBe(true);
  });
});
