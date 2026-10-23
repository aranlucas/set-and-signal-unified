import { describe, expect, it } from "vitest";
import {
  loadPlates,
  defaultPlateInventory,
  PLATE_SIZES,
  type PlateInventory,
} from "../src/domain/plates";
import {
  changeUnit,
  initialState,
  plateLoad,
  type Unit,
} from "../src/domain/workout";
import { parseBackup, validateState } from "../src/domain/backup";

const empty = (): PlateInventory => ({
  kg: [0, 0, 0, 0, 0, 0, 0],
  lb: [0, 0, 0, 0, 0, 0],
});
// Exhaustive combinations, independent of the dynamic program and its ticks.
function oracle(unit: Unit, counts: number[], bar: number) {
  const loads = new Map<number, number>();
  function visit(index: number, weight: number, count: number) {
    if (index === counts.length) {
      const total = bar + weight * 2;
      loads.set(total, Math.min(count, loads.get(total) ?? Infinity));
      return;
    }
    for (let n = 0; n <= counts[index]; n++)
      visit(index + 1, weight + n * PLATE_SIZES[unit][index], count + n);
  }
  visit(0, 0, 0);
  return loads;
}
describe("plate solver", () => {
  it.each(["kg", "lb"] as const)(
    "preserves every legacy %s result from 0 to 500",
    (unit) => {
      const bar = unit === "kg" ? 20 : 45;
      for (
        let target = 0;
        target <= 500;
        target += unit === "kg" ? 0.25 : 0.5
      ) {
        const { perSide, remainder, belowBar } = loadPlates(
          target,
          bar,
          unit,
          null,
        );
        expect({ perSide, remainder, belowBar }).toEqual(
          plateLoad(target, bar, unit),
        );
      }
    },
  );
  it.each(["kg", "lb"] as const)(
    "matches a brute-force %s oracle for several inventories",
    (unit) => {
      const bar = unit === "kg" ? 20 : 45;
      for (const counts of [
        PLATE_SIZES[unit].map((_, i) => i % 2),
        PLATE_SIZES[unit].map((_, i) => (i > 1 ? 1 : 0)),
        PLATE_SIZES[unit].map((_, i) => (i < 3 ? 2 : 0)),
      ]) {
        const inventory = { ...empty(), [unit]: counts };
        const loads = oracle(unit, counts, bar);
        const totals = [...loads.keys()].sort((a, b) => a - b);
        for (
          let target = 0;
          target <= totals.at(-1)! + 10;
          target += unit === "kg" ? 0.25 : 0.5
        ) {
          const result = loadPlates(target, bar, unit, inventory);
          expect(result.belowBar).toBe(target < bar);
          expect(result.exact).toBe(loads.has(target));
          expect(result.below?.loaded ?? null).toBe(
            totals.filter((total) => total <= target).at(-1) ?? null,
          );
          expect(result.above?.loaded ?? null).toBe(
            totals.find((total) => total >= target) ?? null,
          );
          for (const option of [result, result.below, result.above]) {
            if (!option) continue;
            expect(option.perSide.reduce((sum, p) => sum + p.count, 0)).toBe(
              loads.get(option.loaded),
            );
            expect(
              bar +
                option.perSide.reduce(
                  (sum, p) => sum + p.count * p.weight * 2,
                  0,
                ),
            ).toBe(option.loaded);
            for (const p of option.perSide)
              expect(p.count).toBeLessThanOrEqual(
                counts[
                  PLATE_SIZES[unit].findIndex((size) => size === p.weight)
                ],
              );
          }
        }
      }
    },
  );
  it("finds the exact minimum when greedy would strand a remainder", () => {
    const inventory = { ...empty(), kg: [1, 0, 0, 3, 0, 0, 0] };
    expect(loadPlates(80, 20, "kg", inventory)).toMatchObject({
      exact: true,
      loaded: 80,
      perSide: [{ weight: 10, count: 3 }],
    });
    // Where both 25+5 and three 10s exist, use two plates per side.
    expect(
      loadPlates(80, 20, "kg", { ...inventory, kg: [1, 0, 0, 3, 1, 0, 0] })
        .perSide,
    ).toEqual([
      { weight: 25, count: 1 },
      { weight: 5, count: 1 },
    ]);
  });
  it("loads only the bar with zero pairs and has no above option beyond capacity", () => {
    expect(loadPlates(20, 20, "kg", empty())).toMatchObject({
      exact: true,
      loaded: 20,
      perSide: [],
    });
    expect(loadPlates(100, 20, "kg", empty())).toMatchObject({
      exact: false,
      below: { loaded: 20, perSide: [] },
      above: null,
    });
    expect(loadPlates(10, 20, "kg", empty())).toMatchObject({
      belowBar: true,
      remainder: 0,
      below: null,
      above: { loaded: 20 },
    });
    expect(
      loadPlates(75, 20, "kg", { ...empty(), kg: [1, 0, 0, 0, 0, 0, 0] }),
    ).toMatchObject({ below: { loaded: 70 }, above: null });
  });
  it("handles custom bars without rounding a target into an exact load", () => {
    const inventory = defaultPlateInventory();
    expect(loadPlates(22.6, 20.1, "kg", inventory).exact).toBe(true);
    expect(loadPlates(22.5, 20.1, "kg", inventory)).toMatchObject({
      exact: false,
      below: { loaded: 20.1 },
      above: { loaded: 22.6 },
    });
  });
  it("proves the installed-app and render scenario's exact options and breakdowns", () => {
    const inventory = defaultPlateInventory();
    inventory.kg[6] = 0;
    const result = loadPlates(102.5, 20, "kg", inventory);
    expect(result.exact).toBe(false);
    expect(result.below).toEqual({
      loaded: 100,
      perSide: [{ weight: 20, count: 2 }],
    });
    expect(result.above).toEqual({
      loaded: 105,
      perSide: [
        { weight: 20, count: 2 },
        { weight: 2.5, count: 1 },
      ],
    });
    expect(loadPlates(102.5, 20, "kg", null)).toMatchObject({
      exact: true,
      perSide: [
        { weight: 25, count: 1 },
        { weight: 15, count: 1 },
        { weight: 1.25, count: 1 },
      ],
    });
  });
});
describe("plate data", () => {
  it("defaults to standard gym and normalises old backups without copying history", () => {
    expect(initialState().settings.plates).toBeNull();
    const current = initialState();
    const settings = { ...current.settings };
    Reflect.deleteProperty(settings, "plates");
    const old = { ...current, settings };
    const next = validateState(old);
    expect(next.settings.plates).toBeNull();
    expect(next.history).toBe(old.history);
    expect(old.settings).not.toHaveProperty("plates");
    expect(parseBackup(JSON.stringify(old))).toEqual(current);
    expect(validateState(current)).toBe(current);
  });
  it("round-trips both inventories through JSON and retains their identity on unit changes", () => {
    const state = initialState("kg");
    state.settings.plates = {
      kg: [0, 1, 2, 3, 4, 5, 20],
      lb: [20, 5, 4, 3, 2, 1],
    };
    expect(parseBackup(JSON.stringify(state))).toEqual(state);
    const converted = changeUnit(state, "lb");
    expect(converted.settings.plates).toBe(state.settings.plates);
    expect(changeUnit(converted, "kg").settings.plates).toBe(
      state.settings.plates,
    );
  });
  it.each([
    false,
    0,
    "standard",
    [],
    {},
    { kg: [], lb: [] },
    { kg: [4, 4, 4, 4, 4, 4, 4] },
    ...[-1, 21, 0.5, NaN, Infinity, "4", null, undefined].map((n) => ({
      kg: [n, 4, 4, 4, 4, 4, 4],
      lb: [4, 4, 4, 4, 4, 4],
    })),
    { kg: Array(7), lb: Array(6) },
  ])("rejects malformed inventory %j", (plates) => {
    const state = initialState();
    expect(() =>
      validateState({ ...state, settings: { ...state.settings, plates } }),
    ).toThrow();
  });
});
