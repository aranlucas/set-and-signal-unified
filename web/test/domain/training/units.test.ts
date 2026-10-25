import { expect, it } from "vitest";
import { changeProfileUnit } from "@/domain/training/units";
import { applyWorkoutProgression } from "@/domain/training/progression";
import { DEFAULT_APP_STATE } from "@/domain/training/default-state";
import type { Workout } from "@/shared/lib/types";

it("converts display units without changing original watch loads or pounds-based Fivefold increments", () => {
  const state = structuredClone(DEFAULT_APP_STATE);
  state.unit = "lb";
  state.routines = [
    {
      id: "fivefold-A",
      name: "A",
      emoji: "barbell",
      prog: "fivefold",
      ex: [
        {
          id: "0043",
          sets: 1,
          reps: 5,
          weight: 135,
          inc: 5,
          fivefold: { unit: "lb", failures: 0, bar: 45, autoProgress: true, autoDeload: true },
        },
      ],
    },
  ];

  const workout: Workout = {
    id: "watch-1",
    d: "2026-10-25",
    start: 1,
    end: 2,
    name: "A",
    routineId: "fivefold-A",
    entries: [{ id: "0043", sets: [{ w: 135, r: 5, done: true, recordedWeight: 61.23496995 }] }],
    vol: 675,
    prs: [],
    source: { provider: "garmin", id: "1", recordedUnit: "kg" },
  };

  state.workouts = [workout];
  changeProfileUnit(state, "kg");
  expect(state.workouts[0]?.entries[0]?.sets[0]).toMatchObject({
    w: 61.23496995,
    recordedWeight: 61.23496995,
  });
  expect(state.routines[0]?.ex[0]?.inc).toBeCloseTo(2.26796185, 8);
  expect(state.routines[0]?.ex[0]?.fivefold?.bar).toBe(45);
  applyWorkoutProgression(state, workout);
  expect(state.routines[0]?.ex[0]?.weight).toBeCloseTo(63.5029318, 8);
  expect(state.workouts[0]?.progressionApplied).toEqual(["0043"]);
  const next = state.routines[0]?.ex[0]?.weight;
  applyWorkoutProgression(state, workout);
  expect(state.routines[0]?.ex[0]?.weight).toBe(next);
  changeProfileUnit(state, "lb");
  expect(state.routines[0]?.ex[0]?.weight).toBeCloseTo(140, 8);
  expect(state.workouts[0]?.source?.recordedUnit).toBe("kg");
});

it("preserves legacy recorded numbers as source values and keeps shared config references from converting twice", () => {
  const state = structuredClone(DEFAULT_APP_STATE);
  state.unit = "lb";
  const target = { id: "0043", sets: 5, reps: 5, weight: 135, inc: 5 };
  state.routines = [{ id: "a", name: "A", emoji: "barbell", ex: [target] }];
  state.workouts = [
    {
      id: "legacy",
      d: "2026-10-25",
      start: 1,
      end: 2,
      routineId: "a",
      name: "A",
      entries: [{ id: "0043", target, sets: [{ w: 135, r: 0, done: true }] }],
      vol: 0,
      prs: [],
    },
  ];
  state.bodyweight = [{ d: "2026-10-25", w: 180, t: 1 }];
  changeProfileUnit(state, "kg");
  expect(state.routines[0]?.ex[0]?.weight).toBeCloseTo(61.23496995, 8);
  expect(state.workouts[0]?.source).toEqual({
    provider: "set-and-signal",
    id: "legacy",
    recordedUnit: "lb",
  });
  expect(state.workouts[0]?.entries[0]?.sets[0]).toMatchObject({ r: 0, recordedWeight: 135 });
  expect(state.bodyweight[0]?.w).toBeCloseTo(81.6466266);
});
