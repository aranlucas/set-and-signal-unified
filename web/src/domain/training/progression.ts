import { advanceFivefold } from "@set-and-signal/training/fivefold";
// Automatic progression (issue #17).
//
// Everything here is a pure function of the workout history. Nothing writes back into a
// finished workout: the log is what happened, and the next prescription is *derived* from
// it every time it is needed. That means changing a policy — or fixing a mistyped set —
// immediately produces the right next target, with no stored counters to drift out of sync.
//
// It replaces a single hard-coded rule ("all reps done → add 2.5") with a small set of named
// policies. The rule that applies is always visible in the app, together with the reason it
// picked this weight, because a suggestion you can't audit is one you stop trusting.
//
// Reading a session honestly is the whole game:
//   · a set checked off with at least its target reps  → hit
//   · a set checked off with fewer reps                → miss (you logged what you got)
//   · a set never checked off                          → miss (it was not performed)
//   · fewer sets than prescribed                       → miss
// So a session that fell apart can never advance the load as though it had succeeded.

import { modeOf, repStep, isWarmup, isBw, sessionLoad } from "@/domain/training/history.js";
import type { AppState, Workout } from "@/shared/lib/types";
import type { AnyConfig, SetFields, WorkoutLike } from "@/domain/training/history.js";
import { EXIDX } from "@/domain/exercises/exercises.js";
import type {
  ExConfig,
  Id,
  IsoDate,
  LoggedSet,
  Mode,
  PolicyId,
  Prescription,
  SessionRead,
  TranslationMessage,
  Unit,
} from "@/shared/lib/types.js";

type PolicyForProps = { prog?: PolicyId };

type ReadSessionProps = {
  id?: Id;
  target?: AnyConfig | null;
  sets?: SetFields[];
  topW?: number | null;
};

type SessionsForProps = { unit?: Unit; workouts: WorkoutLike[] };

type StallCountProps = { ok: boolean };

type NextPrescriptionProps = { unit?: Unit; workouts: WorkoutLike[] };

type NextPrescriptionProps2 = { prog?: PolicyId };

type SyncSourceRoutineWeightsResult = { ex: ExConfig[]; prog?: PolicyId };

type SyncSourceRoutineWeightsProps = { unit?: Unit; workouts: WorkoutLike[] };

const reason = (
  key: TranslationMessage["key"],
  defaultValue: string,
  values?: TranslationMessage["values"],
): TranslationMessage => ({ key, defaultValue, values });

// Which policies can sensibly drive which logging mode.
export const POLICIES_FOR: Record<Mode, PolicyId[]> = {
  reps: ["off", "linear", "greyskull", "double", "fivefold"],
  time: ["off", "time"],
  cardio: ["off"],
};

// Sessions of repeated misses before a deload. Greyskull resets on the first failure by
// design; linear gives one more crack, then drops 10% so a stall cannot last forever.
export const DELOAD_AFTER: Record<Exclude<PolicyId, "off">, number> = {
  linear: 2,
  fivefold: 3,
  greyskull: 1,
  double: 3,
  time: 3,
};

const DELOAD_FACTOR = 0.9;

// Body parts where a 5 kg jump is normal rather than brutal.
const HEAVY_BP = new Set(["upper legs", "lower legs", "back", "hips", "glutes"]);

const COMPACT_EQ = new Set(["dumbbell", "kettlebell"]);

function equipmentOf(exId: Id): string {
  const exercise = EXIDX[exId];

  return (exercise && "eq" in exercise && exercise.eq ? exercise.eq : "").toLowerCase();
}

// Default load step. Lower-body barbell lifts take the bigger jump; dumbbells and
// kettlebells stay on the small plate (5 lb / 2.5 kg) even on squat and hinge work.
export function defaultIncrement(exId: Id, unit: Unit): number {
  const exercise = EXIDX[exId];
  const compact = COMPACT_EQ.has(equipmentOf(exId));
  const isHeavy = !!exercise && HEAVY_BP.has(exercise.bp);

  if (compact) {
    return unit === "lb" ? 5 : 2.5;
  }

  if (unit === "lb") {
    return isHeavy ? 10 : 5;
  }

  return isHeavy ? 5 : 2.5;
}

export const DEFAULT_SEC_INCREMENT = 5;

// Where adding another set of push-ups stops being progress and starts being a way to spend
// an evening. Past this the honest advice is load or a harder variation (issue #33).
export const MAX_BW_SETS = 6;

// What one session looks like once a date is attached (sessionsFor).
export interface SessionRow extends SessionRead {
  d: IsoDate;
}

// The policy in force for one exercise: its own override, else the routine's default, else
// the mode's default. Reps keeps behaving the way the app always did (all reps → add a step).
export function policyFor(
  cfg: AnyConfig | null | undefined,
  routine: PolicyForProps | null | undefined,
  mode?: Mode,
): PolicyId {
  const resolvedMode = mode || modeOf(cfg || {});
  const allowedPolicies = POLICIES_FOR[resolvedMode] || ["off"];

  const selectedPolicy = cfg?.prog || routine?.prog || (resolvedMode === "reps" ? "linear" : "off");

  return allowedPolicies.includes(selectedPolicy) ? selectedPolicy : "off";
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// Snap to a loadable multiple of the step.
function snap(v: number, step: number): number {
  if (!(step > 0)) {
    return round1(v);
  }

  return round1(Math.round(v / step) * step);
}

// Back off by DELOAD_FACTOR, landing on something you can actually load. Rounding to the
// nearest step keeps the cut close to the intended 10 %, but on small weights the nearest
// step can be the weight you started from — so a deload that did not actually reduce
// anything takes one step down instead. Never goes below a single step.
function deloadTo(currentWeight: number, step: number): number {
  let deloadedWeight = snap(currentWeight * DELOAD_FACTOR, step);

  if (deloadedWeight >= currentWeight) {
    deloadedWeight = snap(currentWeight - step, step);
  }

  return Math.max(step, deloadedWeight);
}

/**
 * Reduce one finished workout entry to what a policy needs to judge it.
 *
 * Planned sessions capture their prescription in `target`. Imported CSV history
 * records performed sets without a prescribed target, so it is judged against
 * `fallback`, the exercise's current plan.
 */
export function readSession(
  entry?: ReadSessionProps | null,
  fallback?: AnyConfig | null,
): SessionRead {
  const target = entry?.target || fallback || {};
  const mode = modeOf({ ...target, id: entry ? entry.id : undefined });
  // Warm-up sets are preparation, not performance: a policy judges the working sets alone,
  // or three ramp sets would satisfy "every set hit" on their own.
  const loggedSets = (entry?.sets || []).filter((set) => !isWarmup(set));
  const plannedSets = target.sets || loggedSets.length;
  const hasEnoughSets = loggedSets.length >= plannedSets;
  const weight = sessionLoad(entry, fallback);

  if (mode === "time") {
    const goal = target.sec || 0;
    const held = loggedSets.map((set) => (set.done ? set.sec || 0 : 0));

    return {
      mode,
      goal,
      held,
      weight,
      best: Math.max(0, ...held),
      ok:
        goal > 0 && hasEnoughSets && held.length > 0 && held.every((duration) => duration >= goal),
    };
  }

  const goal = target.reps || 0;
  const reps = loggedSets.map((set) => (set.done ? set.r || 0 : 0));

  return {
    mode,
    goal,
    reps,
    weight,
    count: reps.length, // the dimension bodyweight work grows (#33)
    low: reps.length > 0 ? Math.min(...reps) : 0,
    amrap: reps.length > 0 ? reps.at(-1) : 0, // Greyskull's final set
    ok:
      goal > 0 &&
      hasEnoughSets &&
      reps.length > 0 &&
      reps.every((repetitionCount) => repetitionCount >= goal),
  };
}

/** Every past session for one exercise, oldest first. `fallback` — see readSession. */
export function sessionsFor(
  state: SessionsForProps,
  exId: Id,
  fallback?: AnyConfig | null,
): SessionRow[] {
  const sessions: SessionRow[] = [];

  for (const workout of state.workouts || []) {
    const entry = workout.entries.find((candidate) => candidate.id === exId);

    if (entry?.sets?.some((set) => set.done)) {
      sessions.push({ d: workout.d, ...readSession(entry, fallback) });
    }
  }

  return sessions;
}

// How many sessions in a row ended in a miss, counting back from the most recent.
export function stallCount(sessions: ReadonlyArray<StallCountProps>): number {
  let missedSessions = 0;

  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].ok) {
      break;
    }

    missedSessions++;
  }

  return missedSessions;
}

/**
 * The next prescription for one exercise.
 *
 * Returns `{ weight, reps, sec, why, kind }` — `kind` being one of
 * first | up | hold | deload | off, and `why` a translatable template + args so the app can
 * always answer "why this number?". A field the policy has no opinion on comes back
 * undefined and the caller keeps whatever the plan said.
 */
export function nextPrescription(
  state: NextPrescriptionProps,
  cfg: AnyConfig & Pick<ExConfig, "id" | "sets">,
  routine?: NextPrescriptionProps2 | null,
): Prescription {
  const mode = modeOf(cfg);
  const policy = policyFor(cfg, routine, mode);
  const unit: Unit = state.unit || "lb";

  if (policy === "fivefold") {
    return {
      policy,
      kind: "hold",
      weight: cfg.weight ?? 0,
      why: reason(
        "progression.fivefoldSavedTarget",
        "Saved 5×5 target; skipped sets do not add misses.",
      ),
    };
  }

  const increment =
    cfg.inc != null && cfg.inc > 0
      ? cfg.inc
      : mode === "time"
        ? DEFAULT_SEC_INCREMENT
        : defaultIncrement(cfg.id, unit);

  if (policy === "off") {
    return { policy, kind: "off" };
  }

  const sessions = sessionsFor(state, cfg.id, cfg).filter((session) => session.mode === mode);
  const last = sessions.at(-1);

  if (!last) {
    return {
      policy,
      kind: "first",
      why: reason(
        "progression.nothingLoggedYetSessionSets",
        "Nothing logged yet — this session sets the baseline.",
      ),
    };
  }

  const stalls = stallCount(sessions);
  const deloadAt = DELOAD_AFTER[policy] || 3;

  if (mode === "time") {
    if (last.ok) {
      const sec = (last.goal || cfg.sec || 0) + increment;

      return {
        policy,
        kind: "up",
        sec,
        why: reason(
          "progression.heldEverySetFullTime",
          "Held every set for the full time — target up by {{seconds}}s.",
          { seconds: increment },
        ),
      };
    }

    if (stalls >= deloadAt) {
      const sec = deloadTo(last.goal || cfg.sec || 0, 5);

      return {
        policy,
        kind: "deload",
        sec,
        why: reason(
          "progression.shortSessionsRowBackOff",
          "Short {{count}} sessions in a row — back off to {{seconds}}s and build up again.",
          { count: stalls, seconds: sec },
        ),
      };
    }

    return {
      policy,
      kind: "hold",
      sec: last.goal || cfg.sec,
      why: reason(
        "progression.lastTimeCameShortSame",
        "Last time came up short — same target again.",
      ),
    };
  }

  const currentWeight = last.weight;

  // Bodyweight work carries no external load, so there is nothing to add or take away —
  // "deload your push-ups to 2.5 kg" is not advice. Progress in reps instead. This runs ahead
  // of the individual policies because it is true for all of them. A dip done with a belt has
  // a load to progress and belongs on the normal policies. A loaded lift logged at 0 is missing
  // data, not a bodyweight session — hold the plan rather than inventing extra reps.
  if (currentWeight <= 0 && isBw(cfg)) {
    const goal = last.goal || cfg.reps || 0;

    if (!last.ok || goal <= 0) {
      return {
        policy,
        kind: "hold",
        weight: 0,
        reps: goal || undefined,
        why: reason(
          "progression.bodyweightSameTargetAgainUntil",
          "Bodyweight — same target again until every set is clean.",
        ),
      };
    }

    // A ceiling turns "+1 rep forever" into a plan (issue #33). Past the top of the range the
    // reps go back to the bottom and a set is added instead, which is how bodyweight work
    // actually progresses once a set of 30 push-ups stops being a strength stimulus.
    const top = cfg.repsMax != null && cfg.repsMax > 0 ? cfg.repsMax : 0;

    if (top > 0 && goal >= top) {
      const sets = Math.max(1, cfg.sets || last.count || 1) + 1;
      const bottom = Math.max(1, Math.min(cfg.reps || top, top));

      if (sets <= MAX_BW_SETS) {
        return {
          policy,
          kind: "up",
          weight: 0,
          reps: bottom,
          sets,
          why: reason(
            "exercise.measurement.repsEverySetAddSet",
            "{{reps}} reps in every set — add a set and go back to {{resetReps}}.",
            { reps: goal, resetReps: bottom },
          ),
        };
      }

      // Out of sets worth adding: more volume is no longer the answer, load or a harder
      // variation is — and that is a decision for a person, not a policy.
      return {
        policy,
        kind: "hold",
        weight: 0,
        reps: goal,
        why: reason(
          "exercise.measurement.setsTimeAddWeightMove",
          "{{sets}} sets of {{reps}} — time to add weight or move to a harder variation.",
          { sets: sets - 1, reps: goal },
        ),
      };
    }

    // Unilateral work steps by two, so the total stays even and both sides get the rep.
    const nextReps = goal + repStep(cfg);

    return {
      policy,
      kind: "up",
      weight: 0,
      reps: nextReps,
      why: reason(
        "progression.bodyweightEveryRepLastTime",
        "Bodyweight — every rep last time, so go for {{reps}} this time.",
        { reps: nextReps },
      ),
    };
  }

  if (currentWeight <= 0) {
    const goal = last.goal || cfg.reps || 0;

    return {
      policy,
      kind: "hold",
      weight: 0,
      reps: goal || undefined,
      why: reason(
        "progression.nothingLoggedYetSessionSets",
        "Nothing logged yet — this session sets the baseline.",
      ),
    };
  }

  if (policy === "double") {
    const top = cfg.reps || last.goal || 10;
    const bottom = Math.min(cfg.repsMin || Math.max(1, top - 2), top);

    if (last.ok) {
      return {
        policy,
        kind: "up",
        weight: snap(currentWeight + increment, increment),
        reps: bottom,
        why: reason(
          "progression.topRepRangeEverySet",
          "Top of the rep range in every set — {{amount}} {{unit}} more, back to {{reps}} reps.",
          { amount: increment, unit, reps: bottom },
        ),
      };
    }

    if (stalls >= deloadAt) {
      const dw = deloadTo(currentWeight, increment);

      return {
        policy,
        kind: "deload",
        weight: dw,
        reps: bottom,
        why: reason(
          "progression.stalledSessionsDeload",
          "Stalled {{count}} sessions — deload to {{weight}} {{unit}}.",
          { count: stalls, weight: dw, unit },
        ),
      };
    }

    const aim = Math.min(top, Math.max(bottom, (last.low ?? 0) + repStep(cfg)));

    return {
      policy,
      kind: "hold",
      weight: currentWeight,
      reps: aim,
      why: reason(
        "progression.sameWeightAimRepsTime",
        "Same weight — aim for {{reps}} reps this time.",
        { reps: aim },
      ),
    };
  }

  // linear + greyskull
  if (last.ok) {
    // Greyskull's final set is taken to failure: double the target reps there and you have
    // earned a double jump.
    const amrap = last.amrap;
    const dbl = policy === "greyskull" && last.goal > 0 && amrap != null && amrap >= last.goal * 2;
    const step = dbl ? increment * 2 : increment;

    return {
      policy,
      kind: "up",
      weight: snap(currentWeight + step, increment),
      why: dbl
        ? reason(
            "progression.lastSetHitRepsTwice",
            "Last set hit {{reps}} reps — twice the target, so take a double jump of {{amount}} {{unit}}.",
            { reps: amrap ?? 0, amount: step, unit },
          )
        : reason(
            "progression.everyRepLastTimeMore",
            "Every rep last time — {{amount}} {{unit}} more.",
            { amount: step, unit },
          ),
    };
  }

  if (stalls >= deloadAt) {
    const dw = deloadTo(currentWeight, increment);

    return {
      policy,
      kind: "deload",
      weight: dw,
      why:
        stalls > 1
          ? reason(
              "progression.missedRepsSessionsRunningReset",
              "Missed reps {{count}} sessions running — reset to {{weight}} {{unit}} and work back up.",
              { count: stalls, weight: dw, unit },
            )
          : reason(
              "progression.missedRepsResetWorkBack",
              "Missed reps — reset to {{weight}} {{unit}} and work back up.",
              { weight: dw, unit },
            ),
    };
  }

  return {
    policy,
    kind: "hold",
    weight: currentWeight,
    why: reason(
      "progression.missedRepsLastTimeSame",
      "Missed reps last time — same weight again ({{current}} of {{total}} to go).",
      { current: deloadAt - stalls, total: deloadAt },
    ),
  };
}

/**
 * Apply a prescription to freshly built sets. Only the fields the policy actually decided
 * are touched, and only on sets that have not been logged yet.
 */
export function applyPrescription<T extends LoggedSet>(
  sets: T[],
  prescription?: Partial<Prescription> | null,
): T[] {
  if (!prescription || prescription.kind === "off" || prescription.kind === "first") {
    return sets;
  }

  const updatedSets: T[] = [];

  for (const set of sets) {
    if (set.done) {
      updatedSets.push(set);

      continue;
    }

    const nextSet = { ...set };

    if (prescription.weight != null && "w" in nextSet) {
      nextSet.w = prescription.weight;
    }

    if (prescription.reps != null && "r" in nextSet) {
      nextSet.r = prescription.reps;
    }

    if (prescription.sec != null && "sec" in nextSet) {
      nextSet.sec = prescription.sec;
    }

    updatedSets.push(nextSet);
  }

  // A policy that decided on a set count gets to grow the list — bodyweight progression adds
  // a set where a barbell would have added a plate. Only ever upwards, and only by copying a
  // row that is already there: a session in progress must not lose a set it has logged.
  if (prescription.sets != null && prescription.sets > updatedSets.length) {
    const templateSet = updatedSets.at(-1);

    if (!templateSet) {
      return updatedSets;
    }

    while (updatedSets.length < prescription.sets) {
      updatedSets.push({ ...templateSet, done: false });
    }
  }

  return updatedSets;
}

/** Copy the fields a policy decided onto a planned exercise. The log is left alone. */
export function applyPrescriptionToConfig(
  cfg: ExConfig,
  prescription?: Partial<Prescription> | null,
): ExConfig {
  if (!prescription || prescription.kind === "off") {
    return cfg;
  }

  const next: ExConfig = { ...cfg };

  if (prescription.weight != null) {
    next.weight = prescription.weight;
  }

  if (prescription.reps != null) {
    next.reps = prescription.reps;
  }

  if (prescription.sets != null) {
    next.sets = prescription.sets;
  }

  if (prescription.sec != null) {
    next.sec = prescription.sec;
  }

  return next;
}

/**
 * After a workout is saved, the source routine should carry the next working
 * weight so today's session is not planned at 0. Only listed exercise ids are
 * touched; the rest of the routine is left as-is.
 */
export function syncSourceRoutineWeights<T extends SyncSourceRoutineWeightsResult>(
  state: SyncSourceRoutineWeightsProps,
  routine: T,
  exerciseIds: readonly Id[],
): T {
  const wanted = new Set(exerciseIds);

  return {
    ...routine,
    ex: routine.ex.map((cfg) => {
      if (!wanted.has(cfg.id)) {
        return cfg;
      }

      if (policyFor(cfg, routine) === "fivefold") {
        const latest = state.workouts.at(-1);
        const entry = latest?.entries.find((candidate) => candidate.id === cfg.id);

        if (!latest?.id || !entry || latest.progressionApplied?.includes(cfg.id)) {
          return cfg;
        }

        return advanceFivefold(
          cfg,
          {
            id: latest.id,
            weight: sessionLoad(entry, cfg),
            sets: entry.sets
              .filter((set) => !isWarmup(set))
              .map((set) => (set.done ? (set.r ?? 0) : null)),
          },
          state.unit ?? "lb",
        );
      }

      const prescription = nextPrescription(state, cfg, routine);
      const updated = applyPrescriptionToConfig(cfg, prescription);

      if ((updated.weight ?? 0) > 0) {
        return updated;
      }

      const last = sessionsFor(state, cfg.id, cfg).at(-1)?.weight ?? 0;

      return last > 0 ? { ...updated, weight: last } : updated;
    }),
  };
}

/** Apply a reviewed completed record once, keeping shared Fivefold lifts aligned. */
export function applyWorkoutProgression(state: AppState, workout: Workout): void {
  const routine = state.routines.find((candidate) => candidate.id === workout.routineId);

  if (!routine || workout.sessionPlan) {
    return;
  }

  const current = state.workouts.find((candidate) => candidate.id === workout.id);

  if (routine.prog === "fivefold" && current?.progressionApplied?.length) {
    return;
  }

  const view = {
    ...state,
    workouts: [...state.workouts.filter((candidate) => candidate.id !== workout.id), workout],
  };

  const source = syncSourceRoutineWeights(
    view,
    routine,
    workout.entries.map((entry) => entry.id),
  );

  state.routines = state.routines.map((candidate) => {
    if (candidate.id === source.id) {
      return source;
    }

    if (source.prog !== "fivefold" || candidate.prog !== "fivefold") {
      return candidate;
    }

    return {
      ...candidate,
      ex: candidate.ex.map((cfg) => {
        const changed = source.ex.find((entry) => entry.id === cfg.id);

        return changed ? { ...cfg, weight: changed.weight, fivefold: changed.fivefold } : cfg;
      }),
    };
  });

  if (source.prog === "fivefold") {
    state.fivefoldNext = source.id === "fivefold-A" ? "B" : "A";
    state.workouts = state.workouts.map((record) =>
      record.id === workout.id
        ? { ...record, progressionApplied: workout.entries.map((entry) => entry.id) }
        : record,
    );
  }
}
