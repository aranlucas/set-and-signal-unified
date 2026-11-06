import { randomUUID } from "expo-crypto";
import {
  hostedProfileSchema,
  hostedDraftSchema,
  type HostedDraft,
  type HostedDocument,
  hostedDocumentSchema,
} from "../domain/hosted";
import {
  reconcileGarminRecording,
  unlinkGarminRecording,
} from "@set-and-signal/training/reconcile";
import {
  assignRecordedRoutine,
  type GarminRecordingPreview,
} from "@set-and-signal/training/garmin-recording";
import { useSyncExternalStore } from "react";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { canonical, splitState } from "@set-and-signal/training/state";
import {
  convertLoad,
  LIFT_IDS,
  workoutSourceSchema,
  type RecordedWorkout,
} from "@set-and-signal/training/records";
import { LIFTS } from "@set-and-signal/training/fivefold";
import type { garminStrengthWorkout } from "@set-and-signal/training/garmin";
import { cloudDatabase } from "./storage";
import { getSnapshot, commit } from "./store";
import {
  acknowledgeBatch,
  cloudProfile,
  importPhoneHistory,
  pendingBatches,
  receiveCloudRecords,
  setCloudIdentity,
  stageWorkout,
  queueCloudChanges,
  cloudRecords,
  type CloudChange,
  cloudChangeSchema,
} from "./cloud-storage";

const SESSION_KEY = "set-and-signal-session";

const sessionSchema = z.object({
  base: z.url(),
  user: z.object({ id: z.string(), name: z.string() }),
  clientId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  issuedAt: z.number(),
  expiresIn: z.number(),
});

type Session = z.infer<typeof sessionSchema>;

export interface CloudSnapshot {
  user: { id: string; name: string } | null;
  base: string;
  phase: "disconnected" | "loading" | "saved" | "saving" | "offline" | "conflict";
  pending: number;
  error: string;
  profile: HostedDocument;
}

let snapshot: CloudSnapshot = {
  user: null,
  base: "",
  phase: "disconnected",
  pending: 0,
  error: "",
  profile: {},
};

let session: Session | null = null;

let generation = 0;

let client: ConvexClient | undefined;

let stop: (() => void) | undefined;

interface FlushOperation {
  generation: number;
  promise: Promise<void>;
}

let flushing: FlushOperation | undefined;

let credentialWrite: Promise<void> = Promise.resolve();

let refreshing: Promise<void> | undefined;

const listeners = new Set<() => void>();

function publish(patch: Partial<CloudSnapshot>) {
  snapshot = { ...snapshot, ...patch };

  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useCloud() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function useCloudUser() {
  return useSyncExternalStore(subscribe, () => snapshot.user);
}

export function cloudSnapshot() {
  return snapshot;
}

function discovery(base: string): AuthSession.DiscoveryDocument {
  return { authorizationEndpoint: base + "/oauth/authorize", tokenEndpoint: base + "/oauth/token" };
}

function persist(credentials: Session | null): Promise<void> {
  const started = generation;
  const previous = credentialWrite;

  const writing = (async () => {
    try {
      await previous;
    } catch {
      /* A later clear or sign-in still needs to run. */
    }

    if (started !== generation) {
      return;
    }

    if (credentials) {
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(credentials));

      if (started === generation) {
        session = credentials;
      }
    } else {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    }
  })();

  credentialWrite = writing;

  return writing;
}

async function token(): Promise<string> {
  if (!session) {
    throw new Error("Sign in to Set & Signal first");
  }

  if (Date.now() / 1000 > session.issuedAt + session.expiresIn - 60) {
    refreshing ??= (async () => {
      const current = session;
      const started = generation;

      if (!current?.refreshToken) {
        throw new Error("Sign in again to synchronize");
      }

      const refreshed = await AuthSession.refreshAsync(
        { clientId: current.clientId, refreshToken: current.refreshToken },
        discovery(current.base),
      );

      // An account change during refresh cannot resurrect a signed-out session.
      if (generation !== started) {
        return;
      }

      await persist({
        ...current,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? current.refreshToken,
        issuedAt: refreshed.issuedAt,
        expiresIn: refreshed.expiresIn ?? 3600,
      });
    })().finally(() => {
      refreshing = undefined;
    });
    await refreshing;
  }

  if (!session) {
    throw new Error("Sign in again to synchronize");
  }

  return session.accessToken;
}

const jsonPayloadSchema = z.json();

type JSONPayload = z.infer<typeof jsonPayloadSchema>;

const commitInputSchema = z.object({
  changes: z.array(cloudChangeSchema),
  operationId: z.string(),
});

type CommitInput = z.infer<typeof commitInputSchema>;

interface ValueRow {
  value: string;
}

interface PublicationRow {
  operation_id: string;
}

interface WatchPublication {
  date: string;
  workout: ReturnType<typeof garminStrengthWorkout>["workout"];
}

export async function cloudApi(path: string, init: RequestInit = {}): Promise<JSONPayload> {
  const current = session;

  if (!current) {
    throw new Error("Sign in to continue");
  }

  const accessToken = await token();

  if (session?.user.id !== current.user.id || session.base !== current.base) {
    throw new Error("Account changed");
  }

  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(current.base + path, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30000),
  });

  const body: unknown = await response.json();

  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(body);
    throw new Error(parsed.success ? parsed.data.error : `Request failed (${response.status})`);
  }

  return jsonPayloadSchema.parse(body);
}

export async function signIn(baseInput: string): Promise<void> {
  const url = new URL(baseInput.trim());

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname))
  ) {
    throw new Error("Use your server's HTTPS address");
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Enter the server origin without a path");
  }

  const base = url.origin;
  publish({ phase: "loading", error: "" });
  const redirectUri = AuthSession.makeRedirectUri({ path: "oauth" });

  try {
    const response = await fetch(base + "/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Set & Signal Android",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        scope: "openid workset offline_access",
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error("Could not register this device with the server");
    }

    const registered = z.object({ client_id: z.string() }).parse(await response.json());

    const request = new AuthSession.AuthRequest({
      clientId: registered.client_id,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      scopes: ["openid", "workset", "offline_access"],
      extraParams: { resource: base + "/mcp" },
    });

    await request.makeAuthUrlAsync(discovery(base));
    const result = await request.promptAsync(discovery(base));

    if (result.type !== "success") {
      throw new Error("Sign-in cancelled");
    }

    if (!request.codeVerifier) {
      throw new Error("Could not verify sign-in");
    }

    const tokens = await AuthSession.exchangeCodeAsync(
      {
        clientId: registered.client_id,
        code: result.params.code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      },
      discovery(base),
    );

    const identity = await fetch(base + "/api/native/me", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(30000),
    });

    if (!identity.ok) {
      throw new Error("Could not verify the signed-in account");
    }

    const { user } = z
      .object({ user: z.object({ id: z.string(), name: z.string() }) })
      .parse(await identity.json());

    generation += 1;
    await persist({
      base,
      user,
      clientId: registered.client_id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      issuedAt: tokens.issuedAt,
      expiresIn: tokens.expiresIn ?? 3600,
    });
    await connect();
  } catch (error) {
    publish({
      phase: session ? "offline" : "disconnected",
      error: error instanceof Error ? error.message : "Sign-in failed",
    });
    throw error;
  }
}

const snapshotRef = makeFunctionReference<"query", Record<string, never>, unknown>(
  "training:snapshot",
);

const commitRef = makeFunctionReference<"mutation", CommitInput, null>("training:commit");

const snapshotSchema = z.nullable(hostedDocumentSchema);

async function connect(): Promise<void> {
  const current = session;
  const started = generation;

  if (!current) {
    return;
  }

  stop?.();
  await client?.close();

  const credentials = z
    .object({ token: z.string(), url: z.string(), userId: z.literal(current.user.id) })
    .parse(await cloudApi("/api/convex/token"));

  if (generation !== started) {
    return;
  }

  client = new ConvexClient(credentials.url);
  client.setAuth(
    async () => z.object({ token: z.string() }).parse(await cloudApi("/api/convex/token")).token,
  );
  publish({ user: current.user, base: current.base, phase: "loading", error: "" });
  stop = client.onUpdate(
    snapshotRef,
    {},
    (raw) => {
      if (session?.user.id !== current.user.id) {
        return;
      }

      const received = snapshotSchema.parse(raw);
      receiveCloudRecords(cloudDatabase(), current.user.id, splitState(received ?? {}));
      const profile = cloudProfile(cloudDatabase(), current.user.id);
      setCloudIdentity(cloudDatabase(), current.user.id, profile.unit === "kg" ? "kg" : "lb");
      applyHostedFivefold(profile);
      publish({
        profile,
        phase: "saved",
        pending: pendingBatches(cloudDatabase(), current.user.id).length,
      });
      void synchronize().catch(reportFailure);
    },
    reportFailure,
  );
}

function reportFailure(error: Error) {
  publish({
    phase: String(error).includes("CONFLICT") ? "conflict" : "offline",
    error:
      error instanceof Error ? error.message : "Synchronization paused. Local edits are saved.",
  });
}

export async function restoreCloudSession(): Promise<void> {
  const started = generation;

  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);

    if (!raw || started !== generation) {
      return;
    }

    session = sessionSchema.parse(JSON.parse(raw));
    prepareLocal();
    publish({
      user: session.user,
      base: session.base,
      profile: cloudProfile(cloudDatabase(), session.user.id),
      phase: "loading",
    });
    await connect();
  } catch (error) {
    reportFailure(error instanceof Error ? error : new Error("Synchronization paused"));
  }
}

function prepareLocal() {
  cloudDatabase();
}

export function synchronize(): Promise<void> {
  const current = session;
  const started = generation;

  if (flushing?.generation === started) {
    return flushing.promise;
  }

  const activeClient = client;

  if (!current || !activeClient) {
    return Promise.resolve();
  }

  const pending = (async () => {
    for (const batch of pendingBatches(cloudDatabase(), current.user.id)) {
      if (generation !== started) {
        return;
      }

      publish({
        phase: "saving",
        error: "",
        pending: pendingBatches(cloudDatabase(), current.user.id).length,
      });
      // Each batch uses the preceding batch's expected values.
      // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve the preceding completion before applying the next revision.
      await activeClient.mutation(
        commitRef,
        commitInputSchema.parse({
          changes: batch.changes,
          operationId: batch.operationId,
        }),
      );

      for (const change of batch.changes) {
        // A completed request must not continue with a different account's credentials.
        if (generation !== started) {
          return;
        }

        if (change.key.startsWith("workouts/") && change.value !== null) {
          // Preserve completion order and finish progression before acknowledging this batch.
          // oxlint-disable-next-line eslint/no-await-in-loop -- Preserve the preceding completion before applying the next revision.
          await cloudApi("/api/workout/finalize", {
            method: "POST",
            body: JSON.stringify({ id: change.key.slice(9) }),
          });
        }
      }

      if (generation !== started) {
        return;
      }

      acknowledgeBatch(cloudDatabase(), current.user.id, batch.seq);
    }

    if (generation !== started) {
      return;
    }

    publish({
      phase: "saved",
      pending: pendingBatches(cloudDatabase(), current.user.id).length,
      profile: cloudProfile(cloudDatabase(), current.user.id),
    });
  })()
    .catch((error: Error) => {
      if (generation === started) {
        reportFailure(error);
      }

      throw error;
    })
    .finally(() => {
      if (flushing?.promise === pending) {
        flushing = undefined;
      }
    });

  flushing = { generation: started, promise: pending };

  return pending;
}

export async function retryCloud(): Promise<void> {
  if (!client) {
    await connect();
  }

  await synchronize();
}

export async function importDeviceHistory(): Promise<void> {
  const current = session;

  if (!current) {
    throw new Error("Sign in first");
  }

  importPhoneHistory(
    cloudDatabase(),
    current.user.id,
    snapshot.profile.unit === "kg" ? "kg" : "lb",
    getSnapshot().state,
  );
  publish({
    pending: pendingBatches(cloudDatabase(), current.user.id).length,
    profile: cloudProfile(cloudDatabase(), current.user.id),
  });
  await synchronize();
}

export function saveRecordedWorkout(workout: RecordedWorkout): Promise<void> {
  const current = session;

  if (!current) {
    throw new Error("Sign in first");
  }

  cloudDatabase().withTransactionSync(() => {
    stageWorkout(cloudDatabase(), current.user.id, workout, canonical(workout));
    cloudDatabase().runSync("DELETE FROM cloud_drafts WHERE uid=?", current.user.id);
  });
  publish({
    pending: pendingBatches(cloudDatabase(), current.user.id).length,
    profile: cloudProfile(cloudDatabase(), current.user.id),
  });
  // A failed network write leaves the committed local record and outbox intact.
  void synchronize().catch(reportFailure);

  return Promise.resolve();
}

export async function signOut(): Promise<void> {
  if (session && readHostedDraft()) {
    throw new Error("Finish or discard the planned session before signing out");
  }

  generation += 1;
  session = null;
  stop?.();
  stop = undefined;
  await client?.close();
  client = undefined;
  setCloudIdentity(cloudDatabase(), null);
  await persist(null);
  publish({ user: null, base: "", phase: "disconnected", pending: 0, error: "", profile: {} });
}

export function recoveryFile(): string {
  return JSON.stringify(
    {
      format: "set-and-signal-recovery",
      user: snapshot.user,
      profile: snapshot.profile,
      pending: snapshot.user ? pendingBatches(cloudDatabase(), snapshot.user.id) : [],
    },
    null,
    2,
  );
}

function applyHostedFivefold(profile: HostedDocument): void {
  const parsed = hostedProfileSchema.safeParse(profile);

  if (!parsed.success) {
    return;
  }

  if (getSnapshot().state.active) {
    return;
  }

  const routines = parsed.data.routines.filter((routine) => routine.prog === "fivefold");

  if (!routines.length) {
    return;
  }

  commit((state) => {
    const first = routines[0].ex.find((cfg) => cfg.fivefold)?.fivefold;

    if (!first) {
      return state;
    }

    const unit = first.unit ?? parsed.data.unit;
    const plans = { ...state.plans };

    for (const key of LIFTS) {
      const id = LIFT_IDS[key];

      const cfg = routines
        .flatMap((routine) => routine.ex)
        .find((candidate) => candidate.id === id);

      if (cfg?.weight === undefined) {
        continue;
      }

      plans[key] = {
        weight: Math.round(convertLoad(cfg.weight, parsed.data.unit, unit) * 1000) / 1000,
        increment:
          Math.round(
            convertLoad(cfg.inc ?? (parsed.data.unit === "kg" ? 2.5 : 5), parsed.data.unit, unit) *
              1000,
          ) / 1000,
        failures: cfg.fivefold?.failures ?? 0,
        lastWorkoutId: cfg.fivefold?.lastWorkoutId,
      };
    }

    const settings = {
      ...state.settings,
      unit,
      bar: first.bar,
      autoProgress: first.autoProgress,
      autoDeload: first.autoDeload,
    };

    const next = parsed.data.fivefoldNext ?? state.next;

    return canonical({ plans, settings, next }) ===
      canonical({ plans: state.plans, settings: state.settings, next: state.next })
      ? state
      : { ...state, plans, settings, next };
  }, "cloud");
}

export function readHostedDraft(): HostedDraft | null {
  if (!session) {
    return null;
  }

  const row = cloudDatabase().getFirstSync<ValueRow>(
    "SELECT value FROM cloud_drafts WHERE uid=?",
    session.user.id,
  );

  return row ? hostedDraftSchema.parse(JSON.parse(row.value)) : null;
}

export function writeHostedDraft(draft: HostedDraft | null): void {
  if (!session) {
    throw new Error("Sign in first");
  }

  if (draft) {
    cloudDatabase().runSync(
      "INSERT INTO cloud_drafts(uid,value) VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET value=excluded.value",
      session.user.id,
      JSON.stringify(hostedDraftSchema.parse(draft)),
    );
  } else {
    cloudDatabase().runSync("DELETE FROM cloud_drafts WHERE uid=?", session.user.id);
  }
}

export async function acceptGarminRecording(
  preview: GarminRecordingPreview,
  matchId?: string,
  routineId?: string,
): Promise<void> {
  const current = session;

  if (!current || !preview.workout) {
    throw new Error("No recorded sets to import");
  }

  const known = z
    .array(
      z.looseObject({
        id: z.string(),
        source: workoutSourceSchema.optional(),
        garminActivityIds: z.array(z.string()).optional(),
      }),
    )
    .parse(snapshot.profile.workouts ?? []);

  const routine = hostedProfileSchema
    .parse(snapshot.profile)
    .routines.find((candidate) => candidate.id === routineId);

  const recorded =
    routine && !matchId ? assignRecordedRoutine(preview.workout, routine) : preview.workout;

  const merged = reconcileGarminRecording(known, recorded, matchId);

  const before = new Map(
    cloudRecords(cloudDatabase(), current.user.id).map((row) => [row.key, row.value]),
  );

  const changes: CloudChange[] = [];

  for (const record of merged) {
    const key = `workouts/${record.id}`;
    changes.push({ key, expected: before.get(key) ?? null, value: canonical(record) });
  }

  for (const record of known) {
    if (!merged.some((candidate) => candidate.id === record.id)) {
      const key = `workouts/${record.id}`;
      changes.push({ key, expected: before.get(key) ?? null, value: null });
    }
  }

  changes.push({
    key: "order/workouts",
    expected: before.get("order/workouts") ?? null,
    value: canonical(merged.map((record) => record.id)),
  });
  const customs = z.array(z.looseObject({ id: z.string() })).parse(snapshot.profile.customEx ?? []);

  for (const exercise of preview.customExercises) {
    if (!customs.some((candidate) => candidate.id === exercise.id)) {
      customs.push(exercise);
      changes.push({ key: `customEx/${exercise.id}`, expected: null, value: canonical(exercise) });
    }
  }

  changes.push({
    key: "order/customEx",
    expected: before.get("order/customEx") ?? null,
    value: canonical(customs.map((exercise) => exercise.id)),
  });
  cloudDatabase().withTransactionSync(() =>
    queueCloudChanges(cloudDatabase(), current.user.id, changes),
  );
  publish({
    profile: cloudProfile(cloudDatabase(), current.user.id),
    pending: pendingBatches(cloudDatabase(), current.user.id).length,
  });
  await synchronize();
}

export function watchPublicationId(request: WatchPublication): string {
  if (!session) {
    throw new Error("Sign in first");
  }

  const serialized = canonical(request);
  const db = cloudDatabase();

  const existing = db.getFirstSync<PublicationRow>(
    "SELECT operation_id FROM cloud_publications WHERE uid=? AND request=?",
    session.user.id,
    serialized,
  );

  if (existing) {
    return existing.operation_id;
  }

  const id = randomUUID();
  db.runSync(
    "INSERT INTO cloud_publications(uid,request,operation_id) VALUES(?,?,?)",
    session.user.id,
    serialized,
    id,
  );

  return id;
}

export function unlinkWatchRecording(workoutId: string, activityId: string): void {
  if (!session) {
    throw new Error("Sign in first");
  }

  const db = cloudDatabase();
  const uid = session.user.id;

  const row = db.getFirstSync<ValueRow>(
    "SELECT value FROM cloud_records WHERE uid=? AND key=?",
    session.user.id,
    `workouts/${workoutId}`,
  );

  if (!row) {
    throw new Error("Workout no longer exists");
  }

  const record = z
    .looseObject({ id: z.string(), garminActivityIds: z.array(z.string()).optional() })
    .parse(JSON.parse(row.value));

  const [next] = unlinkGarminRecording([record], workoutId, activityId);
  db.withTransactionSync(() => stageWorkout(db, uid, record, canonical(next)));
  publish({
    profile: cloudProfile(db, session.user.id),
    pending: pendingBatches(db, session.user.id).length,
  });
  void synchronize().catch(reportFailure);
}
