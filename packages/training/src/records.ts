import { z } from "zod";
import { NAMES, convertLoad, type Session, type Unit } from "./fivefold";

export const LIFT_IDS = {
  squat: "0043",
  bench: "0025",
  row: "0027",
  press: "1456",
  deadlift: "0032",
} as const;

export const workoutSourceSchema = z.object({
  provider: z.enum(["fivefold", "garmin", "set-and-signal"]),
  id: z.string().min(1).max(255),
  recordedUnit: z.enum(["kg", "lb"]),
});

export type WorkoutSource = z.infer<typeof workoutSourceSchema>;

export const recordedSetSchema = z.object({
  done: z.boolean(),
  w: z.number().finite().nonnegative(),
  r: z.number().int().min(0).max(10000),
  recordedWeight: z.number().finite().nonnegative().optional(),
});

export const recordedWorkoutSchema = z
  .object({
    id: z.string().min(1).max(200),
    d: z.iso.date(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    routineId: z.string().nullable(),
    name: z.string().max(100),
    entries: z
      .array(
        z.object({
          id: z.string().min(1),
          sets: z.array(recordedSetSchema).max(2000),
          target: z
            .object({
              id: z.string(),
              sets: z.number().int(),
              reps: z.number().int(),
              weight: z.number(),
            })
            .optional(),
          muscleSnapshot: z.object({ n: z.string(), bp: z.string().optional() }).optional(),
        }),
      )
      .max(100),
    prs: z.array(z.string()),
    vol: z.number().finite().nonnegative(),
    note: z.string().max(4000).optional(),
    source: workoutSourceSchema.optional(),
    garminActivityIds: z.array(z.string()).optional(),
    progressionApplied: z.array(z.string()).optional(),
  })
  .refine((workout) => workout.end >= workout.start, "Workout ends before it starts");

export type RecordedWorkout = z.infer<typeof recordedWorkoutSchema>;

export { convertLoad } from "./fivefold";

export function localDate(instant: number): string {
  const date = new Date(instant);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Normalized projection; original numerical loads remain in recordedWeight. */
export function fivefoldWorkout(session: Session, unit: Unit, id = session.id): RecordedWorkout {
  if (session.finishedAt === null) {
    throw new Error("An active workout cannot enter completed history");
  }

  const entries = session.exercises.map((exercise) => {
    const exerciseId = LIFT_IDS[exercise.lift];
    const weight = convertLoad(exercise.weight, session.unit, unit);

    return {
      id: exerciseId,
      sets: exercise.sets.map((reps) => ({
        done: reps !== null,
        r: reps ?? 0,
        w: weight,
        recordedWeight: exercise.weight,
      })),
      target: { id: exerciseId, sets: exercise.sets.length, reps: 5, weight },
      muscleSnapshot: { n: NAMES[exercise.lift] },
    };
  });

  const workout: RecordedWorkout = {
    id,
    d: localDate(session.startedAt),
    start: session.startedAt,
    end: session.finishedAt,
    routineId: `fivefold-${session.kind}`,
    name: `5×5 Workout ${session.kind}`,
    entries,
    prs: [],
    vol: entries.reduce(
      (total, entry) =>
        total + entry.sets.reduce((sum, set) => sum + (set.done ? set.w * set.r : 0), 0),
      0,
    ),
    source: { provider: "fivefold", id: session.id, recordedUnit: session.unit },
    progressionApplied: session.exercises.map((exercise) => LIFT_IDS[exercise.lift]),
  };

  if (session.notes) {
    workout.note = session.notes;
  }

  return recordedWorkoutSchema.parse(workout);
}
