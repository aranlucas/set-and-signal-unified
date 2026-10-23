import type { AppState } from "./domain/workout";

const evaluatedAt = process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" ? performance.now() : 0;

interface PendingMeasurement {
  at: number;
  state: AppState;
}

let pending: PendingMeasurement | undefined;

let readyLogged = false;

export function perfNow() {
  return process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" ? performance.now() : 0;
}

export function perfEnd(
  name: string,
  start: number,
  extra: Record<string, string | number | boolean | null> = {},
) {
  if (process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1") {
    const event = { name, ms: performance.now() - start, ...extra };
    globalThis.console.warn("FIVEFOLD_PERF " + JSON.stringify(event));
  }
}

export function perfPending(at: number, state: AppState) {
  if (process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1") {
    pending = { at, state };
  }
}

export function perfCommitted(state: AppState, ready: boolean) {
  if (process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1") {
    if (ready && !readyLogged) {
      perfEnd("startup.ready", evaluatedAt);
      readyLogged = true;
    }

    if (pending?.state === state) {
      perfEnd("commit.render", pending.at);
      pending = undefined;
    }
  }
}
