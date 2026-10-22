import { expect, it } from "vitest";
import { nextCalendarRefreshAt } from "../src/domain/calendar";
import { trainingWeeks } from "../src/domain/progress";
import {
  initialState,
  startSession,
  logSet,
  finishSession,
} from "../src/domain/workout";

it("refreshes when a clock-clamped workout becomes eligible, then at local midnight", () => {
  const startedAt = +new Date(2026, 9, 22, 10, 5);
  const now = new Date(2026, 9, 22, 10, 0);
  const state = finishSession(
    logSet(startSession(initialState(), startedAt), "squat", 0, 5),
    +now,
  );
  expect(trainingWeeks(state.history, now).at(-1)!.count).toBe(0);
  const refresh = nextCalendarRefreshAt(state.history, now);
  expect(refresh).toBe(startedAt);
  expect(trainingWeeks(state.history, new Date(refresh)).at(-1)!.count).toBe(1);
  expect(nextCalendarRefreshAt(state.history, new Date(refresh))).toBe(
    +new Date(2026, 9, 23),
  );
});

it("wakes at midnight before more distant future history, without polling", () => {
  const now = new Date(2026, 9, 22, 23, 59);
  const state = finishSession(
    logSet(startSession(initialState(), +new Date(2026, 9, 24)), "squat", 0, 5),
    +new Date(2026, 9, 24, 1),
  );
  expect(nextCalendarRefreshAt(state.history, now)).toBe(
    +new Date(2026, 9, 23),
  );
  expect(nextCalendarRefreshAt([], now)).toBe(+new Date(2026, 9, 23));
});
