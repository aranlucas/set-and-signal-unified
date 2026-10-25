import { describe, expect, it } from "vitest";
import { advanceFivefold, convertLoad, type FivefoldPolicyState } from "../src/fivefold.ts";

const policy: FivefoldPolicyState = {
  unit: "lb",
  failures: 2,
  bar: 45,
  autoProgress: true,
  autoDeload: true,
};

describe("saved Fivefold policy across clients", () => {
  it.each([
    { sets: [5, 5, 5, 5, 5], weight: 140, failures: 0 },
    { sets: [5, 0, 5, 5, 5], weight: 120, failures: 0 },
    { sets: [5, null, 5, 5, 5], weight: 135, failures: 2 },
  ])("keeps pounds-based progression when the account displays kg: $sets", (example) => {
    const result = advanceFivefold(
      {
        sets: 5,
        weight: convertLoad(135, "lb", "kg"),
        inc: convertLoad(5, "lb", "kg"),
        fivefold: policy,
      },
      { id: "w1", weight: convertLoad(135, "lb", "kg"), sets: example.sets },
      "kg",
    );

    expect(convertLoad(result.weight, "kg", "lb")).toBeCloseTo(example.weight, 8);
    expect(result.fivefold.failures).toBe(example.failures);
    expect(result.fivefold.lastWorkoutId).toBe("w1");
    expect(advanceFivefold(result, { id: "w1", weight: 100, sets: [0, 0, 0, 0, 0] }, "kg")).toBe(
      result,
    );
  });

  it("uses the policy unit's default increment and respects disabled automation", () => {
    const result = advanceFivefold(
      {
        sets: 1,
        weight: convertLoad(100, "kg", "lb"),
        fivefold: { ...policy, unit: "kg" as const },
      },
      { id: "deadlift", weight: convertLoad(100, "kg", "lb"), sets: [5] },
      "lb",
    );

    expect(convertLoad(result.weight ?? 0, "lb", "kg")).toBeCloseTo(102.5);

    const held = advanceFivefold(
      {
        sets: 1,
        weight: 100,
        inc: 2.5,
        fivefold: { ...policy, unit: "kg" as const, autoDeload: false },
      },
      { id: "held", weight: 100, sets: [0] },
      "kg",
    );

    expect(held.weight).toBe(100);
    expect(held.fivefold.failures).toBe(3);
  });
});
