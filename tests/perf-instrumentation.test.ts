import { createElement, act, useLayoutEffect } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finishedHistory, NOW } from "./support/fixture";
import { perfCommitted, perfNow, perfEnd, perfPending } from "../src/perf";
import { initialState, startSession } from "../src/domain/workout";
import {
  commit,
  getSnapshot,
  retry,
  useAppState,
  useStorageStatus,
  type StoreSnapshot,
} from "../src/data/store";

vi.mock("expo-sqlite", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(":memory:");
  const adapter = {
    execSync: (sql: string) => database.exec(sql),
    runSync: (sql: string, ...args: any[]) =>
      database.prepare(sql).run(...args),
    getFirstSync: (sql: string, ...args: any[]) =>
      database.prepare(sql).get(...args) ?? null,
    getAllSync: (sql: string, ...args: any[]) =>
      database.prepare(sql).all(...args),
    withTransactionSync: (action: () => void) => {
      database.exec("BEGIN");
      try {
        action();
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { openDatabaseSync: () => adapter };
});
import { openDatabaseSync } from "expo-sqlite";
import { loadState } from "../src/data/storage";

function Observer({ state, ready }: Pick<StoreSnapshot, "state" | "ready">) {
  useLayoutEffect(() => perfCommitted(state, ready), [state, ready]);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_PERF", "1");
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "");
  openDatabaseSync("").execSync(
    "DROP TABLE IF EXISTS app_state; DROP TABLE IF EXISTS workouts;",
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("seeds finished alternating sessions atomically only when no state row exists", () => {
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "10000");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const state = loadState();
  expect(state.onboarded).toBe(true);
  expect(state.history).toEqual(
    finishedHistory().map((session, i) => ({ ...session, id: `seed-${i}` })),
  );
  expect(
    state.history.every((session) => session.finishedAt! < Date.now()),
  ).toBe(true);
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining('"name":"startup.seed"'),
  );
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "20000");
  log.mockClear();
  expect(loadState()).toEqual(state);
  expect(log).not.toHaveBeenCalled();
});
it.each(["", "0", "-1", "1.5", "NaN", "Infinity"])(
  "does not seed for invalid/unset count %s",
  (value) => {
    vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", value);
    expect(loadState()).toEqual(initialState());
  },
);
it("does not seed when only the seed flag is set", () => {
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "10000");
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_PERF", "");
  expect(loadState()).toEqual(initialState());
});
it("rolls back the app_state row and all seed workouts after an insert fails", () => {
  loadState();
  const db = openDatabaseSync("");
  db.execSync(
    "CREATE TRIGGER reject_seed BEFORE INSERT ON workouts WHEN NEW.id = 'seed-2' BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
  );
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_SEED", "3");
  expect(() => loadState()).toThrow("test failure");
  expect(db.getFirstSync("SELECT * FROM app_state")).toBeNull();
  expect(db.getAllSync("SELECT * FROM workouts")).toEqual([]);
});
it("emits only the committed state's render timing and stays silent when disabled", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("react-test-renderer is deprecated.")
    )
      return;
    originalError(...args);
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const state = initialState();
  const next = startSession(state, NOW);
  perfPending(perfNow(), next);
  let root: ReturnType<typeof create>;
  await act(async () => {
    root = create(createElement(Observer, { state, ready: false }));
  });
  expect(log).not.toHaveBeenCalled();
  await act(async () => {
    root.update(createElement(Observer, { state: next, ready: true }));
  });
  expect(
    log.mock.calls.map(
      ([line]) => JSON.parse(String(line).slice("FIVEFOLD_PERF ".length)).name,
    ),
  ).toEqual(["startup.ready", "commit.render"]);
  log.mockClear();
  await act(async () => {
    root.update(createElement(Observer, { state: { ...next }, ready: true }));
  });
  expect(log).not.toHaveBeenCalled();
  vi.stubEnv("EXPO_PUBLIC_FIVEFOLD_PERF", "");
  perfEnd("disabled", 0);
  expect(perfNow()).toBe(0);
  expect(log).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
it("measures a successful save through the root commit observer without publishing failed writes", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("react-test-renderer is deprecated.")
    )
      return;
    originalError(...args);
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  function Harness() {
    const state = useAppState((state) => state);
    const ready = useStorageStatus("ready");
    return createElement(Observer, { state, ready });
  }
  let root: ReturnType<typeof create>;
  retry();
  await act(async () => {
    root = create(createElement(Harness));
  });
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining('"name":"startup.load"'),
  );
  log.mockClear();
  await act(async () => {
    expect(commit((state) => startSession(state, NOW))).toBe(true);
  });
  expect(
    log.mock.calls.map(
      ([line]) => JSON.parse(String(line).slice("FIVEFOLD_PERF ".length)).name,
    ),
  ).toEqual(["commit.save", "commit.render"]);
  const active = getSnapshot().state;
  const db = openDatabaseSync("");
  vi.spyOn(db, "runSync").mockImplementation(() => {
    throw new Error("disk full");
  });
  log.mockClear();
  await act(async () => {
    expect(commit((state) => ({ ...state, active: null }))).toBe(false);
  });
  expect(getSnapshot().state).toBe(active);
  expect(log).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
