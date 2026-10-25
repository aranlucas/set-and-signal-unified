import { expect, it, vi } from "vitest";
import {
  chartDate,
  clock,
  count,
  date,
  formatWeight,
  sessionDate,
  shortDate,
  weekDate,
  workoutDate,
} from "../src/domain/format";
import { initialState, startSession } from "../src/domain/workout";
import { requireValue } from "./support/require-value";

it.each([
  [0, "set", undefined, "0 sets"],
  [1, "set", undefined, "1 set"],
  [2, "set", undefined, "2 sets"],
  [0, "workout", undefined, "0 workouts"],
  [1, "workout", undefined, "1 workout"],
  [2, "workout", undefined, "2 workouts"],
  [1, "person", "people", "1 person"],
  [2, "person", "people", "2 people"],
] as const)("formats %i %s with the English count", (n, one, other, expected) => {
  expect(count(n, one, other)).toBe(expected);
});

it("matches the previous weight formatting byte for byte", () => {
  const weights = [
    ...Array.from({ length: 2001 }, (_, i) => i * 0.25),
    2.345,
    1.005,
    1e3,
    4410,
    -0,
    -12.345,
  ];

  for (const value of weights) {
    expect(formatWeight(value)).toBe(Number(value.toFixed(2)).toLocaleString());
  }
});

it("matches every previous date and time format in the default locale", () => {
  const times = [
    0,
    1,
    -86400000,
    ...Array.from(
      { length: 160 },
      (_, i) => +new Date(2025, 0, 1, i % 24, i % 60) + i * 86400000 * 7,
    ),
  ];

  for (const at of times) {
    const d = new Date(at);
    const session = requireValue(startSession(initialState(), at).active);
    expect(sessionDate(session)).toBe(
      d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
    expect(sessionDate({ ...session, finishedAt: at + 1000 })).toBe(
      new Date(at + 1000).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
    expect(workoutDate(at)).toBe(
      d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
    );
    expect(weekDate(at)).toBe(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    expect(chartDate(at)).toBe(
      d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
    );
    expect(shortDate(at)).toBe(
      d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
    expect(date(at)).toBe(d.toLocaleDateString());
    expect(clock(at)).toBe(d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
  }
});

it("constructs no Intl formatters on import and caches each on first use", async () => {
  const session = requireValue(startSession(initialState(), 0).active);
  vi.resetModules();
  const numbers = vi.spyOn(Intl, "NumberFormat");
  const dates = vi.spyOn(Intl, "DateTimeFormat");

  try {
    const format = await import("../src/domain/format");
    expect(numbers).not.toHaveBeenCalled();
    expect(dates).not.toHaveBeenCalled();

    format.formatWeight(20);
    format.formatWeight(22.5);
    expect(numbers).toHaveBeenCalledTimes(1);
    expect(dates).not.toHaveBeenCalled();

    const dateFormats = [
      () => format.sessionDate(session),
      () => format.workoutDate(0),
      () => format.weekDate(0),
      () => format.chartDate(0),
      () => format.shortDate(0),
      () => format.date(0),
      () => format.clock(0),
    ];

    for (const [index, call] of dateFormats.entries()) {
      call();
      call();
      expect(dates).toHaveBeenCalledTimes(index + 1);
    }

    // Earlier formatters must stay cached after the others have been used.
    format.formatWeight(25);

    for (const call of dateFormats) {
      call();
    }

    expect(numbers).toHaveBeenCalledTimes(1);
    expect(dates).toHaveBeenCalledTimes(7);
  } finally {
    vi.restoreAllMocks();
  }
});
