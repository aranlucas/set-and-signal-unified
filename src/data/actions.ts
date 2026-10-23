import type { PlateInventory } from "../domain/plates";
import * as Haptics from "expo-haptics";
import * as commands from "../domain/commands";
import {
  changeUnit,
  finishSession,
  logSet,
  type AppState,
  type Lift,
  type Settings,
  type Unit,
} from "../domain/workout";
import { commit, getSnapshot } from "./store";
import { enableRestAlerts } from "./notifications";
import { exportData, importData } from "./exports";
import { notify } from "./notices";

export const startWorkout = () => {
  const now = Date.now();

  return commit((state) => commands.beginWorkout(state, now));
};

export const discardWorkout = () => commit(commands.discardWorkout);

export const deleteWorkout = (id: string) => commit((state) => commands.deleteSession(state, id));

export const setNotes = (notes: string) => commit((state) => commands.setNotes(state, notes));

export const switchNext = () => commit(commands.switchNext);

export const extendRest = () => {
  const now = Date.now();

  return commit((state) => commands.extendRest(state, now));
};

export const skipRest = () => commit(commands.skipRest);

export const saveWeight = (lift: Lift | "bar", value: number, increment?: number) =>
  commit((state) =>
    lift === "bar"
      ? commands.saveBar(state, value)
      : commands.saveLift(state, lift, value, increment ?? state.plans[lift].increment),
  );

export const updateSettings = (settings: Partial<Settings>) =>
  commit((state) => commands.updateSettings(state, settings));

export const completeOnboarding = () => commit(commands.completeOnboarding);

export const finishWorkout = () => {
  const now = Date.now();

  return commit((state) => finishSession(state, now));
};

export const restoreBackup = (backup: AppState) => {
  const now = Date.now();

  return commit(() => commands.restoreBackup(backup, now));
};

export const undoLoggedSet = (undo: commands.UndoSet) => {
  const now = Date.now();

  return commit((state) => commands.undoLoggedSet(state, undo, now));
};

export const changeWorkoutUnit = (unit: Unit) => commit((state) => changeUnit(state, unit));

export function setUnit(unit: Unit) {
  if (getSnapshot().state.active) {
    notify("Finish your workout to change units.");
  } else {
    changeWorkoutUnit(unit);
  }
}

export function recordSet(lift: Lift, index: number, reps: number | null): commands.UndoSet | null {
  const state = getSnapshot().state;

  const undo = state.active
    ? {
        sessionId: state.active.id,
        lift,
        index,
        reps:
          state.active.exercises.find((exercise) => exercise.lift === lift)?.sets[index] ?? null,
        rest: state.rest,
      }
    : null;

  const now = Date.now();

  if (commit((current) => logSet(current, lift, index, reps, now)) && state.settings.haptics) {
    void Haptics.performAndroidHapticsAsync(
      reps === null
        ? Haptics.AndroidHaptics.Toggle_Off
        : reps === 5
          ? Haptics.AndroidHaptics.Confirm
          : Haptics.AndroidHaptics.Reject,
    ).catch(() => {});
  }

  return undo;
}

export async function setAlerts(enabled: boolean) {
  if (!enabled) {
    updateSettings({ restAlerts: false });

    return;
  }

  try {
    if (await enableRestAlerts()) {
      updateSettings({ restAlerts: true });
    } else {
      notify("Notifications are off. Turn them on in Android settings.");
    }
  } catch {
    notify("Notifications aren't available.");
  }
}

export async function exportWorkoutData(format: "json" | "csv" | "share") {
  try {
    const message = await exportData(
      getSnapshot().state,
      format === "share" ? "json" : format,
      format === "share",
    );

    if (message) {
      notify(message);
    }
  } catch (error) {
    notify(error instanceof Error ? error.message : "Couldn't export your data.");
  }
}

export async function readBackup() {
  try {
    return await importData();
  } catch (error) {
    notify(error instanceof Error ? error.message : "Couldn't read this backup.");

    return null;
  }
}

export const setPlateInventory = (plates: PlateInventory | null) =>
  commit((state) => commands.setPlateInventory(state, plates));

export const countMyPlates = (enabled: boolean) =>
  commit((state) => commands.countMyPlates(state, enabled));

export const stepPlatePair = (unit: Unit, index: number, direction: -1 | 1) =>
  commit((state) => commands.stepPlatePair(state, unit, index, direction));
