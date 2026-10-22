import { describe, expect, it } from "vitest";
import {
  initialState,
  startSession,
  logSet,
  finishSession,
} from "../src/domain/workout";
import { liftEntries, liftRecord } from "../src/domain/progress";

function session(
  reps: number | null,
  weight: number,
  unit: "kg" | "lb",
  time: number,
) {
  let state = startSession(initialState(unit), time);
  state.active!.exercises[0].weight = weight;
  for (let i = 0; i < 5; i++) state = logSet(state, "squat", i, reps, time);
  // A skipped session still needs another logged lift to finish.
  state = logSet(state, "bench", 0, 5, time);
  return finishSession(state, time + 60000).history[0];
}
describe("progress records", () => {
  it("includes failed and skipped sessions in chronological history without counting them as records", () => {
    const state = initialState();
    state.history = [
      session(null, 100, "kg", 300000),
      session(3, 80, "kg", 200000),
      session(5, 60, "kg", 100000),
    ];
    const record = liftRecord(state, "squat");
    expect(record.entries.map((e) => e.weight)).toEqual([60, 80, 100]);
    expect(record.best).toBe(60);
    expect(record.latest?.success).toBe(false);
    expect(record.latest?.sets).toEqual([null, null, null, null, null]);
  });
  it("converts historical units before comparing records", () => {
    const state = initialState();
    state.history = [
      session(5, 135, "lb", 200000),
      session(5, 60, "kg", 100000),
    ];
    expect(liftRecord(state, "squat").best).toBeCloseTo(61.23497, 4);
    expect(liftEntries(state, "squat", "lb")[0].weight).toBeCloseTo(132.277, 3);
  });
  it("distinguishes an actual zero-weight completed record from no record", () => {
    const state = initialState();
    expect(liftRecord(state, "squat").best).toBeNull();
    state.history = [session(5, 0, "kg", 100000)];
    expect(liftRecord(state, "squat").best).toBe(0);
    expect(liftRecord(state, "deadlift").entries).toEqual([]);
  });
});
