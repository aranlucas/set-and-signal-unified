import {
  prepareCloudStorage,
  stageLegacyHistory,
  stageFivefoldPlan,
  freezePlanBaseline,
} from "./cloud-storage";
import { perfNow, perfEnd } from "../perf";
import { openDatabaseSync } from "expo-sqlite";
import { initialState, startSession, type AppState } from "../domain/workout";
import { parseStoredSession, parseStoredState, validateState } from "../domain/backup";

type DatabaseValue = string | number | null;

export interface StorageDatabase {
  execSync(source: string): void;
  runSync(source: string, ...params: DatabaseValue[]): void;
  getFirstSync<T>(source: string, ...params: DatabaseValue[]): T | null;
  getAllSync<T>(source: string, ...params: DatabaseValue[]): T[];
  withTransactionSync(task: () => void): void;
}

export interface StorageAdapter {
  loadState(this: void): AppState;
  saveState(this: void, state: AppState, origin?: "local" | "cloud"): void;
  database?(): StorageDatabase;
}

interface PersistedJsonRow {
  json: string;
}

export function createStorage(
  openDatabase: (name: string) => StorageDatabase = (name) => openDatabaseSync(name),
): StorageAdapter {
  let database: StorageDatabase | undefined;
  let persistedHistory: AppState["history"] = [];
  let persistedState: AppState | undefined;

  function readState(): AppState {
    const db = openDatabase("fivefold.db");
    database = db;
    db.execSync(
      "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workouts (id TEXT PRIMARY KEY, finished_at REAL NOT NULL, json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS workouts_finished_at ON workouts (finished_at DESC); PRAGMA user_version = 1;",
    );
    prepareCloudStorage(db);
    let row = db.getFirstSync<PersistedJsonRow>("SELECT json FROM app_state WHERE id = 1");

    if (
      process.env.EXPO_PUBLIC_FIVEFOLD_PERF === "1" &&
      process.env.EXPO_PUBLIC_FIVEFOLD_SEED &&
      !row
    ) {
      const count = Number(process.env.EXPO_PUBLIC_FIVEFOLD_SEED);

      if (Number.isSafeInteger(count) && count > 0) {
        const started = perfNow();
        const seeded = validateState(seedState(count));
        db.withTransactionSync(() => {
          db.runSync(
            "INSERT INTO app_state (id, json) VALUES (1, ?)",
            JSON.stringify({ ...seeded, history: [] }),
          );

          for (const session of seeded.history) {
            db.runSync(
              "INSERT INTO workouts (id, finished_at, json) VALUES (?, ?, ?)",
              session.id,
              session.finishedAt,
              JSON.stringify(session),
            );
          }
        });
        perfEnd("startup.seed", started, { sessions: count });
        row = db.getFirstSync<PersistedJsonRow>("SELECT json FROM app_state WHERE id = 1");
      }
    }

    if (!row) {
      persistedHistory = [];

      persistedState = initialState();

      return persistedState;
    }

    const saved = parseStoredState(row.json);

    const rows = db.getAllSync<PersistedJsonRow>(
      "SELECT json FROM workouts ORDER BY finished_at DESC",
    );

    // Also reads the initial prototype format, migrating it on the next successful save.
    const history = rows.length
      ? rows.map((entry) => parseStoredSession(entry.json))
      : saved.history;

    const state = validateState({ ...saved, history });
    persistedHistory = rows.length ? state.history : [];
    persistedState = state;

    return state;
  }

  function writeState(state: AppState, origin: "local" | "cloud" = "local"): void {
    if (!database) {
      throw new Error("Workout storage is not ready.");
    }

    const db = database;
    // Set taps write only the small current-state row, regardless of history size.
    // Finalization commits its history row and next weights in one transaction.
    db.withTransactionSync(() => {
      if (origin === "local" && state.active && !persistedState?.active) {
        freezePlanBaseline(db);
      }

      db.runSync(
        "INSERT INTO app_state (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
        JSON.stringify({ ...state, history: [] }),
      );

      if (state.history !== persistedHistory) {
        if (origin === "local") {
          stageLegacyHistory(db, state, persistedHistory);
        }

        const old = new Map(persistedHistory.map((session) => [session.id, session]));
        const retained = new Set(state.history.map((session) => session.id));

        for (const session of state.history) {
          if (old.get(session.id) !== session) {
            db.runSync(
              "INSERT INTO workouts (id, finished_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET finished_at = excluded.finished_at, json = excluded.json",
              session.id,
              session.finishedAt,
              JSON.stringify(session),
            );
          }
        }

        for (const session of persistedHistory) {
          if (!retained.has(session.id)) {
            db.runSync("DELETE FROM workouts WHERE id = ?", session.id);
          }
        }
      }

      if (
        origin === "local" &&
        !state.active &&
        persistedState &&
        (state.plans !== persistedState.plans ||
          state.settings.bar !== persistedState.settings.bar ||
          state.settings.autoProgress !== persistedState.settings.autoProgress ||
          state.settings.autoDeload !== persistedState.settings.autoDeload ||
          state.settings.unit !== persistedState.settings.unit)
      ) {
        stageFivefoldPlan(db, state);
      }
    });
    persistedHistory = state.history;
    persistedState = state;
  }

  return {
    loadState: readState,
    saveState: writeState,
    database: () => {
      if (!database) {
        readState();
      }

      if (!database) {
        throw new Error("Workout storage is not ready.");
      }

      return database;
    },
  };
}

const defaultStorage = createStorage();

export function loadState(): AppState {
  return defaultStorage.loadState();
}

export function saveState(state: AppState, origin?: "local" | "cloud"): void {
  defaultStorage.saveState(state, origin);
}

function seedState(count: number, now = Date.now()): AppState {
  const base = { ...initialState("kg"), onboarded: true };

  const history = Array.from({ length: count }, (_unused, i) => {
    const finishedAt = now - (i + 1) * 60_000;
    const started = startSession(base, finishedAt - 30_000, i % 2 ? "B" : "A");
    const session = started.active;

    if (!session) {
      throw new Error("A seeded workout must start with an active session.");
    }

    return {
      ...session,
      id: `seed-${i}`,
      finishedAt,
      exercises: session.exercises.map((exercise) => ({
        ...exercise,
        weight: 20 + (i % 100) * 2.5,
        sets: exercise.sets.map((_set, index) => (index === 4 && i % 3 === 0 ? 3 : 5)),
      })),
    };
  });

  return { ...base, history };
}

export function cloudDatabase(): StorageDatabase {
  const database = defaultStorage.database?.();

  if (!database) {
    throw new Error("Workout storage is not ready.");
  }

  return database;
}
