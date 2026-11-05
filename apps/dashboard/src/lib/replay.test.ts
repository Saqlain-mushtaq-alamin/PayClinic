import { describe, expect, it } from 'vitest';
import { createReplayState, intervalMs, replayReducer, type ReplayState } from './replay';

const state = (over: Partial<ReplayState> = {}): ReplayState => ({
  ...createReplayState(),
  ...over,
});

describe('replayReducer', () => {
  it('tick advances only while playing', () => {
    const paused = state({ index: 1, playing: false });
    expect(replayReducer(paused, { type: 'tick', total: 3 })).toBe(paused);

    const playing = state({ index: 1, playing: true });
    expect(replayReducer(playing, { type: 'tick', total: 3 })).toEqual({
      index: 2,
      playing: true,
      speed: 1,
    });
  });

  it('tick stops at the end and never exceeds total', () => {
    const atEnd = state({ index: 3, playing: true });
    expect(replayReducer(atEnd, { type: 'tick', total: 3 })).toEqual({
      index: 3,
      playing: false,
      speed: 1,
    });

    const last = state({ index: 2, playing: true });
    expect(replayReducer(last, { type: 'tick', total: 3 })).toEqual({
      index: 3,
      playing: false,
      speed: 1,
    });
  });

  it('restart resets the index and pauses', () => {
    const mid = state({ index: 2, playing: true, speed: 2 });
    expect(replayReducer(mid, { type: 'restart' })).toEqual({
      index: 0,
      playing: false,
      speed: 2,
    });
  });

  it('step moves one even when paused and never exceeds total', () => {
    const paused = state({ index: 0, playing: false });
    expect(replayReducer(paused, { type: 'step', total: 3 })).toEqual({
      index: 1,
      playing: false,
      speed: 1,
    });

    const atEnd = state({ index: 3, playing: true });
    expect(replayReducer(atEnd, { type: 'step', total: 3 })).toEqual({
      index: 3,
      playing: true,
      speed: 1,
    });
  });

  it('setSpeed persists across play state and index', () => {
    const mid = state({ index: 2, playing: true });
    const changed = replayReducer(mid, { type: 'setSpeed', speed: 0.5 });
    expect(changed).toEqual({ index: 2, playing: true, speed: 0.5 });
    expect(replayReducer(changed, { type: 'tick', total: 3 }).speed).toBe(0.5);
  });

  it('intervalMs divides the base interval by the speed', () => {
    expect(intervalMs(0.5)).toBe(2000);
    expect(intervalMs(1)).toBe(1000);
    expect(intervalMs(2)).toBe(500);
  });
});
