export type ReplaySpeed = 0.5 | 1 | 2;

export interface ReplayState {
  /** Number of steps revealed so far; never exceeds the total step count. */
  index: number;
  playing: boolean;
  speed: ReplaySpeed;
}

export type ReplayAction =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'tick'; total: number }
  | { type: 'step'; total: number }
  | { type: 'restart' }
  | { type: 'setSpeed'; speed: ReplaySpeed };

/** Interval between steps at 1x speed. */
export const REPLAY_INTERVAL_MS = 1000;

/** Interval between steps for the given speed. Pure. */
export function intervalMs(speed: ReplaySpeed): number {
  return REPLAY_INTERVAL_MS / speed;
}

/** Initial replay state: nothing revealed, paused, 1x. */
export function createReplayState(): ReplayState {
  return { index: 0, playing: false, speed: 1 };
}

/** Pure reducer driving the trace replay. */
export function replayReducer(state: ReplayState, action: ReplayAction): ReplayState {
  switch (action.type) {
    case 'play':
      return { ...state, playing: true };
    case 'pause':
      return { ...state, playing: false };
    case 'tick': {
      if (!state.playing) return state;
      if (state.index >= action.total) return { ...state, playing: false };
      const index = state.index + 1;
      return { ...state, index, playing: index < action.total };
    }
    case 'step':
      return { ...state, index: Math.min(state.index + 1, action.total) };
    case 'restart':
      return { ...state, index: 0, playing: false };
    case 'setSpeed':
      return { ...state, speed: action.speed };
  }
}
