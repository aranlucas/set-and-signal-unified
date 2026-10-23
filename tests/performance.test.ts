import { expect, it } from "vitest";
import { getProgressOverview } from "../src/domain/progress";
import { LIFTS, ROUTINE, type Session } from "../src/domain/workout";

it("summarizes 10,000 unsorted sessions in one traversal and reuses cached results", () => {
  let sessionReads = 0;
  let exerciseReads = 0;

  const sessions = Array.from({ length: 10000 }, (_, index): Session => {
    // A coprime stride visits every timestamp once without chronological ordering.
    const order = (index * 7919) % 10000;
    const kind = order % 2 === 0 ? "A" : "B";

    const exercises = ROUTINE[kind].map((lift) => ({
      lift,
      weight: 20 + (order % 100),
      sets: Array.from({ length: lift === "deadlift" ? 1 : 5 }, () =>
        order % 3 === 0 ? null : order % 3 === 1 ? 4 : 5,
      ),
    }));

    for (const exercise of exercises) {
      Object.freeze(exercise.sets);
      Object.freeze(exercise);
    }

    Object.freeze(exercises);

    return Object.freeze({
      id: String(order),
      kind,
      startedAt: order * 100000,
      finishedAt: order * 100000 + 60000,
      unit: order % 2 === 0 ? "kg" : "lb",
      notes: "",
      get exercises() {
        exerciseReads++;

        return exercises;
      },
    });
  });

  Object.freeze(sessions);

  const history = countIndexedReads(sessions, () => sessionReads++);

  const overview = getProgressOverview(history, "kg");
  expect(sessionReads).toBe(10000);
  expect(exerciseReads).toBe(10000);

  for (const lift of LIFTS) {
    const record = overview[lift];
    expect(record.total).toBe(lift === "squat" ? 10000 : 5000);
    expect(record.entries).toHaveLength(10);
    const latest = lift === "bench" || lift === "row" ? 9998 : 9999;
    const step = lift === "squat" ? 1 : 2;
    expect(record.entries.map((entry) => entry.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => String(latest - (9 - index) * step)),
    );
    expect(record.latest).toBe(record.entries[9]);
  }

  expect(Object.values(overview).reduce((total, record) => total + record.entries.length, 0)).toBe(
    50,
  );

  for (let index = 0; index < 100; index++) {
    expect(getProgressOverview(history, "kg")).toBe(overview);
  }

  expect(sessionReads).toBe(10000);
  expect(exerciseReads).toBe(10000);

  const pounds = getProgressOverview(history, "lb");
  expect(pounds).not.toBe(overview);
  expect(sessionReads).toBe(20000);
  expect(exerciseReads).toBe(20000);
  expect(getProgressOverview(history, "lb")).toBe(pounds);
  expect(getProgressOverview(history, "kg")).toBe(overview);
  expect(sessionReads).toBe(20000);
  expect(exerciseReads).toBe(20000);
});

it("caches the weekly widget count by history identity and local Monday", async () => {
  const { weeklyCount } = await import("../src/domain/workout");
  let reads = 0;
  const monday = +new Date(2026, 9, 19);

  const session = {
    id: "week",
    kind: "A" as const,
    startedAt: monday,
    finishedAt: monday,
    exercises: [],
    notes: "",
    unit: "kg" as const,
  };

  const history = countIndexedReads([session], () => reads++);

  expect(weeklyCount(history, new Date(2026, 9, 21))).toBe(1);
  expect(reads).toBe(1);
  expect(weeklyCount(history, new Date(2026, 9, 25))).toBe(1);
  expect(reads).toBe(1);
  expect(weeklyCount(history, new Date(2026, 9, 26))).toBe(0);
  expect(reads).toBe(2);
  expect(
    weeklyCount(
      [...history, { ...session, finishedAt: +new Date(2026, 9, 26) }],
      new Date(2026, 9, 26),
    ),
  ).toBe(1);
});

function countIndexedReads<Value>(values: readonly Value[], onRead: () => void): Value[] {
  const counted = [...values];

  for (const [index, value] of values.entries()) {
    Object.defineProperty(counted, index, {
      configurable: false,
      enumerable: true,
      get() {
        onRead();

        return value;
      },
    });
  }

  return counted;
}
