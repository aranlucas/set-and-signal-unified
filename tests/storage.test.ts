import { beforeEach, describe, expect, it, vi } from "vitest";
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
  let s = startSession(initialState(), NOW);
  for (const e of s.active!.exercises)
    for (let i = 0; i < e.sets.length; i++)
      s = logSet(s, e.lift, i, 5, NOW + 1000);
  return finishSession(s, NOW + 20000);
}
beforeEach(() => {
  const db = openDatabaseSync("");
  db.execSync("DROP TABLE IF EXISTS app_state; DROP TABLE IF EXISTS workouts;");
  loadState();
});
describe("persistent workout storage", () => {
  it("loads a clean installation without a saved row", () => {
    expect(loadState()).toEqual(initialState());
  });
  it("resumes every counter, note, setting and deadline after reopening", () => {
    const s = logSet(
      startSession(initialState(), NOW),
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
  it("persists completion, next weights and history together", () => {
    const s = savedWorkout();
    saveState(s);
    expect(loadState()).toEqual(s);
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
    const before = initialState();
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
  it("opens 1,000 workouts and writes a new set without serializing old history", () => {
    const s = savedWorkout();
    s.history = Array.from({ length: 1000 }, (_, i) => ({
      ...s.history[0],
      id: `workout-${i}`,
      finishedAt: NOW + i,
    }));
    saveState(s);
    const loaded = loadState();
    expect(loaded.history).toHaveLength(1000);
    saveState(
      logSet(startSession(loaded, NOW + 100000), "squat", 0, 5, NOW + 101000),
    );
    expect(loadState().history).toHaveLength(1000);
  });
});
