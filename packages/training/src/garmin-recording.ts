import { z } from "zod";
import { GARMIN_EXERCISES } from "./garmin";
import { convertLoad, recordedWorkoutSchema, type RecordedWorkout } from "./records";
import type { Unit } from "./fivefold";

const fitSet = z.object({
  index: z.number(),
  setType: z.string().nullable(),
  repetitions: z.number().int().nonnegative().nullable(),
  weightKg: z.number().nonnegative().nullable(),
  startTimeUtc: z.string().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  exercises: z.array(
    z.object({
      category: z.string().nullable(),
      name: z.string().nullable(),
      categoryId: z.number().nullable(),
      subtypeId: z.number().nullable(),
    }),
  ),
});

export const garminActivitySchema = z.object({
  activityId: z.union([z.string(), z.number()]).transform(String),
  summary: z
    .object({
      activityName: z.string().optional(),
      startTimeInSeconds: z.number().optional(),
      startTimeOffsetInSeconds: z.number().optional(),
      durationInSeconds: z.number().optional(),
    })
    .nullable(),
  fit: z.object({ availability: z.string(), sets: z.array(fitSet).optional() }).nullable(),
});

export interface GarminRecordingPreview {
  workout: RecordedWorkout | null;
  warnings: string[];
  customExercises: { id: string; n: string; bp: string }[];
}

const identifier = (value: string) => value.replaceAll("_", "").toLowerCase();

const label = (value: string) => value.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");

/** Only recorded active sets with explicit repetitions and load enter the log. */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- This FIT import boundary immediately validates the untrusted provider payload with garminActivitySchema.
export function garminRecordedWorkout(input: unknown, unit: Unit): GarminRecordingPreview {
  const activity = garminActivitySchema.parse(input);
  const warnings: string[] = [];
  const entries: RecordedWorkout["entries"] = [];
  const customExercises: GarminRecordingPreview["customExercises"] = [];

  if (activity.fit?.availability !== "available")
    return {
      workout: null,
      warnings: [
        "Recorded strength details have not been received. This activity remains visible in Garmin.",
      ],
      customExercises,
    };
  const active = (activity.fit.sets ?? []).filter((set) => set.setType === "active");

  for (const set of active) {
    if (set.repetitions === null || set.weightKg === null) {
      warnings.push(
        `Set ${set.index + 1} has no recorded repetitions or load and cannot be imported without correction.`,
      );
      continue;
    }

    const exercise = set.exercises.find((candidate) => candidate.name && candidate.category);

    const matched =
      exercise &&
      Object.entries(GARMIN_EXERCISES).find(
        ([, mapping]) =>
          identifier(mapping.category) === identifier(exercise.category ?? "") &&
          identifier(mapping.name) === identifier(exercise.name ?? ""),
      );

    const id =
      matched?.[0] ??
      `garmin-${exercise?.categoryId ?? "unknown"}-${exercise?.subtypeId ?? set.index}`;

    const name = exercise?.name ? label(exercise.name) : `Recorded exercise ${set.index + 1}`;

    if (!matched && !customExercises.some((candidate) => candidate.id === id))
      customExercises.push({ id, n: name, bp: "other" });
    let entry = entries.find((candidate) => candidate.id === id);

    if (!entry) {
      entry = { id, sets: [], muscleSnapshot: { n: name } };
      entries.push(entry);
    }

    entry.sets.push({
      done: true,
      r: set.repetitions,
      w: convertLoad(set.weightKg, "kg", unit),
      recordedWeight: set.weightKg,
    });
  }

  if (!entries.length)
    return {
      workout: null,
      warnings: warnings.length
        ? warnings
        : [
            "No recorded strength sets were received. Planned targets are not imported as performance.",
          ],
      customExercises,
    };
  const startSeconds = activity.summary?.startTimeInSeconds;

  if (startSeconds === undefined) {
    return {
      workout: null,
      warnings: [...warnings, "This activity has no reliable recorded start time."],
      customExercises,
    };
  }

  const start = startSeconds * 1000;
  const duration = activity.summary?.durationInSeconds;

  if (duration === undefined || duration < 0)
    return {
      workout: null,
      warnings: [...warnings, "This activity has no recorded duration."],
      customExercises,
    };

  // Garmin's supplied offset defines its recorded local date. Missing offsets
  // are explicit; UTC is used as a reviewable fallback rather than device time.
  if (activity.summary?.startTimeOffsetInSeconds === undefined)
    warnings.push("Garmin supplied no local time offset; the displayed date uses UTC.");

  const date = new Date(start + (activity.summary?.startTimeOffsetInSeconds ?? 0) * 1000)
    .toISOString()
    .slice(0, 10);

  const workout = recordedWorkoutSchema.parse({
    id: `garmin-${activity.activityId}`,
    d: date,
    start,
    end: start + duration * 1000,
    routineId: null,
    name: activity.summary?.activityName ?? "Garmin strength workout",
    entries,
    prs: [],
    vol: entries.reduce(
      (total, entry) => total + entry.sets.reduce((sum, set) => sum + set.w * set.r, 0),
      0,
    ),
    source: { provider: "garmin", id: activity.activityId, recordedUnit: "kg" },
  });

  return { workout, warnings, customExercises };
}

interface RecordedRoutine {
  id: string;
  ex: { id: string; sets: number; reps?: number; weight?: number }[];
}

/** A reviewed association supplies targets, never additional performed sets. */
export function assignRecordedRoutine(
  workout: RecordedWorkout,
  routine: RecordedRoutine,
): RecordedWorkout {
  return {
    ...workout,
    routineId: routine.id,
    entries: workout.entries.map((entry) => {
      const cfg = routine.ex.find((candidate) => candidate.id === entry.id);

      return cfg
        ? {
            ...entry,
            target: { id: cfg.id, sets: cfg.sets, reps: cfg.reps ?? 5, weight: cfg.weight ?? 0 },
          }
        : entry;
    }),
  };
}
