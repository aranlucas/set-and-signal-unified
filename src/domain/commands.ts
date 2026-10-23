import {
  defaultPlateInventory,
  PLATE_SIZES,
  type PlateInventory,
} from "./plates";
import type { Unit } from "./workout";
import {
  logSet,
  startSession,
  type AppState,
  type Lift,
  type Rest,
  type Settings,
} from "./workout";

export interface UndoSet {
  sessionId: string;
  lift: Lift;
  index: number;
  reps: number | null;
  rest: Rest | null;
}
export function discardWorkout(state: AppState): AppState {
  return { ...state, active: null, rest: null };
}
export function deleteSession(state: AppState, id: string): AppState {
  return {
    ...state,
    history: state.history.filter((session) => session.id !== id),
  };
}
export function setNotes(state: AppState, notes: string): AppState {
  return state.active
    ? { ...state, active: { ...state.active, notes } }
    : state;
}
export function switchNext(state: AppState): AppState {
  return { ...state, next: state.next === "A" ? "B" : "A" };
}
export function extendRest(state: AppState, now: number): AppState {
  return state.rest
    ? {
        ...state,
        rest: {
          ...state.rest,
          endsAt: Math.min(
            Math.max(now, state.rest.endsAt) + 30000,
            now + 3600000,
          ),
          duration: Math.min(3600, state.rest.duration + 30),
        },
      }
    : state;
}
export function skipRest(state: AppState): AppState {
  return { ...state, rest: null };
}
export function saveLift(
  state: AppState,
  lift: Lift,
  weight: number,
  increment: number,
): AppState {
  return {
    ...state,
    plans: { ...state.plans, [lift]: { weight, increment, failures: 0 } },
    active: state.active
      ? {
          ...state.active,
          exercises: state.active.exercises.map((exercise) =>
            exercise.lift === lift ? { ...exercise, weight } : exercise,
          ),
        }
      : null,
  };
}
export function updateSettings(
  state: AppState,
  settings: Partial<Settings>,
): AppState {
  return { ...state, settings: { ...state.settings, ...settings } };
}
export function saveBar(state: AppState, bar: number): AppState {
  return updateSettings(state, { bar });
}
export function completeOnboarding(state: AppState): AppState {
  return { ...state, onboarded: true };
}
export function beginWorkout(state: AppState, now: number): AppState {
  return startSession(completeOnboarding(state), now);
}
export function restoreBackup(backup: AppState, now: number): AppState {
  return {
    ...backup,
    rest: backup.rest && backup.rest.endsAt > now ? backup.rest : null,
  };
}
export function undoLoggedSet(
  state: AppState,
  undo: UndoSet,
  now: number,
): AppState {
  return state.active?.id === undo.sessionId
    ? {
        ...logSet(state, undo.lift, undo.index, undo.reps, now),
        rest: undo.rest,
      }
    : state;
}

export function setPlateInventory(
  state: AppState,
  plates: PlateInventory | null,
): AppState {
  return state.settings.plates === plates
    ? state
    : updateSettings(state, { plates });
}
export function countMyPlates(state: AppState, enabled: boolean): AppState {
  return setPlateInventory(
    state,
    enabled ? (state.settings.plates ?? defaultPlateInventory()) : null,
  );
}
export function stepPlatePair(
  state: AppState,
  unit: Unit,
  index: number,
  direction: -1 | 1,
): AppState {
  const plates = state.settings.plates;
  if (
    !plates ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= PLATE_SIZES[unit].length
  )
    return state;
  const count = Math.max(0, Math.min(20, plates[unit][index] + direction));
  if (count === plates[unit][index]) return state;
  return setPlateInventory(state, {
    ...plates,
    [unit]: plates[unit].map((n, i) => (i === index ? count : n)),
  });
}
