import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@payclinic/contracts';
import { API_BASE_URL } from './client';
import type { RunEventSourceLike } from './useRunEvents';
import { usePrescribe } from './usePrescribe';
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

type ProgressStage = Extract<RunEvent, { type: 'prescribe.progress' }>['stage'];

const progress = (findingId: string, stage: ProgressStage, message: string): RunEvent => ({
  type: 'prescribe.progress',
  findingId,
  stage,
  message,
});

function setup(
  prescribeImpl: () => Promise<{ accepted: true }> = async () => ({ accepted: true }),
) {
  const prescribe = vi.fn(prescribeImpl);
  const hook = renderHook(() =>
    usePrescribe('fnd-1', 'run-1', { client: { prescribe }, eventSourceCtor: FakeEventSource }),
  );
  return { prescribe, ...hook };
}

describe('usePrescribe', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('starts idle, posts once and reports explaining (P2-C03)', () => {
    const { prescribe, result } = setup();

    expect(result.current.stage).toBe('idle');
    act(() => result.current.start());

    expect(prescribe).toHaveBeenCalledTimes(1);
    expect(prescribe).toHaveBeenCalledWith('fnd-1');
    expect(result.current.stage).toBe('explaining');
    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toBe(`${API_BASE_URL}/api/runs/run-1/events`);
  });

  it('advances the stage and message from prescribe.progress events (P2-C03)', () => {
    const { result } = setup();
    act(() => result.current.start());
    const source = instances[0]!;

    act(() => source.emit(JSON.stringify(progress('fnd-1', 'patching', 'patching fnd-1'))));
    expect(result.current.stage).toBe('patching');
    expect(result.current.message).toBe('patching fnd-1');

    act(() => source.emit(JSON.stringify(progress('fnd-1', 'verifying', 'verifying fnd-1'))));
    expect(result.current.stage).toBe('verifying');
  });

  it('closes the stream when the stage is done (P2-C03)', () => {
    const { result } = setup();
    act(() => result.current.start());
    const source = instances[0]!;

    act(() => source.emit(JSON.stringify(progress('fnd-1', 'done', 'done fnd-1'))));

    expect(result.current.stage).toBe('done');
    expect(source.closed).toBe(true);
  });

  it('reports failed with the message and closes the stream (P2-C03)', () => {
    const { result } = setup();
    act(() => result.current.start());
    const source = instances[0]!;

    act(() => source.emit(JSON.stringify(progress('fnd-1', 'failed', 'no patch verified'))));

    expect(result.current.stage).toBe('failed');
    expect(result.current.message).toBe('no patch verified');
    expect(source.closed).toBe(true);
  });

  it('ignores progress events for other findings (P2-C03)', () => {
    const { result } = setup();
    act(() => result.current.start());
    const source = instances[0]!;

    act(() => source.emit(JSON.stringify(progress('fnd-other', 'done', 'done fnd-other'))));

    expect(result.current.stage).toBe('explaining');
    expect(source.closed).toBe(false);
  });

  it('marks failed when the POST itself rejects (P2-C03)', async () => {
    const { prescribe, result } = setup(async () => {
      throw new Error('prescribe is offline');
    });

    act(() => result.current.start());
    await waitFor(() => expect(result.current.stage).toBe('failed'));

    expect(prescribe).toHaveBeenCalledTimes(1);
    expect(result.current.message).toBe('prescribe is offline');
    expect(instances[0]!.closed).toBe(true);
  });

  it('retries after a failure by posting again and reopening the stream (P2-C03)', () => {
    const { prescribe, result } = setup();
    act(() => result.current.start());
    act(() => instances[0]!.emit(JSON.stringify(progress('fnd-1', 'failed', 'no patch verified'))));
    expect(result.current.stage).toBe('failed');

    act(() => result.current.start());

    expect(prescribe).toHaveBeenCalledTimes(2);
    expect(result.current.stage).toBe('explaining');
    expect(instances).toHaveLength(2);
    expect(instances[1]!.closed).toBe(false);
  });

  it('does nothing without a run id (P2-C03)', () => {
    const prescribe = vi.fn(async () => ({ accepted: true as const }));
    const { result } = renderHook(() =>
      usePrescribe('fnd-1', '', { client: { prescribe }, eventSourceCtor: FakeEventSource }),
    );

    act(() => result.current.start());

    expect(prescribe).not.toHaveBeenCalled();
    expect(result.current.stage).toBe('idle');
    expect(instances).toHaveLength(0);
  });
});
