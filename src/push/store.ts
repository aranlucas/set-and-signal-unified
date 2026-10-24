import { DurableObject } from "cloudflare:workers";
import { isActivityType, type SummaryType } from "./schemas";
import { GarminEvents } from "../events/store";
import { logEvent, type IngestDiagnostic } from "../events/diagnostics";
import { ActivityFiles } from "../activity/store";
import type { ActivityFileNotification, FitDetails } from "../activity/files";
import { fetchActivityFile } from "../activity/files";
import { garminCredential, type AuthBroker } from "../auth";
import { TrainingClient } from "../training/client";
import {
  eventPermission,
  eventReply,
  type EventOwner,
  type SubscribeParams,
  type UnsubscribeParams,
} from "../events/protocol";

type DataRow = { data: string };

type ReceivedRow = DataRow & { received_at: number };

type ValueRow = { value: number };

type TypeRow = { type: SummaryType };

type ActivitySummaryRow = DataRow & { type: string };

type ActivityOwner = { subject: string; garmin_id: string };

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
  private readonly events: GarminEvents;
  private readonly files: ActivityFiles;

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
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS summaries_start ON summaries(type,start_time)",
    );
    this.files = new ActivityFiles(this.ctx.storage.sql);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS activity_owner (id INTEGER PRIMARY KEY CHECK(id=1),subject TEXT NOT NULL,garmin_id TEXT NOT NULL)",
    );
    this.events = new GarminEvents(
      ctx,
      env,
      (name) =>
        this.isRevoked() ||
        this.ctx.storage.sql
          .exec<ValueRow>("SELECT value FROM settings WHERE key=?", eventPermission(name))
          .toArray()[0]?.value === 0,
      () => this.nextActivityWork(),
    );
  }
  async ingest(records: StoredSummary[]) {
    await this.events.prepareIngest();

    if (this.isRevoked()) {
      return;
    }

    const diagnostics: IngestDiagnostic[] = [];
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

        const known =
          this.ctx.storage.sql
            .exec(
              "SELECT id FROM summaries WHERE type=? AND (id=? OR (? IS NOT NULL AND start_time=?)) LIMIT 1",
              row.type,
              row.summaryId,
              row.startTime ?? null,
              row.startTime ?? null,
            )
            .toArray().length > 0;

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
          "INSERT INTO summaries VALUES (?,?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET date=excluded.date,received_at=excluded.received_at,data=excluded.data,start_time=excluded.start_time,duration=excluded.duration WHERE json_extract(excluded.data,'$.importSource') IS NOT 'garmin-personal-api' OR json_extract(summaries.data,'$.importSource') = 'garmin-personal-api'",
          row.type,
          row.summaryId,
          row.date,
          row.receivedAt,
          row.data,
          row.startTime ?? null,
          row.duration ?? null,
        );
        const diagnostic = this.events.enqueue(row, known);

        if (diagnostic) {
          diagnostics.push(diagnostic);
        }
      }
    });

    // An aborted batch must never report a queued event as durable acceptance.
    for (const diagnostic of diagnostics) {
      logEvent(diagnostic);
    }

    await this.events.schedule();
  }
  list(type: SummaryType, startDate: string, endDate: string, limit: number, offset: number) {
    const rows = this.ctx.storage.sql
      .exec<ReceivedRow>(
        "SELECT data,received_at FROM summaries WHERE type=? AND date>=? AND date<=? ORDER BY date,id LIMIT ? OFFSET ?",
        type,
        startDate,
        endDate,
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
      .exec<DataRow>("SELECT data FROM summaries WHERE type=? AND id=?", type, id)
      .toArray()[0];

    return row?.data ?? null;
  }
  getActivity(activityId: string) {
    const rows = this.ctx.storage.sql
      .exec<ActivitySummaryRow>(
        "SELECT type,data FROM summaries WHERE type IN ('activities','manuallyUpdatedActivities','activityDetails') AND CAST(json_extract(data,'$.activityId') AS TEXT)=? ORDER BY received_at DESC",
        activityId,
      )
      .toArray();

    const activity = rows.find((row) => row.type !== "activityDetails");
    const details = rows.find((row) => row.type === "activityDetails");

    return rows.length || this.files.has(activityId)
      ? { summary: activity?.data ?? null, details: details?.data ?? null }
      : null;
  }
  private activityBlocked() {
    return (
      this.isRevoked() ||
      this.ctx.storage.sql
        .exec<ValueRow>("SELECT value FROM settings WHERE key='ACTIVITY_EXPORT'")
        .toArray()[0]?.value === 0
    );
  }
  private activityOwner() {
    return this.ctx.storage.sql
      .exec<ActivityOwner>("SELECT subject,garmin_id FROM activity_owner WHERE id=1")
      .toArray()[0];
  }
  private nextActivityWork() {
    const expires = this.files.nextExpiry();

    if (!this.activityOwner() || !this.files.pendingId()) {
      return expires;
    }

    const attempt =
      this.ctx.storage.sql
        .exec<ValueRow>("SELECT value FROM settings WHERE key='fileNextAttempt'")
        .toArray()[0]?.value ?? Date.now() + 2000;

    return Math.min(expires ?? attempt, attempt);
  }
  async bindActivityOwner(subject: string, garminUserId: string) {
    const existing = this.activityOwner();

    if (existing?.subject === subject && existing.garmin_id === garminUserId) {
      return;
    }

    await this.ctx.storage.setAlarm(Date.now() + 1000);
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO activity_owner VALUES (1,?,?)",
      subject,
      garminUserId,
    );
    await this.events.schedule();
  }
  private async downloadActivityFile() {
    const owner = this.activityOwner();
    const activityId = this.files.pendingId();

    if (!owner || !activityId || this.activityBlocked()) {
      return;
    }

    const nextAttempt =
      this.ctx.storage.sql
        .exec<ValueRow>("SELECT value FROM settings WHERE key='fileNextAttempt'")
        .toArray()[0]?.value ?? 0;

    if (nextAttempt > Date.now()) {
      return;
    }

    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO settings VALUES ('fileNextAttempt',?)",
      Date.now() + 60_000,
    );

    try {
      // SAFETY: AUTH is the existing private GarminTokens RPC contract, validated below.
      const broker = this.env.AUTH as AuthBroker;
      const credential = garminCredential.safeParse(await broker.accessToken(owner.subject));

      if (
        !credential.success ||
        credential.data.garminUserId !== owner.garmin_id ||
        credential.data.expiresAt <= Date.now()
      ) {
        await this.revoke();

        return;
      }

      const client = new TrainingClient(credential.data.accessToken);

      if (!(await client.getPermissions()).includes("ACTIVITY_EXPORT")) {
        this.files.clear();

        return;
      }

      if (this.activityBlocked()) {
        return;
      }

      const file = this.files.claim(activityId);

      if (!file.callback || !file.version || !file.summaryId) {
        return;
      }

      let decoded: FitDetails | null = null;

      try {
        decoded = {
          ...(await fetchActivityFile(
            file.callback,
            credential.data.accessToken,
            AbortSignal.timeout(20_000),
            fetch,
          )),
          activityId,
          fileSummaryId: file.summaryId,
        };
      } catch {
        // One-use downloads cannot be retried after an ambiguous failure. Never log credentials.
      }

      if (!(await client.getPermissions()).includes("ACTIVITY_EXPORT")) {
        this.files.clear();

        return;
      }

      const current = garminCredential.safeParse(await broker.accessToken(owner.subject));

      if (
        !current.success ||
        current.data.garminUserId !== owner.garmin_id ||
        current.data.expiresAt <= Date.now()
      ) {
        await this.revoke();

        return;
      }

      this.finishActivityFile(activityId, file.version, decoded);
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO settings VALUES ('fileNextAttempt',?)",
        Date.now() + 2000,
      );
    } catch {
      // Keep unclaimed jobs for the next alarm if Auth or permission lookup is unavailable.
    }
  }
  async ingestActivityFiles(files: ActivityFileNotification[]) {
    // Persist a wake-up before accepting token-bearing metadata, as with the event outbox.
    await this.ctx.storage.setAlarm(Date.now() + 1000);

    if (!this.activityBlocked()) {
      this.ctx.storage.transactionSync(() => {
        for (const file of files) {
          this.files.ingest(file);
        }
      });
    }

    await this.events.schedule();
  }
  async claimActivityFile(activityId: string) {
    if (this.activityBlocked()) {
      return { state: "permission_denied" };
    }

    const claimed = this.files.claim(activityId);
    await this.events.schedule();

    return claimed;
  }
  finishActivityFile(activityId: string, version: string, data: FitDetails | null) {
    return this.activityBlocked()
      ? null
      : this.ctx.storage.transactionSync(() => this.files.finish(activityId, version, data));
  }
  clear() {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM summaries");
      this.files.clear();
      this.events.clear();
    });

    return this.events.schedule();
  }
  revoke() {
    // Keep a tombstone: late delivery retries cannot restore withdrawn health data.
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO settings VALUES ('revoked',1)");
    this.ctx.storage.sql.exec("DELETE FROM activity_owner");

    return this.clear();
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
          if (permission === "ACTIVITY_EXPORT") {
            this.files.clear();
          }

          this.events.clear(permission);

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

    return this.events.schedule();
  }
  isRevoked() {
    return (
      this.ctx.storage.sql.exec("SELECT value FROM settings WHERE key='revoked'").toArray().length >
      0
    );
  }
  subscribeEvent(owner: EventOwner, params: SubscribeParams) {
    return eventReply(() => this.events.subscribe(owner, params));
  }
  unsubscribeEvent(owner: EventOwner, params: UnsubscribeParams) {
    return eventReply(() => this.events.unsubscribe(owner, params));
  }
  override async alarm() {
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    this.files.expire();
    await this.downloadActivityFile();
    await this.events.alarm();
  }
}

export function userStore(env: Env, id: string): DurableObjectStub<GarminUserData> {
  // SAFETY: USER_DATA targets the exported GarminUserData class; cf does not infer named RPC methods for string-based Durable Object references yet.
  return env.USER_DATA.getByName(id) as DurableObjectStub<GarminUserData>;
}
