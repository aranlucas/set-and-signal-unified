import { z } from "zod";
import { hostedDocumentSchema, type HostedDocument } from "../domain/hosted";
import type { FivefoldPolicyState } from "@set-and-signal/training/fivefold";
import { randomUUID } from "expo-crypto";
import { canonical, joinState, type RecordValue } from "@set-and-signal/training/state";
import { fivefoldWorkout, convertLoad, LIFT_IDS } from "@set-and-signal/training/records";
import { ROUTINE } from "@set-and-signal/training/fivefold";
import type { AppState, Session, Unit } from "../domain/workout";
import type { StorageDatabase } from "./storage";

export interface CloudChange {
  key: string;
  expected: string | null;
  value: string | null;
}

export interface PendingBatch {
  seq: number;
  operationId: string;
  changes: CloudChange[];
}

interface Identity {
  uid: string;
  unit: Unit;
}

interface QueuedRow {
  seq: number;
  value: string;
}

interface Identified {
  id: string;
}

interface RemoteID {
  remote_id: string;
}

interface RemoteBinding extends RemoteID {
  owner: string;
}

interface NullableValueRow {
  value: string | null;
}

const orderSchema = z.array(z.string());

export const cloudChangeSchema = z.object({
  key: z.string(),
  expected: z.string().nullable(),
  value: z.string().nullable(),
});

const changesSchema = z.array(cloudChangeSchema);

interface ValueRow {
  value: string;
}

export function prepareCloudStorage(db: StorageDatabase): void {
  db.execSync(`CREATE TABLE IF NOT EXISTS cloud_identity(id INTEGER PRIMARY KEY CHECK(id=1),uid TEXT NOT NULL,unit TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cloud_records(uid TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(uid,key));
    CREATE TABLE IF NOT EXISTS cloud_queue(seq INTEGER PRIMARY KEY AUTOINCREMENT,uid TEXT NOT NULL,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cloud_ids(local_id TEXT PRIMARY KEY,remote_id TEXT NOT NULL,owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cloud_publications(uid TEXT NOT NULL,request TEXT NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(uid,request));
    CREATE TABLE IF NOT EXISTS cloud_drafts(uid TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cloud_installation(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cloud_plan_baseline(uid TEXT NOT NULL,key TEXT NOT NULL,value TEXT,PRIMARY KEY(uid,key));`);
}

export function setCloudIdentity(db: StorageDatabase, uid: string | null, unit: Unit = "lb"): void {
  prepareCloudStorage(db);

  if (uid === null) {
    db.runSync("DELETE FROM cloud_identity");
  } else {
    db.runSync(
      "INSERT INTO cloud_identity(id,uid,unit) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET uid=excluded.uid,unit=excluded.unit",
      uid,
      unit,
    );
  }
}

export function cloudRecords(db: StorageDatabase, uid: string): RecordValue[] {
  return db.getAllSync<RecordValue>("SELECT key,value FROM cloud_records WHERE uid=?", uid);
}

export function cloudProfile(db: StorageDatabase, uid: string): HostedDocument {
  return hostedDocumentSchema.parse(joinState(cloudRecords(db, uid), 0));
}

export function pendingBatches(db: StorageDatabase, uid: string): PendingBatch[] {
  let installation = db.getFirstSync<ValueRow>(
    "SELECT value FROM cloud_installation WHERE id=1",
  )?.value;

  if (!installation) {
    installation = randomUUID();
    db.runSync("INSERT INTO cloud_installation(id,value) VALUES(1,?)", installation);
  }

  return db
    .getAllSync<QueuedRow>("SELECT seq,value FROM cloud_queue WHERE uid=? ORDER BY seq", uid)
    .map((row) => ({
      seq: row.seq,
      operationId: `${installation}/${uid}/${row.seq}`,
      changes: changesSchema.parse(JSON.parse(row.value)),
    }));
}

function applyChanges(db: StorageDatabase, uid: string, changes: CloudChange[]): void {
  for (const change of changes) {
    if (change.value === null) {
      db.runSync("DELETE FROM cloud_records WHERE uid=? AND key=?", uid, change.key);
    } else {
      db.runSync(
        "INSERT INTO cloud_records(uid,key,value) VALUES(?,?,?) ON CONFLICT(uid,key) DO UPDATE SET value=excluded.value",
        uid,
        change.key,
        change.value,
      );
    }
  }
}

export function queueCloudChanges(db: StorageDatabase, uid: string, changes: CloudChange[]): void {
  const changed = changes.filter((change) => change.expected !== change.value);

  if (!changed.length) {
    return;
  }

  // A load captured under another display unit must surface a conflict.
  if (
    !changed.some((change) => change.key === "field/unit") &&
    changed.some((change) => change.value !== null && /^(workouts|routines)\//.test(change.key))
  ) {
    const unit =
      db.getFirstSync<ValueRow>(
        "SELECT value FROM cloud_records WHERE uid=? AND key='field/unit'",
        uid,
      )?.value ?? null;
    changed.push({ key: "field/unit", expected: unit, value: unit });
  }

  db.runSync("INSERT INTO cloud_queue(uid,value) VALUES(?,?)", uid, JSON.stringify(changed));
  applyChanges(db, uid, changed);
}

export function stageWorkout(
  db: StorageDatabase,
  uid: string,
  workout: Identified,
  value: string,
): void {
  const key = `workouts/${workout.id}`;

  const expected =
    db.getFirstSync<ValueRow>("SELECT value FROM cloud_records WHERE uid=? AND key=?", uid, key)
      ?.value ?? null;

  if (expected === value) {
    return;
  }

  const orderKey = "order/workouts";

  const oldOrder =
    db.getFirstSync<ValueRow>(
      "SELECT value FROM cloud_records WHERE uid=? AND key=?",
      uid,
      orderKey,
    )?.value ?? null;

  const order = orderSchema.parse(JSON.parse(oldOrder ?? "[]"));

  if (!order.includes(workout.id)) {
    order.push(workout.id);
  }

  queueCloudChanges(db, uid, [
    { key, expected, value },
    { key: orderKey, expected: oldOrder, value: canonical(order) },
  ]);
}

function stageLegacy(db: StorageDatabase, identity: Identity, session: Session): void {
  let binding = db.getFirstSync<RemoteBinding>(
    "SELECT remote_id,owner FROM cloud_ids WHERE local_id=?",
    session.id,
  );

  // A later account never inherits another account's device history implicitly.
  if (binding && binding.owner !== identity.uid) {
    return;
  }

  if (!binding) {
    binding = { remote_id: randomUUID(), owner: identity.uid };
    db.runSync(
      "INSERT INTO cloud_ids(local_id,remote_id,owner) VALUES(?,?,?)",
      session.id,
      binding.remote_id,
      identity.uid,
    );
  }

  const workout = fivefoldWorkout(session, identity.unit, binding.remote_id);
  workout.source = { provider: "fivefold", id: binding.remote_id, recordedUnit: session.unit };
  stageWorkout(db, identity.uid, workout, canonical(workout));
}

/** Called inside the same transaction that commits local history/progression. */
export function stageLegacyHistory(db: StorageDatabase, state: AppState, before: Session[]): void {
  const identity = db.getFirstSync<Identity>("SELECT uid,unit FROM cloud_identity WHERE id=1");

  if (!identity) {
    return;
  }

  const previous = new Map(before.map((session) => [session.id, session]));

  for (const session of state.history) {
    if (previous.get(session.id) !== session) {
      stageLegacy(db, identity, session);
    }
  }

  const retained = new Set(state.history.map((session) => session.id));

  for (const session of before) {
    if (retained.has(session.id)) {
      continue;
    }

    const binding = db.getFirstSync<RemoteBinding>(
      "SELECT remote_id,owner FROM cloud_ids WHERE local_id=?",
      session.id,
    );

    if (!binding || binding.owner !== identity.uid) {
      continue;
    }

    const key = `workouts/${binding.remote_id}`;

    const expected =
      db.getFirstSync<ValueRow>(
        "SELECT value FROM cloud_records WHERE uid=? AND key=?",
        identity.uid,
        key,
      )?.value ?? null;

    const orderKey = "order/workouts";

    const oldOrder =
      db.getFirstSync<ValueRow>(
        "SELECT value FROM cloud_records WHERE uid=? AND key=?",
        identity.uid,
        orderKey,
      )?.value ?? null;

    const order = orderSchema
      .parse(JSON.parse(oldOrder ?? "[]"))
      .filter((id) => id !== binding.remote_id);

    queueCloudChanges(db, identity.uid, [
      { key, expected, value: null },
      { key: orderKey, expected: oldOrder, value: canonical(order) },
    ]);
  }
}

/** Explicit, reviewed guest-history import. Existing owners remain isolated. */
export function importPhoneHistory(
  db: StorageDatabase,
  uid: string,
  unit: Unit,
  state: AppState,
): void {
  db.withTransactionSync(() => {
    setCloudIdentity(db, uid, unit);
    stageLegacyHistory(db, state, []);
    stageFivefoldPlan(db, state);
  });
}

export function stageFivefoldPlan(db: StorageDatabase, state: AppState): void {
  const identity = db.getFirstSync<Identity>("SELECT uid,unit FROM cloud_identity WHERE id=1");

  if (!identity) {
    return;
  }

  const changes: CloudChange[] = [];

  for (const kind of ["A", "B"] as const) {
    const id = `fivefold-${kind}`;
    const key = `routines/${id}`;

    const baseline = db.getFirstSync<NullableValueRow>(
      "SELECT value FROM cloud_plan_baseline WHERE uid=? AND key=?",
      identity.uid,
      key,
    );

    const expected = baseline
      ? baseline.value
      : (db.getFirstSync<ValueRow>(
          "SELECT value FROM cloud_records WHERE uid=? AND key=?",
          identity.uid,
          key,
        )?.value ?? null);

    const routine = {
      id,
      name: `5×5 Workout ${kind}`,
      emoji: "barbell",
      prog: "fivefold",
      ex: ROUTINE[kind].map((lift) => {
        const plan = state.plans[lift];
        const localId = plan.lastWorkoutId;

        const binding = localId
          ? db.getFirstSync<RemoteID>(
              "SELECT remote_id FROM cloud_ids WHERE local_id=? AND owner=?",
              localId,
              identity.uid,
            )
          : null;

        const fivefold: FivefoldPolicyState = {
          unit: state.settings.unit,
          failures: plan.failures,
          bar: state.settings.bar,
          autoProgress: state.settings.autoProgress,
          autoDeload: state.settings.autoDeload,
        };

        if (localId) {
          fivefold.lastWorkoutId = binding?.remote_id ?? localId;
        }

        return {
          id: LIFT_IDS[lift],
          sets: lift === "deadlift" ? 1 : 5,
          reps: 5,
          weight: convertLoad(plan.weight, state.settings.unit, identity.unit),
          inc: convertLoad(plan.increment, state.settings.unit, identity.unit),
          fivefold,
        };
      }),
    };

    changes.push({ key, expected, value: canonical(routine) });
  }

  const key = "order/routines";

  const expected =
    db.getFirstSync<ValueRow>(
      "SELECT value FROM cloud_records WHERE uid=? AND key=?",
      identity.uid,
      key,
    )?.value ?? null;

  const order = orderSchema.parse(JSON.parse(expected ?? "[]"));

  for (const id of ["fivefold-A", "fivefold-B"]) {
    if (!order.includes(id)) {
      order.push(id);
    }
  }

  changes.push({ key, expected, value: canonical(order) });
  const nextKey = "field/fivefoldNext";
  const oldNext =
    db.getFirstSync<ValueRow>(
      "SELECT value FROM cloud_records WHERE uid=? AND key=?",
      identity.uid,
      nextKey,
    )?.value ?? null;
  changes.push({ key: nextKey, expected: oldNext, value: canonical(state.next) });
  queueCloudChanges(db, identity.uid, changes);
  db.runSync("DELETE FROM cloud_plan_baseline WHERE uid=?", identity.uid);
}

export function freezePlanBaseline(db: StorageDatabase): void {
  const identity = db.getFirstSync<Identity>("SELECT uid,unit FROM cloud_identity WHERE id=1");

  if (!identity) {
    return;
  }

  for (const key of ["routines/fivefold-A", "routines/fivefold-B"]) {
    const value =
      db.getFirstSync<ValueRow>(
        "SELECT value FROM cloud_records WHERE uid=? AND key=?",
        identity.uid,
        key,
      )?.value ?? null;

    db.runSync(
      "INSERT INTO cloud_plan_baseline(uid,key,value) VALUES(?,?,?) ON CONFLICT(uid,key) DO UPDATE SET value=excluded.value",
      identity.uid,
      key,
      value,
    );
  }
}

export function receiveCloudRecords(
  db: StorageDatabase,
  uid: string,
  records: RecordValue[],
): void {
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM cloud_records WHERE uid=?", uid);
    applyChanges(
      db,
      uid,
      records.map((record) => ({ ...record, expected: null })),
    );

    // A received snapshot never erases local queued edits. Expected values stay
    // intact so competing changes are surfaced instead of silently overwritten.
    for (const batch of pendingBatches(db, uid)) {
      applyChanges(db, uid, batch.changes);
    }
  });
}

export function acknowledgeBatch(db: StorageDatabase, uid: string, seq: number): void {
  db.runSync("DELETE FROM cloud_queue WHERE uid=? AND seq=?", uid, seq);
}
