import { describe, expect, it } from "vitest";
import {
  changeUnit,
  convertWeight,
  finishSession,
  initialState,
  LIFTS,
  loggedSets,
  logSet,
  nextPlan,
  plateLoad,
  startSession,
  totalSets,
  volume,
  warmups,
  weeklyCount,
  type AppState,
} from "../src/domain/workout";
import { parseBackup, validateState } from "../src/domain/backup";
const NOW = 1792650000000;
function completed(kind: "A" | "B" = "A") {
  let s = startSession(initialState("kg"), NOW, kind);
  for (const e of s.active!.exercises)
    for (let i = 0; i < e.sets.length; i++)
      s = logSet(s, e.lift, i, 5, NOW + 1000);
  return s;
}
describe("new installs", () => {
  it("default to pounds with standard bar, loads and increments", () => {
    const s = initialState();
    expect(s.settings.unit).toBe("lb");
    expect(s.settings.bar).toBe(45);
    expect(
      Object.fromEntries(LIFTS.map((l) => [l, s.plans[l].weight])),
    ).toEqual({ squat: 45, bench: 45, row: 65, press: 45, deadlift: 90 });
    expect(
      Object.fromEntries(LIFTS.map((l) => [l, s.plans[l].increment])),
    ).toEqual({ squat: 5, bench: 5, row: 5, press: 5, deadlift: 10 });
  });
  it("switch to the kilogram defaults when kg is chosen before lifting", () => {
    expect(changeUnit(initialState(), "kg")).toEqual(initialState("kg"));
  });
});
describe("workout lifecycle", () => {
  it("starts A with three lifts and 15 unlogged work sets", () => {
    const s = startSession(initialState("kg"), NOW);
    expect(s.active!.exercises.map((e) => e.lift)).toEqual([
      "squat",
      "bench",
      "row",
    ]);
    expect(totalSets(s.active!)).toBe(15);
    expect(loggedSets(s.active!)).toBe(0);
  });
  it("B prescribes deadlift 1×5 and 11 total sets", () => {
    const s = startSession(initialState("kg"), NOW, "B");
    expect(s.active!.exercises[2].sets).toEqual([null]);
    expect(totalSets(s.active!)).toBe(11);
  });
  it("does not replace an active workout", () => {
    const s = completed();
    expect(startSession(s, NOW + 5000, "B")).toBe(s);
  });
  it("cannot finish an empty workout", () => {
    const s = startSession(initialState("kg"), NOW);
    expect(finishSession(s, NOW + 10000)).toBe(s);
  });
  it("finishes atomically, advances A/B, and progresses only once", () => {
    const s = finishSession(completed(), NOW + 20000);
    expect(s.history).toHaveLength(1);
    expect(s.next).toBe("B");
    expect(s.plans.squat.weight).toBe(22.5);
    expect(s.active).toBeNull();
    expect(s.rest).toBeNull();
    expect(finishSession(s, NOW + 30000)).toBe(s);
  });
  it.each([NOW - 60000, 0, -1, NaN, Infinity, -Infinity])(
    "keeps a finished workout restorable when the clock reads %s",
    (now) => {
      const s = finishSession(completed(), now);
      expect(s.history[0].finishedAt).toBe(NOW);
      expect(parseBackup(JSON.stringify(s))).toEqual(s);
    },
  );
  it("clamps a finish time outside the supported date range", () => {
    const s = finishSession(completed(), Number.MAX_VALUE);
    expect(s.history[0].finishedAt).toBe(8.64e15);
    expect(parseBackup(JSON.stringify(s))).toEqual(s);
  });
  it("alternates B back to A and gives deadlift its larger increment", () => {
    const s = finishSession(completed("B"), NOW + 20000);
    expect(s.next).toBe("A");
    expect(s.plans.deadlift.weight).toBe(45);
    expect(s.plans.bench.weight).toBe(20);
  });
  it("keeps the actual lifted weight in history", () => {
    const s = finishSession(completed(), NOW + 20000);
    expect(s.history[0].exercises[0].weight).toBe(20);
    expect(s.plans.squat.weight).toBe(22.5);
  });
  it("counts attempted zero separately from unlogged", () => {
    let s = startSession(initialState("kg"), NOW);
    s = logSet(s, "squat", 0, 0, NOW);
    expect(loggedSets(s.active!)).toBe(1);
    expect(volume(s.active!)).toBe(0);
  });
  it("keeps notes and the original unit in history", () => {
    const s = completed();
    s.active!.notes = "Good day";
    expect(finishSession(s, NOW + 20000).history[0]).toMatchObject({
      notes: "Good day",
      unit: "kg",
    });
  });
  it("preserves other lift counters when a set changes", () => {
    const s = logSet(startSession(initialState("kg"), NOW), "squat", 2, 4, NOW);
    expect(s.active!.exercises[0].sets).toEqual([null, null, 4, null, null]);
    expect(s.active!.exercises[1].sets).toEqual([null, null, null, null, null]);
  });
  it.each([-1, 5, 0.5])("ignores invalid set index %s", (i) => {
    const s = startSession(initialState("kg"), NOW);
    expect(logSet(s, "squat", i, 5, NOW)).toBe(s);
  });
  it.each([-1, 6, 2.2, NaN])("ignores invalid rep count %s", (reps) => {
    const s = startSession(initialState("kg"), NOW);
    expect(logSet(s, "squat", 0, reps, NOW)).toBe(s);
  });
  it("calculates completed volume from reps and weight", () => {
    expect(volume(completed().active!)).toBe((20 + 20 + 30) * 25);
  });
});
describe("progression and deloads", () => {
  const settings = initialState("kg").settings;
  const plan = { weight: 100, increment: 2.5, failures: 0 };
  it("adds one increment and clears failures on success", () => {
    expect(
      nextPlan(
        { ...plan, failures: 2 },
        { lift: "squat", weight: 100, sets: [5, 5, 5, 5, 5] },
        settings,
      ),
    ).toEqual({ ...plan, weight: 102.5 });
  });
  it("repeats the same weight after a miss", () => {
    expect(
      nextPlan(
        plan,
        { lift: "squat", weight: 100, sets: [5, 5, 5, 5, 4] },
        settings,
      ),
    ).toEqual({ ...plan, failures: 1 });
  });
  it("deloads 10% on the third completed miss", () => {
    expect(
      nextPlan(
        { ...plan, failures: 2 },
        { lift: "squat", weight: 100, sets: [5, 5, 5, 5, 0] },
        settings,
      ),
    ).toEqual({ ...plan, weight: 90 });
  });
  it("rounds deload down to a loadable increment", () => {
    expect(
      nextPlan(
        { ...plan, failures: 2 },
        { lift: "squat", weight: 97.5, sets: [4, 4, 4, 4, 4] },
        settings,
      ).weight,
    ).toBe(87.5);
  });
  it("never deloads below bar weight", () => {
    expect(
      nextPlan(
        { ...plan, failures: 2 },
        { lift: "squat", weight: 20, sets: [0, 0, 0, 0, 0] },
        settings,
      ).weight,
    ).toBe(20);
  });
  it("skipped sets neither increase weight nor count another miss", () => {
    expect(
      nextPlan(
        { ...plan, failures: 2 },
        { lift: "squat", weight: 100, sets: [5, 5, null, null, null] },
        settings,
      ),
    ).toEqual({ ...plan, failures: 2 });
  });
  it("can disable automatic increases independently", () => {
    expect(
      nextPlan(
        plan,
        { lift: "squat", weight: 100, sets: [5, 5, 5, 5, 5] },
        { ...settings, autoProgress: false },
      ).weight,
    ).toBe(100);
  });
  it("can disable automatic deloads", () => {
    expect(
      nextPlan(
        { ...plan, failures: 2 },
        { lift: "squat", weight: 100, sets: [4, 4, 4, 4, 4] },
        { ...settings, autoDeload: false },
      ),
    ).toEqual({ ...plan, failures: 3 });
  });
  it("progresses successful lifts independently of failed/skipped lifts", () => {
    let s = completed();
    s = logSet(s, "bench", 4, 3, NOW);
    s = logSet(s, "row", 4, null, NOW);
    s = finishSession(s, NOW + 20000);
    expect(s.plans.squat.weight).toBe(22.5);
    expect(s.plans.bench).toMatchObject({ weight: 20, failures: 1 });
    expect(s.plans.row).toMatchObject({ weight: 30, failures: 0 });
  });
});
describe("rest deadlines", () => {
  it("starts the normal timer on a successful set", () => {
    const s = logSet(startSession(initialState("kg"), NOW), "squat", 0, 5, NOW);
    expect(s.rest).toEqual({
      lift: "squat",
      setIndex: 0,
      duration: 90,
      endsAt: NOW + 90000,
    });
  });
  it("extends to missed-rep rest when correcting the just-logged set", () => {
    let s = logSet(startSession(initialState("kg"), NOW), "squat", 0, 5, NOW);
    s = logSet(s, "squat", 0, 4, NOW + 1000);
    expect(s.rest!.duration).toBe(180);
    expect(s.rest!.endsAt).toBe(NOW + 181000);
  });
  it("does not restart a timer repeatedly while reducing reps", () => {
    let s = logSet(startSession(initialState("kg"), NOW), "squat", 0, 4, NOW);
    const end = s.rest!.endsAt;
    s = logSet(s, "squat", 0, 3, NOW + 5000);
    expect(s.rest!.endsAt).toBe(end);
  });
  it("does not disturb the current set timer when correcting an older set", () => {
    let s = logSet(startSession(initialState("kg"), NOW), "squat", 0, 5, NOW);
    s = logSet(s, "squat", 1, 5, NOW + 1000);
    const rest = s.rest;
    s = logSet(s, "squat", 0, 3, NOW + 2000);
    expect(s.rest).toBe(rest);
  });
  it("clears the matching timer when the matching set is cleared", () => {
    let s = logSet(startSession(initialState("kg"), NOW), "squat", 0, 0, NOW);
    s = logSet(s, "squat", 0, null, NOW + 1000);
    expect(s.rest).toBeNull();
  });
  it("retains the absolute deadline in a backup/restart", () => {
    const s = logSet(startSession(initialState("kg"), NOW), "squat", 0, 5, NOW);
    expect(parseBackup(JSON.stringify(s)).rest!.endsAt).toBe(NOW + 90000);
  });
});
describe("units, plates, warmups and weekly counters", () => {
  it("starts with standard imperial weights and increments", () => {
    const s = initialState("lb");
    expect(s.settings.bar).toBe(45);
    expect(s.plans.deadlift.increment).toBe(10);
  });
  it("converts future weights but preserves historical measurements", () => {
    const s = finishSession(completed(), NOW + 20000);
    const next = changeUnit(s, "lb");
    expect(next.settings.bar).toBe(45);
    expect(next.history[0].unit).toBe("kg");
    expect(next.plans.squat.weight).toBe(50);
  });
  it("blocks unit changes during an active workout", () => {
    const s = completed();
    expect(changeUnit(s, "lb")).toBe(s);
  });
  it("keeps custom light bars valid after conversion", () => {
    const s = initialState("lb");
    s.settings.bar = 1;
    expect(changeUnit(s, "kg").settings.bar).toBeGreaterThanOrEqual(1);
  });
  it("converts weights reversibly before equipment rounding", () => {
    expect(
      convertWeight(convertWeight(100, "kg", "lb"), "lb", "kg"),
    ).toBeCloseTo(100, 7);
  });
  it.each([
    [100, 20, "kg", 40],
    [225, 45, "lb", 90],
  ] as const)(
    "loads %s with the correct weight on each side",
    (total, bar, unit, side) => {
      const p = plateLoad(total, bar, unit);
      expect(p.perSide.reduce((s, p) => s + p.weight * p.count, 0)).toBe(side);
      expect(p.remainder).toBe(0);
    },
  );
  it("handles an empty bar", () => {
    expect(plateLoad(20, 20, "kg")).toEqual({
      perSide: [],
      remainder: 0,
      belowBar: false,
    });
  });
  it("explains a target below the bar", () => {
    expect(plateLoad(15, 20, "kg").belowBar).toBe(true);
  });
  it("reports impossible small loads instead of silently rounding", () => {
    expect(plateLoad(21, 20, "kg").remainder).toBe(1);
  });
  it("keeps all warmups lighter than work weight, distinct, and loadable", () => {
    for (const unit of ["kg", "lb"] as const)
      for (let w = 25; w < 300; w += 5) {
        const bar = unit === "kg" ? 20 : 45;
        const sets = warmups(w, bar, unit);
        expect(new Set(sets.map((s) => s.weight)).size).toBe(sets.length);
        for (const s of sets) {
          expect(s.weight).toBeLessThan(w);
          expect(s.weight).toBeGreaterThanOrEqual(bar);
          expect(plateLoad(s.weight, bar, unit).remainder).toBe(0);
        }
      }
  });
  it("does not suggest warmups above an empty-bar work weight", () => {
    expect(warmups(20, 20, "kg")).toEqual([]);
  });
  it("counts only this local Monday-to-Sunday week", () => {
    const monday = new Date(2026, 9, 19, 12);
    const state = finishSession(completed(), +monday);
    const history = [
      state.history[0],
      {
        ...state.history[0],
        id: "old",
        finishedAt: +new Date(2026, 9, 18, 23),
      },
      {
        ...state.history[0],
        id: "future",
        finishedAt: +new Date(2026, 9, 26, 0),
      },
    ];
    expect(weeklyCount(history, new Date(2026, 9, 21))).toBe(1);
  });
});
describe("backup validation", () => {
  it.each(["kg", "lb"] as const)("round-trips initial %s state", (unit) => {
    const s = initialState(unit);
    expect(parseBackup(JSON.stringify(s))).toEqual(s);
  });
  it("round-trips history, notes, plans and an active workout", () => {
    let s = finishSession(completed(), NOW + 20000);
    s = startSession(s, NOW + 30000);
    expect(parseBackup(JSON.stringify(s))).toEqual(s);
  });
  it("validates parsed local state without copying its history", () => {
    const s = finishSession(completed(), NOW + 20000);
    expect(validateState(s)).toBe(s);
  });
  it("retains the 20,000-workout limit for external backups", () => {
    const s = finishSession(completed(), NOW + 20000);
    s.history = Array.from({ length: 20000 }, (_, i) => ({
      ...s.history[0],
      id: `workout-${i}`,
    }));
    expect(parseBackup(JSON.stringify(s)).history).toHaveLength(20000);
    s.history.push({ ...s.history[0], id: "workout-20000" });
    const text = JSON.stringify(s);
    expect(text.length).toBeLessThan(20_000_000);
    expect(validateState(s)).toBe(s);
    expect(() => parseBackup(text)).toThrow("This isn't a Fivefold backup.");
  });
  it("retains the 20 MB size limit for external backups", () => {
    const s = initialState("kg");
    const text = JSON.stringify(s).padEnd(20_000_000, " ");
    expect(parseBackup(text)).toEqual(s);
    expect(() => parseBackup(`${text} `)).toThrow("too large");
  });
  it.each(["not json", "{}", "[]", "null"])(
    "rejects an invalid backup %s",
    (s) => {
      expect(() => parseBackup(s)).toThrow();
    },
  );
  it("rejects future schema versions", () => {
    expect(() =>
      parseBackup(JSON.stringify({ ...initialState("kg"), version: 2 })),
    ).toThrow();
  });
  it.each([NaN, -1, Infinity, 2001])("rejects invalid weights %s", (w) => {
    const s = initialState("kg");
    s.plans.squat.weight = w;
    expect(() => parseBackup(JSON.stringify(s))).toThrow();
  });
  it("rejects invalid reps and duplicate workout IDs", () => {
    const s = finishSession(completed(), NOW + 20000);
    s.history[0].exercises[0].sets[0] = 6;
    expect(() => parseBackup(JSON.stringify(s))).toThrow();
    s.history[0].exercises[0].sets[0] = 5;
    s.history.push(s.history[0]);
    expect(() => parseBackup(JSON.stringify(s))).toThrow();
  });
  it("rejects an incompatible workout layout", () => {
    const s = completed();
    s.active!.exercises.reverse();
    expect(() => parseBackup(JSON.stringify(s))).toThrow();
  });
  it("rejects an active workout in different units", () => {
    const s = completed();
    s.active!.unit = "lb";
    expect(() => parseBackup(JSON.stringify(s))).toThrow();
  });
  it("validates the result of a full training cycle", () => {
    let s: AppState = initialState("kg");
    for (let n = 0; n < 30; n++) {
      s = startSession(s, NOW + n * 86400000);
      for (const e of s.active!.exercises)
        for (let i = 0; i < e.sets.length; i++)
          s = logSet(
            s,
            e.lift,
            i,
            n % 5 === 0 ? 4 : 5,
            NOW + n * 86400000 + 1000,
          );
      s = finishSession(s, NOW + n * 86400000 + 2000);
      expect(() => parseBackup(JSON.stringify(s))).not.toThrow();
    }
    expect(s.history).toHaveLength(30);
    expect(s.next).toBe("A");
    expect(LIFTS.every((l) => s.plans[l].weight >= 20)).toBe(true);
  });
});

describe("state remains restorable at input limits", () => {
  it("keeps a maximum-weight success inside the backup schema", () => {
    const settings = initialState("kg").settings;
    const next = nextPlan(
      { weight: 2000, increment: 50, failures: 0 },
      { lift: "squat", weight: 2000, sets: [5, 5, 5, 5, 5] },
      settings,
    );
    const s = initialState("kg");
    s.plans.squat = next;
    expect(() => parseBackup(JSON.stringify(s))).not.toThrow();
  });
  it.each(["kg", "lb"] as const)(
    "keeps extreme %s inputs valid after unit conversion",
    (unit) => {
      const s = initialState(unit);
      s.settings.bar = unit === "kg" ? 100 : 220.5;
      s.plans.squat.weight = unit === "kg" ? 2000 : 4410;
      expect(() =>
        parseBackup(JSON.stringify(changeUnit(s, unit === "kg" ? "lb" : "kg"))),
      ).not.toThrow();
    },
  );
  it("rejects an active ID that would overwrite a completed workout", () => {
    const s = startSession(
      finishSession(completed(), NOW + 20000),
      NOW + 30000,
    );
    s.active!.id = s.history[0].id;
    expect(() => parseBackup(JSON.stringify(s))).toThrow();
  });
});
