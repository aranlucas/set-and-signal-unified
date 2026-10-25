import { describe, expect, it } from "vitest";
import { fivefoldWorkout } from "../src/records.ts";
import { garminStrengthWorkout } from "../src/garmin.ts";
import { nextPlan, type Session } from "../src/fivefold.ts";

describe("shared training", () => {
  it("preserves attempted zero, skipped sets, original pounds, and source identity", () => {
    const session: Session = {
      id: "session-1",
      kind: "A",
      startedAt: 1700000000000,
      finishedAt: 1700000100000,
      unit: "lb",
      notes: "Kept honest",
      exercises: [{ lift: "squat", weight: 135, sets: [5, 0, null, 4, 5] }],
    };

    const record = fivefoldWorkout(session, "kg");
    expect(record.source).toEqual({ provider: "fivefold", id: "session-1", recordedUnit: "lb" });
    expect(record.entries[0].sets[1]).toMatchObject({ done: true, r: 0, recordedWeight: 135 });
    expect(record.entries[0].sets[2]).toMatchObject({ done: false, r: 0 });
    expect(record.entries[0].sets[0].w).toBeCloseTo(61.23496995);
    expect(record.vol).toBeCloseTo(61.23496995 * 14);
  });
  it("holds partially skipped lifts and deloads only the third fully attempted miss", () => {
    const settings = { unit: "kg" as const, bar: 20, autoProgress: true, autoDeload: true };
    const plan = { weight: 100, failures: 2, increment: 2.5 };
    expect(
      nextPlan(plan, { lift: "squat", weight: 100, sets: [5, null, 4, 5, 5] }, settings),
    ).toEqual(plan);
    expect(nextPlan(plan, { lift: "squat", weight: 100, sets: [5, 4, 4, 5, 5] }, settings)).toEqual(
      { ...plan, weight: 90, failures: 0 },
    );
  });
  it("prepares watch sets in kg with numbered steps and no trailing rest", () => {
    const prepared = garminStrengthWorkout({
      name: "A",
      unit: "lb",
      restSeconds: 90,
      exercises: [{ id: "0043", name: "Squat", sets: 5, reps: 5, weight: 135 }],
    });

    expect(prepared.unmapped).toEqual([]);
    expect(prepared.workout.segments[0].steps).toHaveLength(9);
    expect(prepared.workout.segments[0].steps[0]).toMatchObject({
      durationValue: 5,
      weightValue: 61.23496995,
      exerciseCategory: "SQUAT",
      weightDisplayUnit: "POUND",
    });
    expect(prepared.workout.segments[0].steps.at(-1)?.intensity).toBe("ACTIVE");
  });
  it("reports unsupported exercise labels and rejects overly long sessions", () => {
    const plan = {
      name: "Custom",
      unit: "kg" as const,
      restSeconds: 60,
      exercises: [{ id: "custom", name: "My lift", sets: 2, reps: 8, weight: 20 }],
    };

    expect(garminStrengthWorkout(plan).unmapped).toEqual(["My lift"]);
    expect(() =>
      garminStrengthWorkout({
        ...plan,
        exercises: [...plan.exercises, { ...plan.exercises[0], sets: 50 }],
      }),
    ).toThrow(/100-step/);
  });
});
