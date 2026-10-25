import { todayISO, uid } from "@/shared/lib/format";
import { buildSets, bestWeightFor, workoutVolume, isWarmup } from "@/domain/training/history";
import { beep } from "@/shared/lib/sound";
import { useWorkoutTimer } from "@/features/workout/useWorkoutTimer";
import { is1RMRecord } from "@/domain/training/onerm";
import {
  nextPrescription,
  applyPrescription,
  applyWorkoutProgression,
} from "@/domain/training/progression";
import { EXIDX } from "@/domain/exercises/exercises";
import { exerciseMuscleSnapshot } from "@/domain/exercises/muscles";
import type { ActiveEntry, Id, Workout, WorkoutEntry } from "@/shared/lib/types";
import {
  getAppState,
  getSetWeight,
  getSoundSettings,
  updateAppState,
} from "@/features/exercises/sheet-shared";

type EstimatedRecordsValue = {
  id: Id;
  est: number;
  w: number;
  r: number;
  prev?: number;
};

export function beginWorkout(
  routineId: Id | null,
  bodyweight: number | null,
  freestyleName: string,
): void {
  const state = getAppState();

  if (state.active) {
    return;
  }

  const routine = routineId ? state.routines.find((candidate) => candidate.id === routineId) : null;

  const entries: ActiveEntry[] = (routine ? routine.ex : []).map((config) => {
    const fixedTargets = !!routine?.sessionPlan && (config.prog ?? routine.prog ?? "off") === "off";
    const prescription = fixedTargets ? null : nextPrescription(state, config, routine);

    return {
      id: config.id,
      sg: config.sg,
      target: { ...config },
      plan: prescription,
      sets: applyPrescription(
        buildSets(
          fixedTargets ? { workouts: [], unit: state.unit, plates: state.plates } : state,
          config,
        ),
        prescription,
      ),
    };
  });

  updateAppState((draft) => {
    draft.active = {
      id: uid(),
      d: todayISO(),
      start: Date.now(),
      routineId,
      name: routine ? routine.name : freestyleName,
      bw: bodyweight || null,
      cur: 0,
      entries,
    };

    if (routine?.sessionPlan) {
      draft.active.sessionPlan = structuredClone(routine.sessionPlan);
    }
  });
  useWorkoutTimer.getState().stopRest();
}

export interface FinishSummaryPayload {
  workout: Workout;
  prs: Id[];
  e1prs: Array<{
    id: Id;
    est: number;
    w: number;
    r: number;
    prev?: number;
  }>;
}

export function completeWorkout(): FinishSummaryPayload | null {
  const state = getAppState();
  const activeWorkout = state.active;

  if (!activeWorkout) {
    return null;
  }

  const personalRecords: Id[] = [];
  const personalRecordSet = new Set<Id>();

  const estimatedRecords: Array<EstimatedRecordsValue> = [];

  for (const entry of activeWorkout.entries) {
    // Warm-up ramp sets never set records or become next session's default weight.
    const maxSetWeight = entry.sets.reduce(
      (max, set) => (set.done && !isWarmup(set) ? Math.max(max, getSetWeight(set)) : max),
      0,
    );

    if (maxSetWeight > 0 && maxSetWeight > bestWeightFor(state, entry.id)) {
      personalRecords.push(entry.id);
      personalRecordSet.add(entry.id);
    }

    const estimatedRecord = is1RMRecord(state, entry.id, entry);

    if (estimatedRecord && !personalRecordSet.has(entry.id)) {
      estimatedRecords.push({ id: entry.id, ...estimatedRecord });
    }
  }

  const workout: Workout = {
    id: activeWorkout.id,
    d: activeWorkout.d,
    start: activeWorkout.start,
    end: Date.now(),
    routineId: activeWorkout.routineId,
    name: activeWorkout.name,
    bw: activeWorkout.bw,
    entries: activeWorkout.entries.flatMap((entry) =>
      entry.sets.some((set) => set.done)
        ? (() => {
            const exercise = EXIDX[entry.id];

            const snapshot =
              exercise && "custom" in exercise && exercise.custom
                ? exerciseMuscleSnapshot(exercise)
                : null;

            const logged: WorkoutEntry = {
              id: entry.id,
              sets: entry.sets,
              topW: entry.topW || null,
              target: entry.target || null,
            };

            if (snapshot && Object.keys(snapshot).length > 0) {
              logged.muscleSnapshot = snapshot;
            }

            return [logged];
          })()
        : [],
    ),
    prs: personalRecords,
    vol: 0,
  };

  if (activeWorkout.sessionPlan) {
    workout.sessionPlan = structuredClone(activeWorkout.sessionPlan);
  }

  workout.vol = workoutVolume(workout);
  updateAppState((draft) => {
    for (const entry of workout.entries) {
      const maxWeight = entry.sets.reduce(
        (max, set) => (set.done && !isWarmup(set) ? Math.max(max, getSetWeight(set)) : max),
        Math.max(0, entry.topW || 0),
      );

      if (maxWeight > 0) {
        const currentWeight = draft.exWeights[entry.id];

        if (!currentWeight || maxWeight > currentWeight.w) {
          draft.exWeights[entry.id] = { w: maxWeight, d: workout.d };
        }
      }
    }

    draft.workouts.push(workout);

    applyWorkoutProgression(draft, workout);

    draft.active = null;
  });
  useWorkoutTimer.getState().stopRest();
  beep(getSoundSettings(), 880, 0.15);
  beep(getSoundSettings(), 1100, 0.15, 0.18);
  beep(getSoundSettings(), 1320, 0.3, 0.36);

  return {
    workout,
    prs: personalRecords,
    e1prs: estimatedRecords,
  };
}
