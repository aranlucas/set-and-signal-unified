import type { ActivityFileNotification, FitDetails } from "./files";

const FILE_WINDOW = 24 * 60 * 60 * 1000;

type FileRow = {
  activity_id: string;
  summary_id: string;
  callback: string | null;
  expires_at: number;
  state: string;
  version: string;
  data: string | null;
};

type ExpiryRow = { next: number | null };

type ActivityRow = { activity_id: string };

type ChunkRow = { data: ArrayBuffer };

const CHUNK_BYTES = 64 * 1024;

/** Private file callbacks and decoded FIT data live in the same account store as their summaries. */
export class ActivityFiles {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS activity_files (activity_id TEXT PRIMARY KEY, summary_id TEXT NOT NULL, callback TEXT, expires_at INTEGER NOT NULL, state TEXT NOT NULL, version TEXT NOT NULL, data TEXT)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS activity_file_chunks (activity_id TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(activity_id,part))",
    );
  }

  ingest(file: ActivityFileNotification) {
    // Duplicate delivery must neither extend token lifetime nor consume a one-use URL twice.
    this.sql.exec(
      "INSERT OR IGNORE INTO activity_files VALUES (?,?,?,?,?,?,NULL)",
      file.activityId,
      file.summaryId,
      file.fileType === "FIT" ? file.callbackURL : null,
      Date.now() + FILE_WINDOW,
      file.fileType === "FIT" ? "pending" : "unsupported_file_type",
      crypto.randomUUID(),
    );
  }

  expire() {
    this.sql.exec(
      "UPDATE activity_files SET callback=NULL,state='expired' WHERE callback IS NOT NULL AND expires_at<=?",
      Date.now(),
    );
    // A process that died after claiming a one-use URL cannot safely retry its download.
    this.sql.exec(
      "UPDATE activity_files SET state='download_failed' WHERE state='downloading' AND expires_at<=?",
      Date.now(),
    );
  }

  nextExpiry() {
    return this.sql
      .exec<ExpiryRow>(
        "SELECT min(expires_at) AS next FROM activity_files WHERE callback IS NOT NULL OR state='downloading'",
      )
      .one().next;
  }

  pendingId() {
    this.expire();

    return this.sql
      .exec<ActivityRow>(
        "SELECT activity_id FROM activity_files WHERE state='pending' ORDER BY expires_at LIMIT 1",
      )
      .toArray()[0]?.activity_id;
  }

  claim(activityId: string) {
    this.expire();

    const row = this.sql
      .exec<FileRow>("SELECT * FROM activity_files WHERE activity_id=?", activityId)
      .toArray()[0];

    if (!row) {
      return { state: "not_received" as const };
    }

    if (row.data) {
      return { state: "available" as const, data: this.readData(row) };
    }

    if (row.state !== "pending" || !row.callback) {
      return { state: row.state };
    }

    this.sql.exec(
      "UPDATE activity_files SET callback=NULL,state='downloading',expires_at=? WHERE activity_id=?",
      Math.min(row.expires_at, Date.now() + 60_000),
      activityId,
    );

    return {
      state: "claimed" as const,
      callback: row.callback,
      version: row.version,
      summaryId: row.summary_id,
    };
  }

  finish(activityId: string, version: string, data: FitDetails | null) {
    // A deleted/revoked record (or a fresh delivery after deletion) cannot be restored by an old read.
    const row = this.sql
      .exec<FileRow>(
        "SELECT * FROM activity_files WHERE activity_id=? AND version=? AND state='downloading'",
        activityId,
        version,
      )
      .toArray()[0];

    if (!row) {
      return null;
    }

    this.sql.exec("DELETE FROM activity_file_chunks WHERE activity_id=?", activityId);

    if (data) {
      const bytes = Buffer.from(JSON.stringify(data), "utf8");

      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        this.sql.exec(
          "INSERT INTO activity_file_chunks VALUES (?,?,?)",
          activityId,
          offset / CHUNK_BYTES,
          new Uint8Array(bytes.subarray(offset, offset + CHUNK_BYTES)).buffer,
        );
      }
    }

    this.sql.exec(
      "UPDATE activity_files SET state=?,data=? WHERE activity_id=? AND version=? AND state='downloading'",
      data ? "available" : "download_failed",
      data ? "chunked" : null,
      activityId,
      version,
    );

    return data ? this.readData({ ...row, data: "chunked" }) : null;
  }

  private readData(row: FileRow) {
    if (row.data !== "chunked") {
      return row.data;
    }

    const chunks = this.sql
      .exec<ChunkRow>(
        "SELECT data FROM activity_file_chunks WHERE activity_id=? ORDER BY part",
        row.activity_id,
      )
      .toArray();

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data))).toString("utf8");
  }

  has(activityId: string) {
    return (
      this.sql
        .exec("SELECT activity_id FROM activity_files WHERE activity_id=?", activityId)
        .toArray().length > 0
    );
  }

  clear() {
    this.sql.exec("DELETE FROM activity_file_chunks");
    this.sql.exec("DELETE FROM activity_files");
  }
}
