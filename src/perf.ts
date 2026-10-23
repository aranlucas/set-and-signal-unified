import type { AppState } from "./domain/workout";

const evaluatedAt =
  process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" ? performance.now() : 0;
let pending: { at: number; state: AppState } | undefined;
let readyLogged = false;
export function perfNow() {
  return process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" ? performance.now() : 0;
}
export function perfEnd(
  name: string,
  start: number,
  extra: Record<string, unknown> = {},
) {
  if (process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1")
    console.log(
      "FIVEFOLD_PERF " +
        JSON.stringify({ name, ms: performance.now() - start, ...extra }),
    );
}
export function perfPending(at: number, state: AppState) {
  if (process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1") pending = { at, state };
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
