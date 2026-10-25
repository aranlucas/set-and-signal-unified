import { expect, it } from "vitest";
import { garminRecordedWorkout, assignRecordedRoutine } from "../src/garmin-recording";

const set = {
  index: 0,
  setType: "active",
  repetitions: 0,
  weightKg: 60,
  exercises: [{ category: "squat", name: "barbellBackSquat", categoryId: 28, subtypeId: 6 }],
};

const activity = {
  activityId: "123",
  summary: {
    activityName: "Watch session",
    startTimeInSeconds: 1700000000,
    startTimeOffsetInSeconds: -25200,
    durationInSeconds: 1200,
  },
  fit: {
    availability: "available",
    sets: [
      set,
      { ...set, index: 1, setType: "rest" },
      { ...set, index: 2, repetitions: 5, weightKg: null },
    ],
  },
};

it("imports recorded active zero-rep attempts and preserves kilograms", () => {
  const preview = garminRecordedWorkout(activity, "lb");
  expect(preview.workout?.id).toBe("garmin-123");
  expect(preview.workout?.entries[0].id).toBe("0043");
  expect(preview.workout?.entries[0].sets).toHaveLength(1);
  expect(preview.workout?.entries[0].sets[0]).toMatchObject({
    done: true,
    r: 0,
    recordedWeight: 60,
  });
  expect(preview.workout?.entries[0].sets[0].w).toBeCloseTo(132.277357);
  expect(preview.warnings).toHaveLength(1);
});

it("does not create performed sets from unavailable data", () => {
  expect(
    garminRecordedWorkout({ ...activity, fit: { availability: "not_received", sets: [] } }, "kg")
      .workout,
  ).toBeNull();
  expect(
    garminRecordedWorkout({ ...activity, fit: { availability: "available", sets: [] } }, "kg")
      .workout,
  ).toBeNull();
});

it("keeps unrecognized exercises as explicit custom records", () => {
  const preview = garminRecordedWorkout(
    {
      ...activity,
      fit: {
        availability: "available",
        sets: [
          {
            ...set,
            exercises: [{ category: "other", name: "myLift", categoryId: 99, subtypeId: 3 }],
          },
        ],
      },
    },
    "kg",
  );

  expect(preview.customExercises).toEqual([{ id: "garmin-99-3", n: "my Lift", bp: "other" }]);
  expect(preview.workout?.entries[0].sets[0].r).toBe(0);
});

it("associates reviewed targets without inventing performed sets", () => {
  const recorded = garminRecordedWorkout(activity, "kg").workout;

  if (!recorded) throw new Error("Expected a recorded workout");

  const associated = assignRecordedRoutine(recorded, {
    id: "fivefold-A",
    ex: [{ id: "0043", sets: 5, reps: 5, weight: 65 }],
  });

  expect(associated.routineId).toBe("fivefold-A");
  expect(associated.entries[0].target).toMatchObject({ sets: 5, weight: 65 });
  expect(associated.entries[0].sets).toEqual(recorded.entries[0].sets);
  expect(associated.entries[0].sets).toHaveLength(1);
  expect(associated.entries[0].sets[0]).toMatchObject({ r: 0, w: 60, done: true });
});
