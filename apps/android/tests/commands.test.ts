import { expect, it } from "vitest";
import * as commands from "../src/domain/commands";
import { finishSession, initialState, logSet, startSession } from "../src/domain/workout";
import { requireValue } from "./support/require-value";

const NOW = 1792650000000;

const active = () => logSet(startSession(initialState("kg"), NOW), "squat", 0, 3, NOW);

it("discards only the active workout and rest", () => {
  const state = active();
  const next = commands.discardWorkout(state);
  expect(next).toEqual({ ...state, active: null, rest: null });
  expect(next.plans).toBe(state.plans);
  expect(next.history).toBe(state.history);
});

it("deletes by id without recalculating plans or the next workout", () => {
  const state = finishSession(active(), NOW + 1000);
  const next = commands.deleteSession(state, state.history[0].id);
  expect(next.history).toEqual([]);
  expect(next.plans).toBe(state.plans);
  expect(next.next).toBe(state.next);
});

it("sets notes only on an active session and preserves exercise identities", () => {
  const idle = initialState();
  expect(commands.setNotes(idle, "a")).toBe(idle);
  const state = active();
  const next = commands.setNotes(state, "a");
  expect(next.active?.notes).toBe("a");
  expect(next.active?.exercises).toBe(state.active?.exercises);
  expect(state.active?.notes).toBe("");
});

it("switches next A/B without changing other data", () => {
  const state = initialState();
  expect(commands.switchNext(state)).toEqual({ ...state, next: "B" });
  expect(commands.switchNext(commands.switchNext(state))).toEqual(state);
});

it("extends live and expired rest with the same one-hour caps", () => {
  const state = active();
  const live = commands.extendRest(state, NOW);
  expect(live.rest).toEqual({
    ...state.rest,
    endsAt: NOW + 210000,
    duration: 210,
  });
  const expired = commands.extendRest(state, NOW + 300000);
  expect(expired.rest?.endsAt).toBe(NOW + 330000);

  const capped = commands.extendRest(
    {
      ...state,
      rest: { ...requireValue(state.rest), endsAt: NOW + 5000000, duration: 3590 },
    },
    NOW,
  );

  expect(capped.rest).toMatchObject({ endsAt: NOW + 3600000, duration: 3600 });
  const idle = initialState();
  expect(commands.extendRest(idle, NOW)).toBe(idle);
  expect(commands.skipRest(state)).toEqual({ ...state, rest: null });
});

it("saves weight and increment, resets failures and changes the whole active exercise load", () => {
  const state = active();
  state.plans.squat.failures = 2;
  const next = commands.saveLift(state, "squat", 60, 1.25);
  expect(next.plans.squat).toEqual({
    weight: 60,
    increment: 1.25,
    failures: 0,
  });
  expect(next.active?.exercises[0]).toEqual({
    ...requireValue(state.active).exercises[0],
    weight: 60,
  });
  expect(next.active?.exercises[1]).toBe(state.active?.exercises[1]);
  expect(commands.saveLift(initialState(), "squat", 60, 5).active).toBeNull();
});

it("saves bar and partial settings and completes onboarding without changing plans", () => {
  const state = initialState();
  expect(commands.saveBar(state, 35)).toEqual({
    ...state,
    settings: { ...state.settings, bar: 35 },
  });
  expect(commands.updateSettings(state, { haptics: false, theme: "dark" }).settings).toEqual({
    ...state.settings,
    haptics: false,
    theme: "dark",
  });
  expect(commands.completeOnboarding(state)).toEqual({
    ...state,
    onboarded: true,
  });
  expect(commands.beginWorkout(state, NOW)).toEqual(
    startSession(commands.completeOnboarding(state), NOW),
  );
});

it("restores a backup and drops rest exactly at its deadline", () => {
  const backup = active();
  expect(commands.restoreBackup(backup, NOW).rest).toBe(backup.rest);
  expect(commands.restoreBackup(backup, requireValue(backup.rest).endsAt).rest).toBeNull();
  expect(commands.restoreBackup(backup, NOW + 500000)).toEqual({
    ...backup,
    rest: null,
  });
});

it("undo restores reps and the previous rest only for the same active session", () => {
  const state = active();
  const next = logSet(state, "squat", 1, 5, NOW + 1000);

  const undo = {
    sessionId: requireValue(state.active).id,
    lift: "squat" as const,
    index: 1,
    reps: null,
    rest: state.rest,
  };

  const restored = commands.undoLoggedSet(next, undo, NOW + 2000);
  expect(restored.active?.exercises[0].sets).toEqual(state.active?.exercises[0].sets);
  expect(restored.rest).toBe(state.rest);
  expect(commands.undoLoggedSet(next, { ...undo, sessionId: "different" }, NOW)).toBe(next);
  const idle = initialState();
  expect(commands.undoLoggedSet(idle, undo, NOW)).toBe(idle);
  const corrected = logSet(state, "squat", 0, 5, NOW + 1000);
  expect(
    commands.undoLoggedSet(corrected, { ...undo, index: 0, reps: 3 }, NOW).active?.exercises[0]
      .sets[0],
  ).toBe(3);
});

it("sets inventory purely, enables four pairs in both units and disables counting", () => {
  const before = active();
  const enabled = commands.countMyPlates(before, true);
  expect(enabled.settings.plates).toEqual({
    kg: [4, 4, 4, 4, 4, 4, 4],
    lb: [4, 4, 4, 4, 4, 4],
  });
  expect(before.settings.plates).toBeNull();
  expect(enabled.active).toBe(before.active);
  expect(enabled.history).toBe(before.history);
  expect(enabled.plans).toBe(before.plans);
  expect(commands.countMyPlates(enabled, true)).toBe(enabled);
  expect(commands.setPlateInventory(before, enabled.settings.plates)).toEqual(enabled);
  expect(commands.countMyPlates(enabled, false)).toEqual(before);
});

it("steps only one denomination, preserves the other unit and clamps to 0–20", () => {
  const before = commands.countMyPlates(initialState("kg"), true);
  let next = commands.stepPlatePair(before, "kg", 1, 1);
  expect(next.settings.plates?.kg).toEqual([4, 5, 4, 4, 4, 4, 4]);
  expect(next.settings.plates?.lb).toBe(before.settings.plates?.lb);
  expect(before.settings.plates?.kg[1]).toBe(4);

  for (let i = 0; i < 30; i++) {
    next = commands.stepPlatePair(next, "kg", 1, 1);
  }

  expect(next.settings.plates?.kg[1]).toBe(20);
  expect(commands.stepPlatePair(next, "kg", 1, 1)).toBe(next);

  for (let i = 0; i < 30; i++) {
    next = commands.stepPlatePair(next, "kg", 1, -1);
  }

  expect(next.settings.plates?.kg[1]).toBe(0);
  expect(commands.stepPlatePair(next, "kg", 1, -1)).toBe(next);
  expect(commands.stepPlatePair(next, "lb", 0, -1).settings.plates?.lb).toEqual([3, 4, 4, 4, 4, 4]);
  expect(commands.stepPlatePair(next, "kg", -1, 1)).toBe(next);
  expect(commands.stepPlatePair(next, "kg", 7, 1)).toBe(next);
  const off = initialState();
  expect(commands.stepPlatePair(off, "kg", 0, 1)).toBe(off);
});
