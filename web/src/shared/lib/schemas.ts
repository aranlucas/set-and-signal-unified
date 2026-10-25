import * as v from "valibot";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { PlanBundle, User } from "@/shared/lib/types.js";
import { ACCENT_NAMES } from "@/shared/lib/accents.js";

/** JSON transport values remain untrusted until a domain schema parses them. */
export type JsonValue =
  | null
  | boolean
  | string
  | number
  | JsonValue[]
  | { [key: string]: JsonValue };

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || v.is(v.union([v.boolean(), v.string(), v.number()]), value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (v.is(v.object({}), value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
};

// A custom predicate validates every own value without a record parser stripping
// data keys such as __proto__, constructor or prototype from a JSON response.
export const jsonValue = v.custom<JsonValue>(isJsonValue, "Invalid JSON value");

const finiteNumber = v.pipe(
  v.number(),
  v.check((value: number) => Number.isFinite(value), "must be finite"),
);

const positiveNumber = v.pipe(finiteNumber, v.minValue(1));

const nonNegativeNumber = v.pipe(finiteNumber, v.minValue(0));

const id = v.pipe(v.string(), v.minLength(1));

const isoDate = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/u));

const unit = v.picklist(["kg", "lb"]);

const mode = v.picklist(["reps", "time", "cardio"]);

const policy = v.picklist(["off", "linear", "greyskull", "double", "time", "fivefold"]);

const weekday = v.picklist(["0", "1", "2", "3", "4", "5", "6"]);

const reminder = v.object({
  on: v.boolean(),
  time: v.string(),
  tz: v.nullable(v.string()),
});

export const exerciseConfig = v.object({
  fivefold: v.optional(
    v.object({
      unit: v.optional(unit),
      failures: nonNegativeNumber,
      bar: positiveNumber,
      autoProgress: v.boolean(),
      autoDeload: v.boolean(),
      lastWorkoutId: v.optional(v.string()),
    }),
  ),
  id,
  sets: positiveNumber,
  mode: v.optional(mode),
  reps: v.optional(finiteNumber),
  weight: v.optional(finiteNumber),
  sec: v.optional(finiteNumber),
  min: v.optional(finiteNumber),
  speed: v.optional(finiteNumber),
  bodyweight: v.optional(v.boolean()),
  side: v.optional(v.boolean()),
  prog: v.optional(policy),
  inc: v.optional(finiteNumber),
  repsMin: v.optional(finiteNumber),
  repsMax: v.optional(finiteNumber),
  sg: v.optional(id),
});

export const sessionPlan = v.object({
  sourceId: id,
  sourceName: v.string(),
  equipment: v.array(v.string()),
  budgetMin: v.pipe(finiteNumber, v.minValue(5), v.maxValue(180)),
  restSec: v.pipe(finiteNumber, v.minValue(0), v.maxValue(600)),
  rows: v.array(v.object({ original: exerciseConfig, planned: v.nullable(exerciseConfig) })),
});

export const routine = v.object({
  id,
  name: v.string(),
  emoji: v.optional(v.string(), ""),
  prog: v.optional(policy),
  ex: v.array(exerciseConfig),
  sessionPlan: v.optional(sessionPlan),
});

const repsSet = v.object({
  recordedWeight: v.optional(nonNegativeNumber),
  done: v.boolean(),
  w: finiteNumber,
  r: finiteNumber,
  rir: v.optional(finiteNumber),
  rpe: v.optional(finiteNumber),
  wu: v.optional(v.boolean()),
});

const timeSet = v.object({
  recordedWeight: v.optional(nonNegativeNumber),
  done: v.boolean(),
  sec: finiteNumber,
  w: finiteNumber,
  rir: v.optional(finiteNumber),
  rpe: v.optional(finiteNumber),
});

const cardioSet = v.object({
  done: v.boolean(),
  min: finiteNumber,
  speed: finiteNumber,
});

const loggedSet = v.union([repsSet, timeSet, cardioSet]);

const translationMessage = v.object({
  key: v.string(),
  defaultValue: v.string(),
  values: v.optional(v.record(v.string(), v.unknown())),
});

const prescription = v.object({
  policy,
  kind: v.picklist(["first", "up", "hold", "deload", "off"]),
  weight: v.optional(finiteNumber),
  reps: v.optional(finiteNumber),
  sec: v.optional(finiteNumber),
  sets: v.optional(finiteNumber),
  why: v.optional(translationMessage),
});

const activeEntry = v.object({
  id,
  sg: v.optional(id),
  target: exerciseConfig,
  plan: v.optional(v.nullable(prescription), null),
  sets: v.array(loggedSet),
  topW: v.optional(finiteNumber),
  asked: v.optional(v.boolean()),
});

const activeWorkout = v.object({
  id,
  d: isoDate,
  start: finiteNumber,
  routineId: v.nullable(id),
  name: v.string(),
  bw: v.nullable(finiteNumber),
  cur: nonNegativeNumber,
  entries: v.array(activeEntry),
  sessionPlan: v.optional(sessionPlan),
});

const muscleSnapshot = v.object({
  n: v.optional(v.string()),
  bp: v.optional(v.string()),
  muscleWeights: v.optional(v.record(v.string(), finiteNumber)),
});

const workoutEntry = v.object({
  id,
  sets: v.array(loggedSet),
  topW: v.optional(v.nullable(finiteNumber)),
  target: v.optional(v.nullable(exerciseConfig)),
  muscleSnapshot: v.optional(v.nullable(muscleSnapshot)),
});

const workout = v.object({
  progressionApplied: v.optional(v.array(v.string())),
  garminActivityIds: v.optional(v.array(v.string())),
  source: v.optional(
    v.object({
      provider: v.picklist(["fivefold", "garmin", "set-and-signal"]),
      id,
      recordedUnit: unit,
    }),
  ),
  id,
  d: isoDate,
  start: finiteNumber,
  end: finiteNumber,
  routineId: v.optional(v.nullable(id)),
  name: v.string(),
  bw: v.optional(v.nullable(finiteNumber)),
  entries: v.array(workoutEntry),
  prs: v.optional(v.array(id)),
  vol: finiteNumber,
  note: v.optional(v.string()),
  sessionPlan: v.optional(sessionPlan),
});

const bodyweightEntry = v.object({
  d: isoDate,
  w: v.pipe(finiteNumber, v.minValue(0)),
  t: v.optional(v.nullable(finiteNumber)),
});

const measuresEntry = v.object({
  d: isoDate,
  chest: v.optional(finiteNumber),
  waist: v.optional(finiteNumber),
  hips: v.optional(finiteNumber),
  arm: v.optional(finiteNumber),
  thigh: v.optional(finiteNumber),
});

const customExercise = v.object({
  id,
  n: v.string(),
  bp: v.string(),
  desc: v.optional(v.string()),
  custom: v.optional(v.literal(true)),
  eq: v.optional(v.string()),
  tg: v.optional(v.string()),
});

const daySession = v.object({
  routineId: id,
  start: v.optional(v.string()),
  label: v.optional(v.string()),
});

const dayPlanEntry = v.union([
  v.object({ rest: v.literal(true) }),
  v.object({ rest: v.optional(v.literal(false)), sessions: v.array(daySession) }),
]);

const appState = v.object({
  fivefoldNext: v.optional(v.picklist(["A", "B"])),
  unit,
  restSec: finiteNumber,
  sound: v.boolean(),
  keepAwake: v.boolean(),
  lang: v.string(),
  theme: v.picklist(["dark", "light"]),
  accent: v.picklist(ACCENT_NAMES),
  body: v.picklist(["male", "female"]),
  targetW: v.nullable(finiteNumber),
  gifSize: v.picklist(["full", "mini"]),
  effort: v.nullable(v.picklist(["none", "rir", "rpe"])),
  reminder,
  bodyweight: v.array(bodyweightEntry),
  measures: v.optional(v.array(measuresEntry)),
  plates: v.optional(
    v.nullable(
      v.object({ on: v.boolean(), bar: nonNegativeNumber, avail: v.array(positiveNumber) }),
    ),
  ),
  routines: v.array(routine),
  week: v.record(weekday, v.array(daySession)),
  dayPlan: v.record(v.string(), dayPlanEntry),
  exWeights: v.record(id, v.object({ w: finiteNumber, d: isoDate })),
  workouts: v.array(workout),
  active: v.nullable(activeWorkout),
  customEx: v.array(customExercise),
  _ts: v.optional(finiteNumber),
});

/** Local drafts and server sync can contain a partial current state. */
export const appStatePatch = v.partial(appState);

const userSchema = v.object({
  id,
  name: v.string(),
  admin: v.optional(v.boolean()),
});

export const sessionResponse = v.object({ user: v.nullable(userSchema) });

export const authResponse = v.object({ user: userSchema });

export const configResponse = v.object({
  invite_only: v.boolean(),
  oidc_providers: v.optional(v.array(v.string())),
  mcp_url: v.optional(v.string()),
});

export const pushKeyResponse = v.object({
  key: v.pipe(v.string(), v.minLength(1)),
});

export const dataResponse = v.object({
  state: v.optional(v.nullable(appStatePatch)),
});

const adminLiveInfo = v.object({
  name: v.string(),
  exIdx: finiteNumber,
  exTotal: finiteNumber,
  setsDone: finiteNumber,
  setsTotal: finiteNumber,
  startedAt: finiteNumber,
});

const adminUser = v.object({
  id,
  name: v.string(),
  admin: v.optional(v.boolean()),
  disabled: v.optional(v.boolean()),
  invitedBy: v.optional(v.nullable(v.string())),
  created: v.optional(v.nullable(v.string())),
  lastSync: v.optional(v.nullable(finiteNumber)),
  workouts: v.optional(finiteNumber),
  lastWorkout: v.optional(v.nullable(v.string())),
  hasPush: v.optional(v.boolean()),
  live: v.optional(v.nullable(adminLiveInfo)),
});

const adminInvite = v.object({
  code: v.pipe(v.string(), v.minLength(1)),
  usedBy: v.optional(v.nullable(v.string())),
  usedByName: v.optional(v.nullable(v.string())),
});

const adminRoutineSummary = v.object({
  id,
  name: v.string(),
  emoji: v.string(),
  count: v.pipe(finiteNumber, v.integer()),
});

export const adminUsersResponse = v.object({
  users: v.array(adminUser),
  invite_only: v.optional(v.boolean()),
});

export const adminInvitesResponse = v.object({
  invites: v.array(adminInvite),
  invite_only: v.optional(v.boolean()),
});

export const adminInviteResponse = v.object({ invite: adminInvite });

export const adminUserResponse = v.object({
  user: adminUser,
  workouts: v.array(workout),
  bodyweight: v.array(bodyweightEntry),
  routines: v.array(adminRoutineSummary),
  lastSync: v.optional(v.nullable(finiteNumber)),
  unit,
});

/* ================================== AI ================================== */

// The backend proxies LLM output, so the plan body is validated like any other
// server payload instead of being hand-narrowed at the call site.
const aiSuggestionEntry = v.object({
  id,
  sets: v.optional(finiteNumber),
  reps: v.optional(finiteNumber),
  weight: v.optional(finiteNumber),
  sec: v.optional(finiteNumber),
  min: v.optional(finiteNumber),
  speed: v.optional(finiteNumber),
  swapTo: v.optional(id),
  note: v.optional(v.string()),
});

export const aiStatusResponse = v.object({ enabled: v.boolean() });

export const aiPlanResponse = v.object({
  model: v.string(),
  suggestion: v.object({
    summary: v.string(),
    entries: v.array(aiSuggestionEntry),
  }),
});

export type AiPlanEntry = v.InferOutput<typeof aiSuggestionEntry>;

export type AiPlanResult = v.InferOutput<typeof aiPlanResponse>;

/* ============================== WebAuthn ================================ */

// Only the fields this app relies on are validated; everything else in the
// WebAuthn JSON passes through untouched via the assertion below.
const creationOptionsFields = v.object({
  challenge: v.string(),
  rp: v.object({ name: v.string() }),
  user: v.object({ id: v.string(), name: v.string(), displayName: v.string() }),
  pubKeyCredParams: v.array(v.unknown()),
});

const requestOptionsFields = v.object({ challenge: v.string() });

const isCreationOptions = (value: unknown): value is PublicKeyCredentialCreationOptionsJSON =>
  v.is(creationOptionsFields, value);

const isRequestOptions = (value: unknown): value is PublicKeyCredentialRequestOptionsJSON =>
  v.is(requestOptionsFields, value);

const creationOptions = v.custom<PublicKeyCredentialCreationOptionsJSON>(isCreationOptions);

const requestOptions = v.custom<PublicKeyCredentialRequestOptionsJSON>(isRequestOptions);

export const registrationOptionsResponse = v.object({
  cid: id,
  options: v.object({ publicKey: creationOptions }),
});

export const loginOptionsResponse = v.object({
  cid: id,
  options: v.object({ publicKey: requestOptions }),
});

export const planBundle = v.object({
  opengym_plan: v.literal(2),
  exported: isoDate,
  name: v.string(),
  week: v.record(weekday, v.array(daySession)),
  routines: v.array(
    v.object({
      id,
      name: v.string(),
      emoji: v.optional(v.string()),
      prog: v.optional(policy),
      ex: v.array(exerciseConfig),
    }),
  ),
  customEx: v.array(
    v.object({
      id,
      n: v.string(),
      bp: v.string(),
      desc: v.optional(v.string()),
    }),
  ),
});

export type ParsedUser = v.InferOutput<typeof userSchema>;

export type ParsedAppStatePatch = v.InferOutput<typeof appStatePatch>;

export type ParsedPlanBundle = v.InferOutput<typeof planBundle>;

export type AdminLiveInfo = v.InferOutput<typeof adminLiveInfo>;

export type AdminUser = v.InferOutput<typeof adminUser>;

export type AdminInvite = v.InferOutput<typeof adminInvite>;

export type AdminRoutineSummary = v.InferOutput<typeof adminRoutineSummary>;

export type AdminUsersResponse = v.InferOutput<typeof adminUsersResponse>;

export type AdminInvitesResponse = v.InferOutput<typeof adminInvitesResponse>;

export type AdminUserResponse = v.InferOutput<typeof adminUserResponse>;

export type PayloadSchema<T> = v.BaseSchema<unknown, T, v.BaseIssue<unknown>>;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- This shared HTTP boundary immediately validates arbitrary JSON with the caller’s schema and preserves the established error message.
export function parsePayload<T>(schema: PayloadSchema<T>, payload: unknown): T {
  const result = v.safeParse(schema, payload);

  if (!result.success) {
    throw new Error(`Invalid server payload: ${result.issues[0]?.message || "unknown shape"}`);
  }

  return result.output;
}

/** Best-effort `{ error }` extraction from a failed response body. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- Failed HTTP bodies are untrusted; safeParse extracts only the validated string error field.
export function payloadMessage(payload: unknown): string | undefined {
  const result = v.safeParse(v.object({ error: v.string() }), payload);

  return result.success ? result.output.error : undefined;
}

export function parseStoredState(raw: string | null): ParsedAppStatePatch | null {
  if (!raw) {
    return null;
  }

  try {
    return parsePayload(appStatePatch, JSON.parse(raw));
  } catch {
    return null;
  }
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- Public account parser delegates immediately to userSchema while preserving the shared payload-error contract.
export function parseUser(payload: unknown): User {
  return parsePayload(userSchema, payload);
}

export type { PlanBundle };
