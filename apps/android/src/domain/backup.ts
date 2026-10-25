import { z } from "zod";
import { PlateInventorySchema } from "./plates";
import { type AppState, maxBarWeight, maxWeight, ROUTINE, type Session } from "./workout";

const timestamp = z.number().finite().min(1).max(8.64e15);

const unit = z.enum(["kg", "lb"]);

const kind = z.enum(["A", "B"]);

const lift = z.enum(["squat", "bench", "row", "press", "deadlift"]);

const exercise = z.object({
  lift,
  weight: z.number().finite().min(0),
  sets: z.array(z.union([z.number().int().min(0).max(5), z.null()])),
});

const session = z
  .object({
    id: z.string().max(149),
    kind,
    startedAt: timestamp,
    finishedAt: timestamp.nullable(),
    unit,
    notes: z.string().max(2000),
    exercises: z.array(exercise).length(3),
  })
  .superRefine((value, context) => {
    if (value.finishedAt !== null && value.finishedAt < value.startedAt) {
      context.addIssue({ code: "custom", path: ["finishedAt"], message: "Invalid finish time." });
    }

    for (const [index, entry] of value.exercises.entries()) {
      if (entry.lift !== ROUTINE[value.kind][index]) {
        context.addIssue({
          code: "custom",
          path: ["exercises", index, "lift"],
          message: "Unexpected lift.",
        });
      }

      if (entry.weight > maxWeight(value.unit)) {
        context.addIssue({
          code: "custom",
          path: ["exercises", index, "weight"],
          message: "Weight is too high.",
        });
      }

      if (entry.sets.length !== (entry.lift === "deadlift" ? 1 : 5)) {
        context.addIssue({
          code: "custom",
          path: ["exercises", index, "sets"],
          message: "Unexpected set count.",
        });
      }
    }
  });

const activeSession = session.refine((value) => value.finishedAt === null);

const finishedSession = session.refine((value) => value.finishedAt !== null);

const liftPlan = z.object({
  lastWorkoutId: z.string().max(200).optional(),
  weight: z.number().finite().min(0),
  increment: z.number().finite().min(0.25).max(50),
  failures: z.number().int().min(0).max(10000),
});

const settings = z.object({
  unit,
  bar: z.number().finite().min(1),
  plates: PlateInventorySchema.nullable().optional(),
  restSeconds: z.number().finite().min(15).max(600),
  failedRestSeconds: z.number().finite().min(15).max(600),
  autoProgress: z.boolean(),
  autoDeload: z.boolean(),
  haptics: z.boolean(),
  keepAwake: z.boolean(),
  restAlerts: z.boolean(),
  theme: z.enum(["system", "light", "dark"]),
});

const rest = z.object({
  endsAt: timestamp,
  duration: z.number().finite().min(15).max(3600),
  lift,
  setIndex: z.number().int().min(0).max(4),
});

const appState = z
  .object({
    version: z.literal(1),
    onboarded: z.boolean(),
    next: kind,
    plans: z.object({
      squat: liftPlan,
      bench: liftPlan,
      row: liftPlan,
      press: liftPlan,
      deadlift: liftPlan,
    }),
    settings,
    active: activeSession.nullable(),
    history: z.array(finishedSession),
    rest: rest.nullable(),
  })
  .superRefine((value, context) => {
    const unitMax = maxWeight(value.settings.unit);

    for (const [name, plan] of Object.entries(value.plans)) {
      if (plan.weight > unitMax) {
        context.addIssue({
          code: "custom",
          path: ["plans", name, "weight"],
          message: "Weight is too high.",
        });
      }
    }

    if (value.settings.bar > maxBarWeight(value.settings.unit)) {
      context.addIssue({
        code: "custom",
        path: ["settings", "bar"],
        message: "Bar weight is too high.",
      });
    }

    if (value.active && value.active.unit !== value.settings.unit) {
      context.addIssue({
        code: "custom",
        path: ["active", "unit"],
        message: "Workout unit changed.",
      });
    }

    const historyIds = new Set(value.history.map((entry) => entry.id));

    if (historyIds.size !== value.history.length) {
      context.addIssue({ code: "custom", path: ["history"], message: "Duplicate workout." });
    }

    if (value.active && historyIds.has(value.active.id)) {
      context.addIssue({ code: "custom", path: ["active", "id"], message: "Duplicate workout." });
    }

    if (value.rest) {
      const maxSetIndex = value.rest.lift === "deadlift" ? 0 : 4;

      if (
        !value.active ||
        !value.active.exercises.some((entry) => entry.lift === value.rest?.lift) ||
        value.rest.setIndex > maxSetIndex
      ) {
        context.addIssue({ code: "custom", path: ["rest"], message: "Invalid rest state." });
      }
    }
  });

const backupEnvelope = z
  .object({ history: z.array(z.unknown()).max(20000).optional() })
  .passthrough();

const unsupportedState = "This isn't a Fivefold backup.";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

export type StatePayload = AppState | JsonValue | undefined;

// Local storage shares the schema checks, but not external-import resource limits.
export function validateState(value: StatePayload): AppState {
  const parsed = appState.safeParse(value);

  if (!parsed.success) {
    throw new Error(unsupportedState);
  }

  // SAFETY: The schema above validated the original value as a complete AppState.
  const state = value as AppState;

  if (state.settings.plates !== undefined) {
    return state;
  }

  return {
    ...state,
    settings: { ...state.settings, plates: null },
  };
}

export function parseStoredState(text: string): AppState {
  // SAFETY: JSON.parse returns only the recursive values represented by StatePayload.
  const value = JSON.parse(text) as StatePayload;

  return validateState(value);
}

export function parseStoredSession(text: string): Session {
  // SAFETY: JSON.parse returns only the recursive values represented by StatePayload.
  const value = JSON.parse(text) as StatePayload;
  const parsed = finishedSession.safeParse(value);

  if (!parsed.success) {
    throw new Error(unsupportedState);
  }

  return parsed.data;
}

export function parseBackup(text: string): AppState {
  if (text.length > 20_000_000) {
    throw new Error("This backup is too large (maximum 20 MB).");
  }

  let value: StatePayload;

  try {
    // SAFETY: JSON.parse returns only the recursive values represented by StatePayload.
    value = JSON.parse(text) as StatePayload;
  } catch {
    throw new Error(unsupportedState);
  }

  if (!backupEnvelope.safeParse(value).success) {
    throw new Error(unsupportedState);
  }

  return validateState(value);
}
