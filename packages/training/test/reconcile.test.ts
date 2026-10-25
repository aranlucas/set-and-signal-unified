import type { WorkoutSource } from "../src/records";
import { expect, it } from "vitest";
import { reconcileGarminRecording, unlinkGarminRecording } from "../src/reconcile";

interface ExampleWorkout {
  id: string;
  source: WorkoutSource;
  garminActivityIds: string[];
  reps: number[];
}

const phone: ExampleWorkout = {
  id: "phone",
  source: { provider: "fivefold" as const, id: "local", recordedUnit: "lb" as const },
  garminActivityIds: [],
  reps: [5, 4, 0],
};

const watch: ExampleWorkout = {
  id: "garmin-123",
  source: { provider: "garmin" as const, id: "123", recordedUnit: "kg" as const },
  garminActivityIds: [],
  reps: [5, 5, 5],
};

it("links a watch recording without overwriting phone performance or counting twice", () => {
  const result = reconcileGarminRecording([phone, watch], watch, "phone");
  expect(result).toHaveLength(1);
  expect(result[0].reps).toEqual([5, 4, 0]);
  expect(result[0].garminActivityIds).toEqual(["123"]);
  expect(reconcileGarminRecording(result, watch)).toBe(result);
});

it("keeps two distinct same-day source records and imports idempotently", () => {
  const result = reconcileGarminRecording([phone], watch);
  expect(result).toHaveLength(2);
  expect(reconcileGarminRecording(result, watch)).toBe(result);
});

it("moves an explicit association to one phone log and can unlink it without altering performance", () => {
  const other = { ...phone, id: "other-phone" };
  const phones: (typeof phone | typeof watch)[] = [phone, other];
  const first = reconcileGarminRecording(phones, watch, phone.id);
  const moved = reconcileGarminRecording(first, watch, other.id);
  expect(moved.filter((record) => record.garminActivityIds.includes("123"))).toHaveLength(1);
  const unlinked = unlinkGarminRecording(moved, other.id, "123");
  expect(unlinked[1].reps).toEqual(phone.reps);
  expect(unlinked[1].garminActivityIds).toEqual([]);
  expect(reconcileGarminRecording(unlinked, watch)).toHaveLength(3);
});
