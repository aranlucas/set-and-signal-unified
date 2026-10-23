import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  initialState,
  startSession,
  logSet,
  finishSession,
  LIFTS,
  type Exercise,
  type Session,
  type Unit,
} from "../src/domain/workout";
import {
  getProgressOverview,
  liftEntries,
  liftRecord,
  trainingWeeks,
} from "../src/domain/progress";

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

function finished(
  time: number,
  exercises: Exercise[] = [],
  unit: Unit = "kg",
): Session {
  return {
    id: `session-${time}`,
    kind: "B",
    startedAt: time - 60000,
    finishedAt: time,
    exercises,
    notes: "",
    unit,
  };
}
describe("progress records", () => {
  it("includes failed and skipped sessions in chronological history without counting them as records", () => {
    const state = initialState("kg");
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
    const state = initialState("kg");
    state.history = [
      session(5, 135, "lb", 200000),
      session(5, 60, "kg", 100000),
    ];
    expect(liftRecord(state, "squat").best).toBeCloseTo(61.23497, 4);
    expect(liftEntries(state, "squat", "lb")[0].weight).toBeCloseTo(132.277, 3);
  });
  it("distinguishes an actual zero-weight completed record from no record", () => {
    const state = initialState("kg");
    expect(liftRecord(state, "squat").best).toBeNull();
    state.history = [session(5, 0, "kg", 100000)];
    expect(liftRecord(state, "squat").best).toBe(0);
    expect(liftRecord(state, "deadlift").entries).toEqual([]);
  });
});

describe("progress overview", () => {
  it("returns empty records for all five lifts", () => {
    const overview = getProgressOverview([], "kg");
    expect(Object.keys(overview)).toEqual(LIFTS);
    for (const lift of LIFTS)
      expect(overview[lift]).toEqual({
        entries: [],
        best: null,
        latest: null,
        total: 0,
      });
  });

  it("preserves misses and skips, converts mixed units, and handles both prescriptions", () => {
    const state = initialState("kg");
    state.history = [
      session(null, 100, "kg", 300000),
      finished(
        500000,
        [
          { lift: "squat", weight: 200, sets: [5, 5, 5, 5, null] },
          { lift: "press", weight: 100, sets: [5, 5, 5, 5, 4] },
          { lift: "deadlift", weight: 400, sets: [0] },
        ],
        "lb",
      ),
      session(5, 60, "kg", 100000),
      session(5, 135, "lb", 400000),
      finished(200000, [
        { lift: "squat", weight: 80, sets: [5, 5, 5, 5, 4] },
        { lift: "press", weight: 30, sets: [5, 5, 5, 5, 5] },
        { lift: "deadlift", weight: 120, sets: [5] },
      ]),
    ];

    for (const unit of ["kg", "lb"] as const) {
      const overview = getProgressOverview(state.history, unit);
      for (const lift of LIFTS) {
        const record = liftRecord(
          { ...state, settings: { ...state.settings, unit } },
          lift,
        );
        expect(overview[lift]).toEqual({
          ...record,
          total: record.entries.length,
        });
      }
    }
    const overview = getProgressOverview(state.history, "kg");
    expect(overview.squat.best).toBeCloseTo(61.23497, 4);
    expect(overview.squat.total).toBe(5);
    expect(overview.squat.entries[2].sets).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(overview.squat.latest?.sets).toEqual([5, 5, 5, 5, null]);
    expect(overview.press.best).toBe(30);
    expect(overview.deadlift.best).toBe(120);
    expect(overview.deadlift.latest?.success).toBe(false);
  });

  it("keeps only the latest ten entries from unsorted history but counts all-time records", () => {
    const chronological = Array.from({ length: 15 }, (_, index) =>
      session(
        5,
        index === 0 ? 300 : 20 + index,
        index === 0 ? "lb" : "kg",
        index * 100000,
      ),
    );
    const history = [8, 2, 14, 1, 13, 4, 0, 12, 7, 3, 11, 9, 5, 10, 6].map(
      (index) => chronological[index],
    );
    Object.freeze(history);
    const state = { ...initialState("kg"), history };
    const overview = getProgressOverview(history, "kg");
    for (const lift of LIFTS) {
      const legacy = liftRecord(state, lift);
      expect(overview[lift].entries).toEqual(legacy.entries.slice(-10));
      expect(overview[lift].latest).toBe(overview[lift].entries.at(-1) ?? null);
      expect(overview[lift].total).toBe(legacy.entries.length);
      expect(overview[lift].best).toBe(legacy.best);
    }
    expect(overview.squat.best).toBeCloseTo(136.0777, 4);
    expect(overview.squat.entries.map((entry) => entry.weight)).toEqual([
      25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    ]);
    // The legacy API still returns the complete chronological history.
    expect(liftEntries(state, "squat")).toHaveLength(15);
    expect(liftRecord(state, "squat").entries).toHaveLength(15);
  });

  it("preserves input order for equal timestamps when trimming recent entries", () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      ...finished(100000, [{ lift: "deadlift", weight: index, sets: [5] }]),
      id: String(index),
    }));
    const record = getProgressOverview(history, "kg").deadlift;
    expect(record.entries.map((entry) => entry.id)).toEqual(
      history.slice(-10).map((item) => item.id),
    );
    expect(record.latest?.id).toBe("11");
    expect(record.total).toBe(12);
  });

  it("distinguishes a completed zero-weight record from attempts without a success", () => {
    const overview = getProgressOverview(
      [
        finished(100000, [
          { lift: "squat", weight: 0, sets: [5, 5, 5, 5, 5] },
          { lift: "press", weight: 100, sets: [5, 5, 5, 5, null] },
          { lift: "deadlift", weight: 200, sets: [4] },
        ]),
      ],
      "kg",
    );
    expect(overview.squat.best).toBe(0);
    expect(overview.press.best).toBeNull();
    expect(overview.press.total).toBe(1);
    expect(overview.deadlift.best).toBeNull();
    expect(overview.deadlift.total).toBe(1);
  });

  it("retains the legacy startedAt fallback for an unfinished history entry", () => {
    const history = [{ ...session(5, 60, "kg", 100000), finishedAt: null }];
    expect(getProgressOverview(history, "kg").squat.latest?.date).toBe(100000);
  });

  it("reuses results by history identity and unit across active edits and lift selection", () => {
    let state = startSession(
      { ...initialState("kg"), history: [session(5, 60, "kg", 100000)] },
      200000,
    );
    const kg = getProgressOverview(state.history, "kg");
    const lb = getProgressOverview(state.history, "lb");
    expect(lb).not.toBe(kg);
    expect(lb.squat.best).toBeCloseTo(132.277, 3);
    state = logSet(state, "squat", 0, 5, 201000);
    for (const lift of LIFTS) {
      expect(getProgressOverview(state.history, "kg")).toBe(kg);
      expect(getProgressOverview(state.history, "kg")[lift]).toBe(kg[lift]);
      expect(getProgressOverview(state.history, "lb")).toBe(lb);
    }

    const copied = getProgressOverview([...state.history], "kg");
    expect(copied).not.toBe(kg);
    expect(copied).toEqual(kg);
    state = finishSession(state, 260000);
    const updated = getProgressOverview(state.history, "kg");
    expect(updated).not.toBe(kg);
    expect(updated.squat.total).toBe(2);
    expect(kg.squat.total).toBe(1);
    expect(updated.squat.latest?.date).toBe(260000);
  });

  it("invalidates records when a historical workout is immutably corrected", () => {
    const history = [session(5, 60, "kg", 100000)];
    const original = getProgressOverview(history, "kg");
    const corrected = history.map((item) => ({
      ...item,
      exercises: item.exercises.map((exercise) =>
        exercise.lift === "squat" ? { ...exercise, weight: 90 } : exercise,
      ),
    }));
    expect(getProgressOverview(corrected, "kg").squat.best).toBe(90);
    expect(getProgressOverview(history, "kg")).toBe(original);
    expect(original.squat.best).toBe(60);
  });
});

describe("training weeks", () => {
  beforeAll(() => vi.stubEnv("TZ", "America/Los_Angeles"));
  afterAll(() => vi.unstubAllEnvs());

  it("returns four local Monday starts in oldest-first order, including empty weeks", () => {
    expect(trainingWeeks([], new Date(2026, 9, 22, 12))).toEqual(
      [
        new Date(2026, 8, 28),
        new Date(2026, 9, 5),
        new Date(2026, 9, 12),
        new Date(2026, 9, 19),
      ].map((date) => ({ start: date.getTime(), count: 0 })),
    );
  });

  it("uses half-open weekly boundaries, excludes unfinished and future sessions, and includes now", () => {
    const now = new Date(2026, 9, 22, 12);
    const nowTime = now.getTime();
    const starts = [
      new Date(2026, 8, 28),
      new Date(2026, 9, 5),
      new Date(2026, 9, 12),
      new Date(2026, 9, 19),
    ].map((date) => date.getTime());
    const history = [
      ...starts.flatMap((start) => [finished(start - 1), finished(start)]),
      finished(nowTime),
      finished(nowTime + 1),
      finished(new Date(2026, 9, 26).getTime()),
      { ...finished(starts[2]), startedAt: starts[2], finishedAt: null },
    ].reverse();
    expect(trainingWeeks(history, now)).toEqual(
      starts.map((start) => ({ start, count: 2 })),
    );
    expect(now.getTime()).toBe(nowTime);
  });

  it("moves Sunday into the prior week exactly at Monday midnight", () => {
    const monday = new Date(2026, 9, 19).getTime();
    const history = [finished(monday), finished(monday - 1)];
    const sundayWeeks = trainingWeeks(history, new Date(monday - 1));
    expect(sundayWeeks.at(-1)).toEqual({
      start: new Date(2026, 9, 12).getTime(),
      count: 1,
    });
    const mondayWeeks = trainingWeeks(history, new Date(monday));
    expect(mondayWeeks.slice(-2)).toEqual([
      { start: new Date(2026, 9, 12).getTime(), count: 1 },
      { start: monday, count: 1 },
    ]);
  });

  it("crosses month and year boundaries using calendar weeks", () => {
    expect(
      trainingWeeks([], new Date(2027, 0, 2)).map((week) => week.start),
    ).toEqual([7, 14, 21, 28].map((day) => new Date(2026, 11, day).getTime()));
  });

  it.each([
    { label: "spring forward", month: 2, mondayDay: 9, hours: 167 },
    { label: "fall back", month: 10, mondayDay: 2, hours: 169 },
  ])(
    "keeps local midnight boundaries during $label",
    ({ month, mondayDay, hours }) => {
      const currentMonday = new Date(2026, month, mondayDay).getTime();
      const previousMonday = new Date(2026, month, mondayDay - 7).getTime();
      const weeks = trainingWeeks(
        [
          finished(previousMonday - 1),
          finished(previousMonday),
          finished(currentMonday - 1),
          finished(currentMonday),
        ],
        new Date(2026, month, mondayDay + 2, 12),
      );
      expect((currentMonday - previousMonday) / 3600000).toBe(hours);
      expect(weeks.map((week) => week.count)).toEqual([0, 1, 2, 1]);
      expect(weeks.slice(-2).map((week) => week.start)).toEqual([
        previousMonday,
        currentMonday,
      ]);
      for (const week of weeks) {
        const start = new Date(week.start);
        expect(start.getDay()).toBe(1);
        expect(start.getHours()).toBe(0);
        expect(start.getMinutes()).toBe(0);
      }
    },
  );
});
