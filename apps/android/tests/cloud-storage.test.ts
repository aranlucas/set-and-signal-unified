import { beforeEach, describe, expect, it } from "vitest";
import { canonical, splitState } from "@set-and-signal/training/state";
import { recordedWorkoutSchema } from "@set-and-signal/training/records";
import { initialState, startSession, finishSession, logSet } from "../src/domain/workout";
import { createStorage } from "../src/data/storage";
import {
  acknowledgeBatch,
  cloudProfile,
  cloudRecords,
  importPhoneHistory,
  pendingBatches,
  receiveCloudRecords,
  setCloudIdentity,
  stageFivefoldPlan,
  freezePlanBaseline,
} from "../src/data/cloud-storage";
import { createSqliteAdapter } from "./support/sqlite";

const { database: db, reset } = createSqliteAdapter();

const NOW = 1792900000000;

beforeEach(reset);

describe("offline account outbox", () => {
  it("persists received plan changes without echoing a new outgoing edit", () => {
    const storage = createStorage(() => db);
    const initial = storage.loadState();
    setCloudIdentity(db, "alice", "kg");

    const next = {
      ...initial,
      plans: { ...initial.plans, squat: { ...initial.plans.squat, weight: 80 } },
    };

    storage.saveState(next, "cloud");
    expect(storage.loadState()).toEqual(next);
    expect(pendingBatches(db, "alice")).toEqual([]);
  });
  it("rolls back history, progression, identity binding and outbox when queue persistence fails", () => {
    const storage = createStorage(() => db);
    storage.loadState();
    const active = logSet(startSession(initialState("lb"), NOW), "squat", 0, 0, NOW + 1000);
    storage.saveState(active);
    setCloudIdentity(db, "alice", "kg");
    db.execSync(
      "CREATE TRIGGER reject_queue BEFORE INSERT ON cloud_queue BEGIN SELECT RAISE(FAIL, 'disk full'); END;",
    );
    const finished = finishSession(active, NOW + 2000);
    expect(() => storage.saveState(finished)).toThrow("disk full");
    expect(storage.loadState()).toEqual(active);
    expect(pendingBatches(db, "alice")).toEqual([]);
    expect(db.getAllSync("SELECT * FROM cloud_ids")).toHaveLength(0);
    db.execSync("DROP TRIGGER reject_queue");
    storage.saveState(finished);
    expect(storage.loadState()).toEqual(finished);
    expect(pendingBatches(db, "alice").length).toBeGreaterThan(0);
  });

  it("keeps original loads, zero attempts, skipped sets and stable operation IDs after reopening", () => {
    const storage = createStorage(() => db);
    storage.loadState();
    setCloudIdentity(db, "alice", "kg");
    const active = logSet(startSession(initialState("lb"), NOW), "squat", 0, 0, NOW + 1000);
    storage.saveState(active);
    const finished = finishSession(active, NOW + 2000);
    storage.saveState(finished);
    const before = pendingBatches(db, "alice");
    createStorage(() => db).loadState();
    expect(pendingBatches(db, "alice")).toEqual(before);
    const row = cloudRecords(db, "alice").find((record) => record.key.startsWith("workouts/"));
    const record = recordedWorkoutSchema.parse(JSON.parse(row?.value ?? "null"));
    expect(record.source?.recordedUnit).toBe("lb");
    expect(record.entries[0].sets[0]).toMatchObject({ done: true, r: 0, recordedWeight: 45 });
    expect(record.entries[0].sets[0].w).toBeCloseTo(20.41165665);
    expect(record.entries[0].sets[1].done).toBe(false);
    expect(record.progressionApplied).toContain("0043");
    acknowledgeBatch(db, "bob", before[0].seq);
    expect(pendingBatches(db, "alice")).toEqual(before);
    importPhoneHistory(db, "bob", "kg", finished);
    expect(cloudRecords(db, "bob").filter((item) => item.key.startsWith("workouts/"))).toEqual([]);
  });

  it("preserves queued expected values when snapshots arrive and freezes the plan at session start", () => {
    const storage = createStorage(() => db);
    storage.loadState();
    setCloudIdentity(db, "alice", "kg");
    const old = { id: "fivefold-A", name: "A", ex: [] };
    receiveCloudRecords(db, "alice", splitState({ routines: [old] }));
    freezePlanBaseline(db);
    receiveCloudRecords(db, "alice", splitState({ routines: [{ ...old, name: "Edited on web" }] }));
    db.withTransactionSync(() => stageFivefoldPlan(db, initialState("kg")));
    const queued = pendingBatches(db, "alice");
    expect(queued[0].changes.find((change) => change.key === "routines/fivefold-A")?.expected).toBe(
      canonical(old),
    );
    receiveCloudRecords(
      db,
      "alice",
      splitState({ routines: [{ ...old, name: "Another web edit" }] }),
    );
    expect(pendingBatches(db, "alice")).toEqual(queued);
    expect(cloudProfile(db, "alice").routines).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "5×5 Workout A" })]),
    );
  });
});
