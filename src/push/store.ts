import { DurableObject } from "cloudflare:workers";
import { isActivityType, type SummaryType } from "./schemas";

const RETENTION_MS = 90 * 86400_000;

type DataRow = { data: string };

type ReceivedRow = DataRow & { received_at: number };

type CountRow = { n: number };

type ValueRow = { value: number };

type TypeRow = { type: SummaryType };

export interface StoredSummary {
  type: SummaryType;
  summaryId: string;
  date: string;
  receivedAt: number;
  data: string;
  startTime?: number;
  duration?: number;
}

/** One SQLite object per immutable Garmin account ID, never per client-supplied tool input. */
export class GarminUserData extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS summaries (type TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, received_at INTEGER NOT NULL, data TEXT NOT NULL, start_time INTEGER, duration INTEGER, PRIMARY KEY(type,id))`,
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value INTEGER)",
    );
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS summaries_date ON summaries(type,date,id)",
    );
  }
  async ingest(records: StoredSummary[]) {
    if (this.isRevoked()) {
      return;
    }

    this.ctx.storage.transactionSync(() => {
      for (const row of records) {
        const permission = isActivityType(row.type) ? "ACTIVITY_EXPORT" : "HEALTH_EXPORT";

        if (
          this.ctx.storage.sql
            .exec("SELECT value FROM settings WHERE key=?", permission)
            .toArray()[0]?.value === 0
        ) {
          continue;
        }

        if (row.startTime !== undefined) {
          const newer = this.ctx.storage.sql
            .exec(
              "SELECT id FROM summaries WHERE type=? AND start_time=? AND duration>?",
              row.type,
              row.startTime,
              row.duration ?? 0,
            )
            .toArray();

          if (newer.length) {
            continue;
          }

          this.ctx.storage.sql.exec(
            "DELETE FROM summaries WHERE type=? AND start_time=? AND id<>?",
            row.type,
            row.startTime,
            row.summaryId,
          );
        }

        this.ctx.storage.sql.exec(
          "INSERT INTO summaries VALUES (?,?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET date=excluded.date,received_at=excluded.received_at,data=excluded.data,start_time=excluded.start_time,duration=excluded.duration",
          row.type,
          row.summaryId,
          row.date,
          row.receivedAt,
          row.data,
          row.startTime ?? null,
          row.duration ?? null,
        );
      }
    });

    // An alarm deletes expired data even when the user never connects again.
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + 86400_000);
    }
  }
  list(type: SummaryType, startDate: string, endDate: string, limit: number, offset: number) {
    const rows = this.ctx.storage.sql
      .exec<ReceivedRow>(
        "SELECT data,received_at FROM summaries WHERE type=? AND date>=? AND date<=? AND received_at>? ORDER BY date,id LIMIT ? OFFSET ?",
        type,
        startDate,
        endDate,
        Date.now() - RETENTION_MS,
        limit + 1,
        offset,
      )
      .toArray();

    return {
      records: rows.slice(0, limit).map((row) => ({
        receivedAt: new Date(row.received_at).toISOString(),
        summaryJSON: row.data,
      })),
      hasMore: rows.length > limit,
    };
  }
  get(type: SummaryType, id: string) {
    const row = this.ctx.storage.sql
      .exec<DataRow>(
        "SELECT data FROM summaries WHERE type=? AND id=? AND received_at>?",
        type,
        id,
        Date.now() - RETENTION_MS,
      )
      .toArray()[0];

    return row?.data ?? null;
  }
  clear() {
    this.ctx.storage.sql.exec("DELETE FROM summaries");
  }
  revoke() {
    this.clear();
    // Keep a tombstone: late delivery retries cannot restore withdrawn health data.
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO settings VALUES ('revoked',1)");
  }
  activate() {
    this.ctx.storage.sql.exec("DELETE FROM settings");
  }
  permissions(permissions: string[], changedAt: number) {
    const previous =
      this.ctx.storage.sql
        .exec<ValueRow>("SELECT value FROM settings WHERE key='permissionTime'")
        .toArray()[0]?.value ?? -1;

    if (changedAt <= previous) {
      return;
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO settings VALUES ('permissionTime',?)",
        changedAt,
      );

      for (const permission of ["HEALTH_EXPORT", "ACTIVITY_EXPORT"]) {
        const allowed = permissions.includes(permission);
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO settings VALUES (?,?)",
          permission,
          allowed ? 1 : 0,
        );

        if (!allowed) {
          for (const row of this.ctx.storage.sql
            .exec<TypeRow>("SELECT DISTINCT type FROM summaries")
            .toArray()) {
            if (isActivityType(row.type) === (permission === "ACTIVITY_EXPORT")) {
              this.ctx.storage.sql.exec("DELETE FROM summaries WHERE type=?", row.type);
            }
          }
        }
      }
    });
  }
  isRevoked() {
    return (
      this.ctx.storage.sql.exec("SELECT value FROM settings WHERE key='revoked'").toArray().length >
      0
    );
  }
  override async alarm() {
    this.ctx.storage.sql.exec(
      "DELETE FROM summaries WHERE received_at<=?",
      Date.now() - RETENTION_MS,
    );

    if (this.ctx.storage.sql.exec<CountRow>("SELECT count(*) AS n FROM summaries").one().n > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 86400_000);
    }
  }
}

export function userStore(env: Env, id: string): DurableObjectStub<GarminUserData> {
  // SAFETY: USER_DATA targets the exported GarminUserData class; cf does not infer named RPC methods for string-based Durable Object references yet.
  return env.USER_DATA.getByName(id) as DurableObjectStub<GarminUserData>;
}
