import { createElement, useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseJson } from "./support/parse-json";
import { parsePerfLine } from "../measure-device";
import { act, cleanup, render, unmount } from "./support/native-renderer";
import { finishedHistory, NOW } from "./support/fixture";
import { perfCommitted, perfNow, perfEnd, perfPending } from "../src/perf";
import { initialState, startSession } from "../src/domain/workout";
import {
  configureStorage,
  commit,
  getSnapshot,
  retry,
  useAppState,
  useStorageStatus,
  type StoreSnapshot,
} from "../src/data/store";

import { createStorage } from "../src/data/storage";
import { createSqliteAdapter } from "./support/sqlite";

const sqlite = createSqliteAdapter();

const database = sqlite.database;

const storage = createStorage(() => sqlite.database);

const PerformanceEventSchema = z.object({ name: z.string() });

function performanceEventName(line: string): string {
  const json = line.slice("FIVEFOLD_PERF ".length);

  return parseJson(json, PerformanceEventSchema).name;
}

function Observer({ state, ready }: Pick<StoreSnapshot, "state" | "ready">) {
  useLayoutEffect(() => perfCommitted(state, ready), [state, ready]);

  return null;
}

function StoreObserver() {
  const appState = useAppState((snapshot) => snapshot);
  const ready = useStorageStatus("ready");

  return createElement(Observer, { state: appState, ready });
}

beforeEach(() => {
  configureStorage(storage);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_PERF", "1");
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "");
  sqlite.reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("seeds finished alternating sessions atomically only when no state row exists", () => {
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "10000");
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const state = storage.loadState();
  expect(state.onboarded).toBe(true);
  expect(state.history).toEqual(
    finishedHistory().map((session, i) => ({ ...session, id: `seed-${i}` })),
  );
  expect(
    state.history.every(
      (session) =>
        session.finishedAt !== null &&
        session.finishedAt !== undefined &&
        session.finishedAt < Date.now(),
    ),
  ).toBe(true);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('"name":"startup.seed"'));
  const seedEvent = parsePerfLine(z.string().parse(log.mock.calls[0]?.[0]));
  expect(seedEvent?.name).toBe("startup.seed");
  expect(seedEvent?.sessions).toBe(10000);
  expect(seedEvent?.ms).toBeTypeOf("number");
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "20000");
  log.mockClear();
  expect(storage.loadState()).toEqual(state);
  expect(log).not.toHaveBeenCalled();
});

it.each(["", "0", "-1", "1.5", "NaN", "Infinity"])(
  "does not seed for invalid/unset count %s",
  (value) => {
    vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", value);
    expect(storage.loadState()).toEqual(initialState());
  },
);

it("does not seed when only the seed flag is set", () => {
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "10000");
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_PERF", "");
  expect(storage.loadState()).toEqual(initialState());
});

it("rolls back the app_state row and all seed workouts after an insert fails", () => {
  storage.loadState();
  const db = database;
  db.execSync(
    "CREATE TRIGGER reject_seed BEFORE INSERT ON workouts WHEN NEW.id = 'seed-2' BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
  );
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "3");
  expect(() => storage.loadState()).toThrow("test failure");
  expect(db.getFirstSync("SELECT * FROM app_state")).toBeNull();
  expect(db.getAllSync("SELECT * FROM workouts")).toEqual([]);
});

it("emits only the committed state's render timing and stays silent when disabled", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const state = initialState();
  const next = startSession(state, NOW);
  perfPending(perfNow(), next);
  const root = render(createElement(Observer, { state, ready: false }));
  expect(log).not.toHaveBeenCalled();
  act(() => {
    root.render(createElement(Observer, { state: next, ready: true }));
  });
  expect(log.mock.calls.map(([line]) => performanceEventName(z.string().parse(line)))).toEqual([
    "startup.ready",
    "commit.render",
  ]);
  log.mockClear();
  act(() => {
    root.render(createElement(Observer, { state: { ...next }, ready: true }));
  });
  expect(log).not.toHaveBeenCalled();
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_PERF", "");
  perfEnd("disabled", 0);
  expect(perfNow()).toBe(0);
  expect(log).not.toHaveBeenCalled();
  unmount(root);
});

it("measures a successful save through the root commit observer without publishing failed writes", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});

  retry();
  const root = render(createElement(StoreObserver));
  expect(log).toHaveBeenCalledWith(expect.stringContaining('"name":"startup.load"'));
  log.mockClear();
  act(() => {
    expect(commit((state) => startSession(state, NOW))).toBe(true);
  });
  expect(log.mock.calls.map(([line]) => performanceEventName(z.string().parse(line)))).toEqual([
    "commit.save",
    "commit.render",
  ]);
  const active = getSnapshot().state;
  const db = database;
  vi.spyOn(db, "runSync").mockImplementation(() => {
    throw new Error("disk full");
  });
  log.mockClear();
  act(() => {
    expect(commit((state) => ({ ...state, active: null }))).toBe(false);
  });
  expect(getSnapshot().state).toBe(active);
  expect(log).not.toHaveBeenCalled();
  unmount(root);
});
