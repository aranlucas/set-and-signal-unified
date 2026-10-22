import * as SQLite from "expo-sqlite";
import { initialState, type AppState } from "../domain/workout";
import { parseBackup } from "../domain/backup";

let database: SQLite.SQLiteDatabase | undefined;
let persistedHistory: AppState["history"] = [];
export function loadState(): AppState {
  database = SQLite.openDatabaseSync("fivefold.db");
  database.execSync(
    "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workouts (id TEXT PRIMARY KEY, finished_at REAL NOT NULL, json TEXT NOT NULL); PRAGMA user_version = 1;",
  );
  const row = database.getFirstSync<{ json: string }>(
    "SELECT json FROM app_state WHERE id = 1",
  );
  if (!row) {
    persistedHistory = [];
    return initialState();
  }
  const saved = JSON.parse(row.json);
  const rows = database.getAllSync<{ json: string }>(
    "SELECT json FROM workouts ORDER BY finished_at DESC",
  );
  // Also reads the initial prototype format, migrating it on the next successful save.
  const history = rows.length
    ? rows.map((r) => JSON.parse(r.json))
    : saved.history;
  const state = parseBackup(JSON.stringify({ ...saved, history }));
  persistedHistory = rows.length ? state.history : [];
  return state;
}
export function saveState(state: AppState) {
  if (!database) throw new Error("Workout storage is not ready.");
  const db = database;
  // Set taps write only the small current-state row, regardless of history size.
  // Finalization commits its history row and next weights in one transaction.
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO app_state (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
      JSON.stringify({ ...state, history: [] }),
    );
    if (state.history !== persistedHistory) {
      const old = new Map(persistedHistory.map((s) => [s.id, s]));
      const retained = new Set(state.history.map((s) => s.id));
      for (const session of state.history)
        if (old.get(session.id) !== session)
          db.runSync(
            "INSERT INTO workouts (id, finished_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET finished_at = excluded.finished_at, json = excluded.json",
            session.id,
            session.finishedAt!,
            JSON.stringify(session),
          );
      for (const session of persistedHistory)
        if (!retained.has(session.id))
          db.runSync("DELETE FROM workouts WHERE id = ?", session.id);
    }
  });
  persistedHistory = state.history;
}
