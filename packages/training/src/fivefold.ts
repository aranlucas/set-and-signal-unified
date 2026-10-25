export type Unit = "kg" | "lb";

export type Lift = "squat" | "bench" | "row" | "press" | "deadlift";

export type WorkoutKind = "A" | "B";

export const maxWeight = (unit: Unit) => (unit === "kg" ? 2000 : 4410);

export const maxBarWeight = (unit: Unit) => (unit === "kg" ? 100 : 220.5);

export const LIFTS: Lift[] = ["squat", "bench", "row", "press", "deadlift"];

export const NAMES: Record<Lift, string> = {
  squat: "Squat",
  bench: "Bench press",
  row: "Barbell row",
  press: "Overhead press",
  deadlift: "Deadlift",
};

export const ROUTINE: Record<WorkoutKind, Lift[]> = {
  A: ["squat", "bench", "row"],
  B: ["squat", "press", "deadlift"],
};

export interface LiftPlan {
  lastWorkoutId?: string;
  weight: number;
  increment: number;
  failures: number;
}

export interface Exercise {
  lift: Lift;
  weight: number;
  sets: (number | null)[];
}

export interface ProgressionSettings {
  unit: Unit;
  bar: number;
  autoProgress: boolean;
  autoDeload: boolean;
}

export const round = (n: number) => Math.round(n * 1000) / 1000;

export function nextPlan(
  plan: LiftPlan,
  exercise: Pick<Exercise, "weight" | "sets"> & { lift?: Lift },
  settings: ProgressionSettings,
): LiftPlan {
  const success = exercise.sets.every((r) => r === 5);

  if (success) {
    return {
      weight: round(
        Math.min(
          maxWeight(settings.unit),
          exercise.weight + (settings.autoProgress ? plan.increment : 0),
        ),
      ),
      increment: plan.increment,
      failures: 0,
    };
  }
  // An unfinished lift doesn't count as an attempt or trigger a deload.

  if (exercise.sets.some((r) => r === null)) {
    return { ...plan, weight: exercise.weight };
  }

  const failures = Math.min(10000, plan.failures + 1);

  if (failures >= 3 && settings.autoDeload) {
    const weight = Math.max(
      settings.bar,
      Math.floor((exercise.weight * 0.9 + 1e-9) / plan.increment) * plan.increment,
    );

    return { ...plan, weight: round(weight), failures: 0 };
  }

  return { ...plan, weight: exercise.weight, failures };
}

export function convertWeight(n: number, from: Unit, to: Unit) {
  return from === to ? n : n * (from === "kg" ? 2.2046226218 : 1 / 2.2046226218);
}

export interface Session {
  id: string;
  kind: WorkoutKind;
  startedAt: number;
  finishedAt: number | null;
  exercises: Exercise[];
  notes: string;
  unit: Unit;
}

export interface FivefoldPolicyState {
  unit?: Unit;
  failures: number;
  bar: number;
  autoProgress: boolean;
  autoDeload: boolean;
  lastWorkoutId?: string;
}

interface FivefoldConfig {
  weight?: number;
  inc?: number;
  sets: number;
  fivefold?: FivefoldPolicyState;
}

export function advanceFivefold<T extends FivefoldConfig>(
  config: T,
  performed: { id: string; weight: number; sets: (number | null)[] },
  unit: Unit,
): T {
  if (config.fivefold?.lastWorkoutId === performed.id) return config;

  const policy = config.fivefold ?? {
    failures: 0,
    bar: unit === "kg" ? 20 : 45,
    autoProgress: true,
    autoDeload: true,
  };

  const policyUnit = policy.unit ?? unit;

  const planned = nextPlan(
    {
      weight: round(convertLoad(config.weight ?? performed.weight, unit, policyUnit)),
      increment:
        config.inc === undefined
          ? policyUnit === "kg"
            ? 2.5
            : 5
          : round(convertLoad(config.inc, unit, policyUnit)),
      failures: policy.failures,
    },
    {
      weight: round(convertLoad(performed.weight, unit, policyUnit)),
      sets: Array.from({ length: config.sets }, (_, index) => performed.sets[index] ?? null),
    },
    { ...policy, unit: policyUnit },
  );

  return {
    ...config,
    weight: convertLoad(planned.weight, policyUnit, unit),
    fivefold: { ...policy, failures: planned.failures, lastWorkoutId: performed.id },
  };
}

export function convertLoad(value: number, from: Unit, to: Unit): number {
  return from === to ? value : from === "lb" ? value * 0.45359237 : value / 0.45359237;
}
