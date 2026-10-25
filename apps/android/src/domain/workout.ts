import {
  ROUTINE,
  maxWeight,
  maxBarWeight,
  nextPlan,
  round,
  convertWeight,
} from "@set-and-signal/training/fivefold";
import type {
  Lift,
  WorkoutKind,
  LiftPlan,
  Exercise,
  Unit,
} from "@set-and-signal/training/fivefold";

export {
  LIFTS,
  NAMES,
  ROUTINE,
  maxWeight,
  maxBarWeight,
  nextPlan,
  round,
  convertWeight,
} from "@set-and-signal/training/fivefold";

export type {
  Lift,
  WorkoutKind,
  LiftPlan,
  Exercise,
  Unit,
} from "@set-and-signal/training/fivefold";

import type { PlateInventory } from "./plates";

export type { PlateInventory } from "./plates";

import { mondayWeekStart } from "./calendar";

export { formatWeight } from "./format";

interface PlateLoadEntry {
  weight: number;
  count: number;
}

interface WeekCount {
  start: number;
  count: number;
}

function liftMap<Value>(make: (lift: Lift) => Value): Record<Lift, Value> {
  return {
    squat: make("squat"),
    bench: make("bench"),
    row: make("row"),
    press: make("press"),
    deadlift: make("deadlift"),
  };
}

export const CUES: Record<Lift, string> = {
  squat: "Brace, sit between your hips, and drive through your whole foot.",
  bench: "Keep your feet planted, shoulder blades back, and wrists stacked.",
  row: "Hinge at the hips, brace your torso, and pull toward your lower chest.",
  press: "Squeeze your glutes, brace, and finish with the bar over your shoulders.",
  deadlift: "Keep the bar close, take the slack out, and push the floor away.",
};

export interface Session {
  id: string;
  kind: WorkoutKind;
  startedAt: number;
  finishedAt: number | null;
  exercises: Exercise[];
  notes: string;
  unit: Unit;
}

export interface Settings {
  unit: Unit;
  bar: number;
  plates: PlateInventory | null;
  restSeconds: number;
  failedRestSeconds: number;
  autoProgress: boolean;
  autoDeload: boolean;
  haptics: boolean;
  keepAwake: boolean;
  restAlerts: boolean;
  theme: "system" | "light" | "dark";
}

export interface Rest {
  endsAt: number;
  duration: number;
  lift: Lift;
  setIndex: number;
}

export interface AppState {
  version: 1;
  onboarded: boolean;
  next: WorkoutKind;
  plans: Record<Lift, LiftPlan>;
  settings: Settings;
  active: Session | null;
  history: Session[];
  rest: Rest | null;
}

export function initialState(unit: Unit = "lb"): AppState {
  const base = unit === "kg" ? 20 : 45;
  const step = unit === "kg" ? 2.5 : 5;

  return {
    version: 1,
    onboarded: false,
    next: "A",
    plans: liftMap((lift) => ({
      weight: lift === "deadlift" ? base * 2 : lift === "row" ? base + step * 4 : base,
      increment: lift === "deadlift" ? step * 2 : step,
      failures: 0,
    })),
    settings: {
      unit,
      bar: base,
      plates: null,
      restSeconds: 90,
      failedRestSeconds: 180,
      autoProgress: true,
      autoDeload: true,
      haptics: true,
      keepAwake: true,
      restAlerts: false,
      theme: "system",
    },
    active: null,
    history: [],
    rest: null,
  };
}

export const totalSets = (s: Pick<Session, "exercises">) =>
  s.exercises.reduce((n, e) => n + e.sets.length, 0);

export const loggedSets = (s: Pick<Session, "exercises">) =>
  s.exercises.reduce((n, e) => n + e.sets.filter((r) => r !== null).length, 0);

export const volume = (s: Session) =>
  round(
    s.exercises.reduce(
      (n, e) => n + e.weight * e.sets.reduce<number>((t, r) => t + (r ?? 0), 0),
      0,
    ),
  );

export function startSession(state: AppState, now = Date.now(), kind = state.next): AppState {
  if (state.active) {
    return state;
  }

  return {
    ...state,
    rest: null,
    active: {
      id: `workout-${now}-${state.history.length}`,
      kind,
      startedAt: now,
      finishedAt: null,
      unit: state.settings.unit,
      notes: "",
      exercises: ROUTINE[kind].map((lift) => ({
        lift,
        weight: state.plans[lift].weight,
        sets: Array.from({ length: lift === "deadlift" ? 1 : 5 }, () => null),
      })),
    },
  };
}

export function logSet(
  state: AppState,
  lift: Lift,
  index: number,
  reps: number | null,
  now = Date.now(),
): AppState {
  const session = state.active;
  const exercise = session?.exercises.find((e) => e.lift === lift);

  if (
    !session ||
    !exercise ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= exercise.sets.length ||
    (reps !== null && (!Number.isInteger(reps) || reps < 0 || reps > 5))
  ) {
    return state;
  }

  const wasLogged = exercise.sets[index] !== null;

  return {
    ...state,
    active: {
      ...session,
      exercises: session.exercises.map((e) =>
        e.lift === lift ? { ...e, sets: e.sets.map((r, i) => (i === index ? reps : r)) } : e,
      ),
    },
    rest:
      reps !== null &&
      (!wasLogged ||
        (state.rest?.lift === lift &&
          state.rest.setIndex === index &&
          reps < 5 &&
          state.rest.duration < state.settings.failedRestSeconds))
        ? {
            lift,
            setIndex: index,
            duration: reps === 5 ? state.settings.restSeconds : state.settings.failedRestSeconds,
            endsAt:
              now +
              (reps === 5 ? state.settings.restSeconds : state.settings.failedRestSeconds) * 1000,
          }
        : reps === null && state.rest?.lift === lift && state.rest.setIndex === index
          ? null
          : state.rest,
  };
}

export function finishSession(state: AppState, now = Date.now()): AppState {
  if (!state.active || loggedSets(state.active) === 0) {
    return state;
  }
  // Clock changes must not produce a timestamp that makes saved data unreadable.

  const finishedAt = Number.isFinite(now)
    ? Math.min(8.64e15, Math.max(state.active.startedAt, now))
    : state.active.startedAt;

  const session: Session = { ...state.active, finishedAt };
  const plans = { ...state.plans };

  for (const e of session.exercises) {
    plans[e.lift] = { ...nextPlan(plans[e.lift], e, state.settings), lastWorkoutId: session.id };
  }

  return {
    ...state,
    active: null,
    rest: null,
    next: session.kind === "A" ? "B" : "A",
    plans,
    history: [session, ...state.history],
  };
}

export function changeUnit(state: AppState, unit: Unit): AppState {
  if (unit === state.settings.unit || state.active) {
    return state;
  }

  const from = state.settings.unit;
  const step = unit === "kg" ? 2.5 : 5;

  const snap = (n: number) =>
    Math.min(maxWeight(unit), round(Math.round(convertWeight(n, from, unit) / step) * step));

  return {
    ...state,
    settings: {
      ...state.settings,
      unit,
      bar:
        state.settings.bar === (from === "kg" ? 20 : 45)
          ? unit === "kg"
            ? 20
            : 45
          : Math.min(
              maxBarWeight(unit),
              Math.max(1, round(convertWeight(state.settings.bar, from, unit))),
            ),
    },
    plans: liftMap((lift) => ({
      ...state.plans[lift],
      weight: snap(state.plans[lift].weight),
      increment: lift === "deadlift" ? step * 2 : step,
    })),
  };
}

export function plateLoad(weight: number, bar: number, unit: Unit) {
  const plates = unit === "kg" ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5];
  let remaining = Math.max(0, (weight - bar) / 2);
  const perSide: PlateLoadEntry[] = [];

  for (const p of plates) {
    const count = Math.floor((remaining + 1e-7) / p);

    if (count) {
      perSide.push({ weight: p, count });
    }

    remaining = round(remaining - count * p);
  }

  return { perSide, remainder: round(remaining * 2), belowBar: weight < bar };
}

export function warmups(weight: number, bar: number, unit: Unit) {
  if (weight <= bar) {
    return [];
  }

  const step = unit === "kg" ? 2.5 : 5;
  const result = [{ weight: bar, sets: 2, reps: 5 }];

  for (const [fraction, reps] of [
    [0.5, 5],
    [0.7, 3],
    [0.9, 1],
  ]) {
    const w = Math.floor((weight * fraction) / step) * step;

    const previous = result.at(-1);

    if (previous && w > previous.weight && w < weight) {
      result.push({ weight: w, sets: 1, reps });
    }
  }

  return result;
}

const weekCounts = new WeakMap<Session[], WeekCount>();

export function weeklyCount(history: Session[], now = new Date()) {
  const start = mondayWeekStart(now);
  const cached = weekCounts.get(history);

  if (cached?.start === +start) {
    return cached.count;
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const count = history.filter(
    (s) => s.finishedAt !== null && s.finishedAt >= +start && s.finishedAt < +end,
  ).length;

  weekCounts.set(history, { start: +start, count });

  return count;
}
