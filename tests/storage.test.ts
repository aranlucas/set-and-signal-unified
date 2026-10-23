import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialState,
  finishSession,
  startSession,
  logSet,
} from "../src/domain/workout";

// Run the actual SQL against SQLite; only the Expo native bridge is adapted to Node.
vi.mock("expo-sqlite", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const adapter = {
    execSync: (sql: string) => db.exec(sql),
    runSync: (sql: string, ...args: any[]) => db.prepare(sql).run(...args),
    getFirstSync: (sql: string, ...args: any[]) =>
      db.prepare(sql).get(...args) ?? null,
    getAllSync: (sql: string, ...args: any[]) => db.prepare(sql).all(...args),
    withTransactionSync: (action: () => void) => {
      db.exec("BEGIN");
      try {
        action();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { openDatabaseSync: () => adapter };
});
import { openDatabaseSync } from "expo-sqlite";
import { loadState, saveState } from "../src/data/storage";

const NOW = 1792650000000;
function savedWorkout() {
  let s = startSession(initialState("kg"), NOW);
  for (const e of s.active!.exercises)
    for (let i = 0; i < e.sets.length; i++)
      s = logSet(s, e.lift, i, 5, NOW + 1000);
  return finishSession(s, NOW + 20000);
}
function stateWithHistory(count: number, notes = "") {
  const s = savedWorkout();
  s.history = Array.from({ length: count }, (_, i) => ({
    ...s.history[0],
    id: `workout-${i}`,
    finishedAt: NOW + count - i,
    notes,
  }));
  return s;
}
beforeEach(() => {
  const db = openDatabaseSync("");
  db.execSync("DROP TABLE IF EXISTS app_state; DROP TABLE IF EXISTS workouts;");
  loadState();
});
afterEach(() => vi.restoreAllMocks());
describe("persistent workout storage", () => {
  it("loads a clean installation without a saved row", () => {
    expect(loadState()).toEqual(initialState());
  });
  it("resumes every counter, note, setting and deadline after reopening", () => {
    const s = logSet(
      startSession(initialState("kg"), NOW),
      "squat",
      2,
      4,
      NOW + 1000,
    );
    s.active!.notes = "Saved offline";
    s.settings.theme = "dark";
    saveState(s);
    expect(loadState()).toEqual(s);
  });
  it("round-trips both plate inventories in the small settings row", () => {
    const state = savedWorkout();
    state.settings.plates = {
      kg: [0, 1, 2, 3, 4, 5, 20],
      lb: [20, 5, 4, 3, 2, 1],
    };
    saveState(state);
    expect(loadState()).toEqual(state);
  });
  it("normalises an old database without rewriting unchanged history on the next save", () => {
    const state = savedWorkout();
    saveState(state);
    const settings = { ...state.settings };
    Reflect.deleteProperty(settings, "plates");
    const db = openDatabaseSync("");
    db.runSync(
      "UPDATE app_state SET json = ? WHERE id = 1",
      JSON.stringify({ ...state, settings, history: [] }),
    );
    const loaded = loadState();
    expect(loaded).toEqual(state);
    const writes = vi.spyOn(db, "runSync");
    saveState(loaded);
    expect(
      writes.mock.calls.filter(([sql]) => String(sql).includes("workouts")),
    ).toHaveLength(0);
    expect(loadState()).toEqual(state);
  });
  it("persists completion, next weights and history together", () => {
    const s = savedWorkout();
    saveState(s);
    expect(loadState()).toEqual(s);
  });
  it("can reopen a workout finished after the device clock moves backward", () => {
    const active = logSet(
      startSession(initialState("kg"), NOW),
      "squat",
      0,
      5,
      NOW + 1000,
    );
    const finished = finishSession(active, NOW - 60000);
    saveState(finished);
    const loaded = loadState();
    expect(loaded).toEqual(finished);
    expect(loaded.history[0].finishedAt).toBe(NOW);
  });
  it("adds an index to existing databases for ordered history reads", () => {
    const db = openDatabaseSync("");
    db.execSync("DROP INDEX workouts_finished_at");
    loadState();
    const plan = db.getAllSync<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT json FROM workouts ORDER BY finished_at DESC",
    );
    expect(
      plan.some((row) => row.detail.includes("workouts_finished_at")),
    ).toBe(true);
    expect(plan.some((row) => row.detail.includes("TEMP B-TREE"))).toBe(false);
  });
  it("does not rewrite old workout rows when a counter changes", () => {
    const s = savedWorkout();
    saveState(s);
    const db = openDatabaseSync("");
    const spy = vi.spyOn(db, "runSync");
    const active = logSet(
      startSession(s, NOW + 30000),
      "squat",
      0,
      5,
      NOW + 40000,
    );
    saveState(active);
    expect(
      spy.mock.calls.filter(([sql]) =>
        String(sql).includes("INSERT INTO workouts"),
      ),
    ).toHaveLength(0);
    spy.mockRestore();
  });
  it("rolls back progression when writing a history row fails", () => {
    const before = initialState("kg");
    saveState(before);
    const broken = savedWorkout();
    broken.history[0].finishedAt = null;
    expect(() => saveState(broken)).toThrow();
    expect(loadState()).toEqual(before);
  });
  it("deletes history without changing current planned weights", () => {
    const s = savedWorkout();
    saveState(s);
    const next = { ...s, history: [] };
    saveState(next);
    expect(loadState()).toEqual(next);
  });
  it("replaces history and active state on backup restore", () => {
    const s = savedWorkout();
    saveState(s);
    let replacement = startSession(initialState("lb"), NOW + 30000, "B");
    replacement = logSet(replacement, "deadlift", 0, 3, NOW + 40000);
    saveState(replacement);
    expect(loadState()).toEqual(replacement);
  });
  it("stores apostrophes and SQL-like notes as data", () => {
    const s = savedWorkout();
    s.history[0].notes = "It's fine'); DROP TABLE workouts; --";
    saveState(s);
    expect(loadState().history[0].notes).toBe(s.history[0].notes);
  });
  it("still rejects malformed persisted workout data", () => {
    const s = savedWorkout();
    s.history[0].finishedAt = NOW - 1;
    saveState(s);
    expect(() => loadState()).toThrow("This isn't a Fivefold backup.");
  });
  it("imports the initial prototype storage format without losing history", () => {
    const s = savedWorkout();
    const db = openDatabaseSync("");
    db.runSync("INSERT INTO app_state(id,json) VALUES(1,?)", JSON.stringify(s));
    const loaded = loadState();
    expect(loaded).toEqual(s);
    saveState(loaded);
    expect(
      db.getFirstSync<{ count: number }>(
        "SELECT count(*) AS count FROM workouts",
      )!.count,
    ).toBe(1);
    expect(loadState()).toEqual(s);
  });
  it.each([
    { name: "20,001 workouts", count: 20001, notes: "" },
    { name: "over 20 MB of history", count: 9000, notes: "n".repeat(2000) },
  ])(
    "saves and reopens $name beyond backup import limits",
    ({ count, notes }) => {
      const s = stateWithHistory(count, notes);
      if (notes) expect(JSON.stringify(s).length).toBeGreaterThan(20_000_000);
      saveState(s);
      expect(loadState()).toEqual(s);
    },
  );
  it("opens history without reserializing it and serializes only current state on a set save", () => {
    const s = stateWithHistory(1000);
    saveState(s);
    const stringify = vi.spyOn(JSON, "stringify");
    const loaded = loadState();
    expect(stringify).not.toHaveBeenCalled();
    expect(loaded.history).toHaveLength(1000);
    const active = logSet(
      startSession(loaded, NOW + 100000),
      "squat",
      0,
      5,
      NOW + 101000,
    );
    saveState(active);
    expect(stringify).toHaveBeenCalledTimes(1);
    expect(stringify.mock.calls[0][0]).toEqual({ ...active, history: [] });
    stringify.mockRestore();
    expect(loadState().history).toHaveLength(1000);
  });
});
