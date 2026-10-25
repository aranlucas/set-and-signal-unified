import { convertLoad } from "@set-and-signal/training/records";
import { defaultPlateSetup } from "./plates";
import type { AppState, ExConfig, LoggedSet, SessionPlan, Unit } from "@/shared/lib/types";

/** The profile unit is the display/storage unit; completed sources retain originals. */
export function changeProfileUnit(state: AppState, unit: Unit): void {
  const from = state.unit;

  if (from === unit) {
    return;
  }

  const seen = new WeakSet<object>();
  const load = (value: number) => convertLoad(value, from, unit);

  const config = (value: Pick<ExConfig, "weight" | "inc">) => {
    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    if (value.weight !== undefined) {
      value.weight = load(value.weight);
    }

    if (value.inc !== undefined) {
      value.inc = load(value.inc);
    }
  };

  const plan = (value: SessionPlan | undefined) => {
    for (const row of value?.rows ?? []) {
      config(row.original);

      if (row.planned) {
        config(row.planned);
      }
    }
  };

  const sets = (values: LoggedSet[], preserve: boolean) => {
    for (const set of values) {
      if (!("w" in set) || seen.has(set)) {
        continue;
      }

      seen.add(set);

      if (preserve && set.recordedWeight === undefined) {
        set.recordedWeight = set.w;
      }

      set.w = load(set.w);
    }
  };

  for (const routine of state.routines) {
    for (const exercise of routine.ex) {
      if ((exercise.prog ?? routine.prog) === "fivefold" && !exercise.fivefold) {
        exercise.fivefold = {
          unit: from,
          failures: 0,
          bar: from === "kg" ? 20 : 45,
          autoProgress: true,
          autoDeload: true,
        };
      }

      config(exercise);
    }

    plan(routine.sessionPlan);
  }

  for (const workout of state.workouts) {
    workout.source ??= { provider: "set-and-signal", id: workout.id, recordedUnit: from };
    workout.vol = load(workout.vol);

    if (workout.bw !== null && workout.bw !== undefined) {
      workout.bw = load(workout.bw);
    }

    for (const entry of workout.entries) {
      sets(entry.sets, true);

      if (entry.target) {
        config(entry.target);
      }

      if (entry.topW !== null && entry.topW !== undefined) {
        entry.topW = load(entry.topW);
      }
    }

    plan(workout.sessionPlan);
  }

  for (const entry of state.active?.entries ?? []) {
    config(entry.target);

    if (entry.plan) {
      config(entry.plan);
    }

    if (entry.topW !== undefined) {
      entry.topW = load(entry.topW);
    }

    sets(entry.sets, false);
  }

  if (state.active?.bw !== null && state.active?.bw !== undefined) {
    state.active.bw = load(state.active.bw);
  }

  plan(state.active?.sessionPlan);

  for (const entry of state.bodyweight) {
    entry.w = load(entry.w);
  }

  for (const hint of Object.values(state.exWeights)) {
    hint.w = load(hint.w);
  }

  if (state.targetW !== null) {
    state.targetW = load(state.targetW);
  }

  if (state.plates) {
    state.plates = defaultPlateSetup(unit);
  }

  state.unit = unit;
}
