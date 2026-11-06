import * as v from "valibot";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "@/shared/lib/api";
import { parseStoredState, type ParsedAppStatePatch } from "@/shared/lib/schemas";
import type { AppState } from "@/shared/lib/types";
import { joinState, splitState } from "@set-and-signal/training/state";

type CommitValue = { changes: Change[]; operationId?: string };

export type SyncPhase = "loading" | "saving" | "saved" | "offline" | "error" | "conflict";

export type SyncStatus = { phase: SyncPhase; pending: number };

export type SyncConflict = { key: string; local: string | null; remote: string | null };

type Change = { key: string; expected: string | null; value: string | null; operationId?: string };

const snapshot = makeFunctionReference<"query", Record<string, never>, unknown>(
  "training:snapshot",
);

const commit = makeFunctionReference<"mutation", CommitValue, null>("training:commit");

export function changesBetween(before: Partial<AppState>, after: Partial<AppState>): Change[] {
  const old = new Map(splitState(before).map((row) => [row.key, row.value]));
  const next = new Map(splitState(after).map((row) => [row.key, row.value]));

  return [...new Set([...old.keys(), ...next.keys()])].flatMap((key) => {
    const expected = old.get(key) ?? null;
    const value = next.get(key) ?? null;

    return expected === value ? [] : [{ key, expected, value }];
  });
}

async function credentials(uid: string) {
  const parsed = v.safeParse(
    v.object({ token: v.string(), url: v.string(), userId: v.literal(uid) }),
    await api("/api/convex/token"),
  );

  if (!parsed.success) {
    throw new Error("Your session changed. Sign in again.");
  }

  return { token: parsed.output.token, url: parsed.output.url };
}

const changeSchema = v.object({
  operationId: v.optional(v.string()),
  key: v.string(),
  expected: v.nullable(v.string()),
  value: v.nullable(v.string()),
});

function readQueue(key: string): Change[][] {
  const parsed = v.safeParse(v.array(v.unknown()), JSON.parse(localStorage.getItem(key) ?? "[]"));

  if (!parsed.success) {
    throw new Error("Invalid pending training edits");
  }

  return parsed.output.map((batchInput) => {
    const batch = v.safeParse(v.array(v.unknown()), batchInput);

    if (!batch.success) {
      throw new Error("Invalid pending training edits");
    }

    return batch.output.map((entry) => {
      const change = v.safeParse(changeSchema, entry);

      if (!change.success) {
        throw new Error("Invalid pending training edit");
      }

      return change.output;
    });
  });
}

export interface TrainingSyncDependencies {
  createClient: (url: string) => ConvexClient;
  credentials: typeof credentials;
}

const defaultDependencies: TrainingSyncDependencies = {
  createClient: (url) => new ConvexClient(url),
  credentials,
};

export class TrainingSync {
  private client: ConvexClient | undefined;
  private stop: (() => void) | undefined;
  private stopConnection: (() => void) | undefined;
  private problem: "error" | "conflict" | undefined;
  private closed = false;
  private queue: Change[][];
  private known = new Map<string, string>();
  private flushing: Promise<void> | undefined;
  private readonly key: string;
  private readonly uid: string;
  private readonly receive: (state: ParsedAppStatePatch) => void;
  private readonly failed: (cause: unknown) => void;
  private readonly status: (status: SyncStatus) => void;
  private readonly dependencies: TrainingSyncDependencies;
  constructor(
    uid: string,
    receive: (state: ParsedAppStatePatch) => void,
    failed: (cause: unknown) => void,
    status: (status: SyncStatus) => void = () => {},
    dependencies: TrainingSyncDependencies = defaultDependencies,
  ) {
    this.uid = uid;
    this.dependencies = dependencies;
    this.receive = receive;
    this.status = status;
    this.failed = (error) => {
      if (this.closed) {
        return;
      }

      this.problem =
        error instanceof Error && error.message.includes("CONFLICT") ? "conflict" : "error";
      this.publish();
      failed(error);
    };

    this.key = `gym_pending_convex:${uid}`;
    const cached = parseStoredState(localStorage.getItem(`gym_cache:${uid}`));
    this.known = new Map(splitState(cached ?? {}).map((row) => [row.key, row.value]));
    this.queue = readQueue(this.key);

    for (const batch of this.queue) {
      for (const change of batch) {
        if (change.value === null) {
          this.known.delete(change.key);
        } else {
          this.known.set(change.key, change.value);
        }
      }
    }
  }
  private publish() {
    if (this.closed) {
      return;
    }

    const online = navigator?.onLine !== false;
    const phase = !online ? "offline" : (this.problem ?? (this.queue.length ? "saving" : "saved"));
    this.status({ phase, pending: this.queue.length });
  }
  private showPending() {
    const state = parseStoredState(
      JSON.stringify(
        joinState(
          [...this.known].map(([key, value]) => ({ key, value })),
          0,
        ),
      ),
    );

    if (state) {
      this.receive(state);
    }
  }
  async start() {
    if (this.queue.length) {
      this.showPending();
    }

    this.status({ phase: "loading", pending: this.queue.length });
    let initial;

    try {
      initial = await this.dependencies.credentials(this.uid);
    } catch (error) {
      this.failed(error);
      throw error;
    }

    if (this.closed) {
      return;
    }

    const client = this.dependencies.createClient(initial.url);
    this.client = client;
    this.stopConnection = client.subscribeToConnectionState((connection) => {
      if (this.closed || this.problem) {
        return;
      }

      if (!connection.isWebSocketConnected) {
        this.status({ phase: "offline", pending: this.queue.length });
      } else {
        this.publish();
      }
    });
    client.setAuth(async () =>
      this.closed ? null : (await this.dependencies.credentials(this.uid)).token,
    );
    this.stop = client.onUpdate(
      snapshot,
      {},
      (value) => {
        if (!this.closed && !this.queue.length) {
          this.accept(value);
        }
      },
      this.failed,
    );

    try {
      await this.flush();
      const value = await client.query(snapshot, {});

      if (!this.closed && !this.queue.length) {
        this.accept(value);
      }
    } catch (error) {
      this.failed(error);
      throw error;
    }
  }
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- Convex subscription data is untrusted; null resets state and every other value is immediately checked by parseStoredState before admission.
  private accept(value: unknown) {
    if (value === null) {
      this.known.clear();
      this.receive({});
      this.problem = undefined;
      this.publish();

      return;
    }

    const state = parseStoredState(JSON.stringify(value));

    if (!state) {
      throw new Error("Invalid training data from Convex");
    }

    this.known = new Map(splitState(state).map((row) => [row.key, row.value]));
    this.receive(state);
    this.problem = undefined;
    this.publish();
  }
  private persistQueue(next: Change[][]) {
    // A failed write must leave the live queue intact for retry or recovery.
    // The first change carries local receipt metadata, preserving old queue files.
    const identified = next.flatMap((batch) => {
      if (!batch.length) {
        return [];
      }

      const value = batch[0]?.operationId
        ? batch
        : batch.map((change, index) =>
            index === 0 ? { ...change, operationId: crypto.randomUUID() } : change,
          );

      return [value];
    });

    localStorage.setItem(this.key, JSON.stringify(identified));
    this.queue = identified;
  }
  enqueue(before: Partial<AppState>, after: Partial<AppState>) {
    const changes = changesBetween(before, after).map((change) => ({
      key: change.key,
      value: change.value,
      expected: this.known.get(change.key) ?? null,
    }));

    if (!changes.length) {
      return;
    }

    if (
      !changes.some((change) => change.key === "field/unit") &&
      changes.some((change) => change.value !== null && /^(workouts|routines)\//.test(change.key))
    ) {
      const unit = this.known.get("field/unit") ?? null;
      changes.push({ key: "field/unit", expected: unit, value: unit });
    }

    // Throw before admitting the edit or advancing its baseline if storage rejects it.
    this.persistQueue([...this.queue, changes]);

    for (const change of changes) {
      if (change.value === null) {
        this.known.delete(change.key);
      } else {
        this.known.set(change.key, change.value);
      }
    }

    this.publish();

    if (this.client && !this.problem) {
      void this.flush().catch(this.failed);
    }
  }
  flush(): Promise<void> {
    if (this.flushing) {
      return this.flushing;
    }

    this.flushing = this.drain().then(
      (): Promise<void> | undefined => {
        this.flushing = undefined;

        if (this.queue.length && this.client && !this.closed) {
          return this.flush();
        }

        return undefined;
      },
      (cause: unknown) => {
        this.flushing = undefined;
        throw cause;
      },
    );

    return this.flushing;
  }
  private async drain() {
    const client = this.client;

    if (this.closed) {
      return;
    }

    if (!client) {
      if (this.queue.length) {
        throw new Error("Connect to save your pending edits before signing out.");
      }

      return;
    }

    while (this.queue.length && !this.closed) {
      const changes = this.queue[0];

      if (!changes) {
        break;
      }

      // Persist receipt metadata for legacy queues before the first network write.
      if (!changes[0]?.operationId) {
        this.persistQueue(this.queue);
        continue;
      }

      const operationId = changes[0].operationId;
      const payload = changes.map(({ key, expected, value }) => ({ key, expected, value }));
      // Each batch assumes the preceding batch committed; parallel writes break revisions.
      // eslint-disable-next-line no-await-in-loop
      await client.mutation(commit, { changes: payload, operationId });

      if (this.closed) {
        return;
      }

      // Replaying a committed batch is safe; forgetting an unpersisted acknowledgment is not.
      this.persistQueue(this.queue.slice(1));
    }

    const value = await client.query(snapshot, {});

    if (!this.closed && !this.queue.length) {
      this.accept(value);
    }
  }
  saveRecovery() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(this.queue, null, 2)], { type: "application/json" }),
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = "set-and-signal-pending-edits.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async conflicts(): Promise<SyncConflict[]> {
    if (!this.client) {
      throw new Error("Reconnect to review changes.");
    }

    const value: unknown = await this.client.query(snapshot, {});

    const remote = new Map(
      splitState(parseStoredState(JSON.stringify(value)) ?? {}).map((row) => [row.key, row.value]),
    );

    return (this.queue[0] ?? [])
      .filter((change) => {
        const current = remote.get(change.key) ?? null;

        return current !== change.expected && current !== change.value;
      })
      .map((change) => ({
        key: change.key,
        local: this.known.get(change.key) ?? null,
        remote: remote.get(change.key) ?? null,
      }));
  }
  async resolve(conflicts: SyncConflict[], choice: "local" | "remote") {
    if (
      conflicts.some((conflict) => conflict.key === "field/unit") &&
      this.queue.some((batch) =>
        batch.some((change) => change.key === "field/unit" && change.expected === change.value),
      )
    ) {
      throw new Error(
        "Weight units changed on another device. Export pending edits and review their original units before merging.",
      );
    }

    // Retain both the original pending edits and the reviewed remote versions.
    localStorage.setItem(
      `${this.key}:recovery:${Date.now()}`,
      JSON.stringify({ queue: this.queue, conflicts }),
    );
    const reviewed = new Map(conflicts.map((conflict) => [conflict.key, conflict]));
    const seen = new Set<string>();

    const next = this.queue
      .map((batch) =>
        batch.flatMap((change) => {
          const conflict = reviewed.get(change.key);

          if (!conflict) {
            return [change];
          }

          if (choice === "remote") {
            return [];
          }

          if (seen.has(change.key)) {
            return [change];
          }

          seen.add(change.key);

          return [{ ...change, expected: conflict.remote }];
        }),
      )
      .filter((batch) => batch.length);

    this.persistQueue(next);
    this.problem = undefined;
    this.publish();

    try {
      await this.flush();
    } catch (error) {
      this.failed(error);
      throw error;
    }
  }
  async close() {
    this.closed = true;
    this.stop?.();
    this.stopConnection?.();
    await this.client?.close();
  }
}
