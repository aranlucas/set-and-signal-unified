import { z } from "zod";
import { recordedWorkoutSchema } from "@set-and-signal/training/records";

export const hostedExerciseSchema = z.looseObject({
  id: z.string(),
  sets: z.number().int().positive(),
  reps: z.number().optional(),
  weight: z.number().optional(),
  mode: z.string().optional(),
  inc: z.number().optional(),
  fivefold: z
    .object({
      unit: z.enum(["kg", "lb"]).optional(),
      failures: z.number(),
      bar: z.number(),
      autoProgress: z.boolean(),
      autoDeload: z.boolean(),
      lastWorkoutId: z.string().optional(),
    })
    .optional(),
});

export const hostedRoutineSchema = z.object({
  id: z.string(),
  name: z.string(),
  prog: z.string().optional(),
  ex: z.array(hostedExerciseSchema),
});

export const hostedProfileSchema = z.object({
  fivefoldNext: z.enum(["A", "B"]).optional(),
  unit: z.enum(["kg", "lb"]).default("lb"),
  restSec: z.number().default(90),
  routines: z.array(hostedRoutineSchema).default([]),
  customEx: z.array(z.object({ id: z.string(), n: z.string() })).default([]),
  workouts: z
    .array(
      z.looseObject({
        id: z.string(),
        d: z.string(),
        name: z.string(),
        end: z.number(),
        source: z
          .looseObject({ provider: z.string(), id: z.string(), recordedUnit: z.enum(["kg", "lb"]) })
          .optional(),
        entries: z.array(
          z.looseObject({
            id: z.string(),
            muscleSnapshot: z.object({ n: z.string().optional() }).nullable().optional(),
            sets: z.array(
              z.looseObject({
                done: z.boolean(),
                r: z.number().optional(),
                w: z.number().optional(),
                sec: z.number().optional(),
                min: z.number().optional(),
              }),
            ),
          }),
        ),
        garminActivityIds: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});

export type HostedRoutine = z.infer<typeof hostedRoutineSchema>;

export type HostedProfile = z.infer<typeof hostedProfileSchema>;

export const hostedDraftSchema = z.object({
  unit: z.enum(["kg", "lb"]),
  restEndsAt: z.number(),
  workout: recordedWorkoutSchema,
});

export type HostedDraft = z.infer<typeof hostedDraftSchema>;

export const hostedDocumentSchema = z.record(z.string(), z.json());

export type HostedDocument = z.infer<typeof hostedDocumentSchema>;
