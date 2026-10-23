import { DatabaseSync } from "node:sqlite";
import type { StorageDatabase } from "../../src/data/storage";

interface SqliteAdapterFixture {
  database: StorageDatabase;
  reset(this: void): void;
}

export function createSqliteAdapter(): SqliteAdapterFixture {
  const sqlite = new DatabaseSync(":memory:");

  const database: StorageDatabase = {
    execSync(source) {
      sqlite.exec(source);
    },
    runSync(source: string, ...params: (string | number | null)[]) {
      sqlite.prepare(source).run(...params);
    },
    getFirstSync<T>(source: string, ...params: (string | number | null)[]) {
      const row = sqlite.prepare(source).get(...params);

      if (!row) {
        return null;
      }

      // SAFETY: Each storage query declares its selected columns and row shape at the call site.
      return row as T;
    },
    getAllSync<T>(source: string, ...params: (string | number | null)[]) {
      const rows = sqlite.prepare(source).all(...params);

      // SAFETY: Each storage query declares its selected columns and row shape at the call site.
      return rows as T[];
    },
    withTransactionSync(action) {
      sqlite.exec("BEGIN");

      try {
        action();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  return {
    database,
    reset: () => {
      database.execSync("DROP TABLE IF EXISTS app_state; DROP TABLE IF EXISTS workouts;");
    },
  };
}
