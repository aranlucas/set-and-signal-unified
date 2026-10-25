import { z } from "zod";
import { convertLoad } from "./records";

const exerciseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  sets: z.number().int().min(1).max(50),
  reps: z.number().int().min(1).max(500),
  weight: z.number().finite().nonnegative().max(4410),
  category: z.string().max(100).optional(),
  exerciseName: z.string().max(100).optional(),
});

export const strengthPlanSchema = z.object({
  name: z.string().trim().min(1).max(100),
  unit: z.enum(["kg", "lb"]),
  restSeconds: z.number().int().min(0).max(3600),
  exercises: z.array(exerciseSchema).min(1).max(30),
});

export type StrengthPlan = z.infer<typeof strengthPlanSchema>;

export interface GarminStep {
  type: "WorkoutStep";
  stepOrder: number;
  intensity: "ACTIVE" | "REST";
  durationType: "REPS" | "TIME";
  durationValue: number;
  targetType: "OPEN";
  description?: string;
  exerciseCategory?: string;
  exerciseName?: string;
  weightValue?: number;
  weightDisplayUnit?: "KILOGRAM" | "POUND";
}

// Identifiers also exist in Garmin's official FIT SDK profile. Unmapped movements
// retain a readable description; callers preview that limitation before sending.
interface GarminExerciseMapping {
  category: string;
  name: string;
}

export const GARMIN_EXERCISES = {
  "0043": { category: "SQUAT", name: "BARBELL_BACK_SQUAT" },
  "0025": { category: "BENCH_PRESS", name: "BARBELL_BENCH_PRESS" },
  "0027": { category: "ROW", name: "BARBELL_ROW" },
  "1456": { category: "SHOULDER_PRESS", name: "OVERHEAD_BARBELL_PRESS" },
  "0032": { category: "DEADLIFT", name: "BARBELL_DEADLIFT" },
} satisfies Record<string, GarminExerciseMapping>;

const exerciseMappings = new Map<string, GarminExerciseMapping>(Object.entries(GARMIN_EXERCISES));

/** Compile prescribed performance only; this never produces a completed log. */
export function garminStrengthWorkout(input: StrengthPlan) {
  const plan = strengthPlanSchema.parse(input);
  const steps: GarminStep[] = [];
  const unmapped: string[] = [];

  for (const exercise of plan.exercises) {
    const mapping =
      exercise.category && exercise.exerciseName
        ? { category: exercise.category, name: exercise.exerciseName }
        : exerciseMappings.get(exercise.id);

    if (!mapping) unmapped.push(exercise.name);

    for (let set = 0; set < exercise.sets; set += 1) {
      if (steps.length && plan.restSeconds) {
        steps.push({
          type: "WorkoutStep",
          stepOrder: steps.length + 1,
          intensity: "REST",
          durationType: "TIME",
          durationValue: plan.restSeconds,
          targetType: "OPEN",
        });
      }

      const step: GarminStep = {
        type: "WorkoutStep",
        stepOrder: steps.length + 1,
        intensity: "ACTIVE",
        durationType: "REPS",
        durationValue: exercise.reps,
        targetType: "OPEN",
        description: `${exercise.name} · ${exercise.weight} ${plan.unit} · set ${set + 1}/${exercise.sets}`,
        weightValue: convertLoad(exercise.weight, plan.unit, "kg"),
        weightDisplayUnit: plan.unit === "lb" ? "POUND" : "KILOGRAM",
      };

      if (mapping) {
        step.exerciseCategory = mapping.category;
        step.exerciseName = mapping.name;
      }

      steps.push(step);
    }
  }

  if (steps.length > 100)
    throw new Error(
      "This session exceeds Garmin's 100-step limit. Split it into smaller sessions.",
    );

  return {
    workout: {
      workoutName: plan.name,
      sport: "STRENGTH_TRAINING" as const,
      workoutProvider: "Set & Signal",
      workoutSourceId: "Set & Signal",
      segments: [{ segmentOrder: 1, sport: "STRENGTH_TRAINING" as const, steps }],
    },
    unmapped,
  };
}
