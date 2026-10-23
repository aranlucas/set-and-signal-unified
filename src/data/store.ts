import { useSyncExternalStore } from "react";
import { initialState, type AppState } from "../domain/workout";
import { perfNow, perfEnd, perfPending } from "../perf";
import { loadState, saveState, type StorageAdapter } from "./storage";

export interface StoreSnapshot {
  state: AppState;
  error: string;
  ready: boolean;
}

let snapshot: StoreSnapshot | undefined;

let storage: StorageAdapter = { loadState, saveState };

const listeners = new Set<() => void>();

function read(): StoreSnapshot {
  const started = process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" ? perfNow() : 0;

  try {
    const state = storage.loadState();

    if (process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1") {
      perfEnd("startup.load", started);
    }

    return { state, error: "", ready: true };
  } catch (error) {
    return {
      state: snapshot?.state ?? initialState(),
      error: error instanceof Error ? error.message : "Couldn't open your data.",
      ready: snapshot?.ready ?? false,
    };
  }
}

export function getSnapshot(): StoreSnapshot {
  snapshot ??= read();

  return snapshot;
}

/** Supplies the app's storage boundary, including faithful test databases. */
export function configureStorage(adapter: StorageAdapter): void {
  storage = adapter;
  snapshot = undefined;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function publish(next: StoreSnapshot) {
  snapshot = next;

  for (const listener of listeners) {
    listener();
  }
}

export function retry() {
  publish(read());
}

export function commit(update: (state: AppState) => AppState): boolean {
  const started = process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" ? perfNow() : 0;
  const current = getSnapshot();

  if (!current.ready) {
    return false;
  }

  const next = update(current.state);

  if (next === current.state) {
    return true;
  }

  const saveStarted = process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" ? perfNow() : 0;

  try {
    storage.saveState(next);

    if (process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1") {
      perfEnd("commit.save", saveStarted);
      perfPending(started, next);
    }
  } catch {
    publish({
      ...current,
      error: "Couldn't save. Free up storage and try again.",
    });

    return false;
  }

  publish({ state: next, error: "", ready: true });

  return true;
}

/** Select existing references or primitives; a fresh object is not a snapshot. */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getSnapshot().state));
}

export function useStorageStatus<K extends "error" | "ready">(field: K): StoreSnapshot[K] {
  return useSyncExternalStore(subscribe, () => getSnapshot()[field]);
}
