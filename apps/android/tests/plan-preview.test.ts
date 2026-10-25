import { describe, expect, it } from "vitest";
import { planPreview } from "../src/domain/plan-preview";
import { initialState, maxWeight, nextPlan, type Exercise } from "../src/domain/workout";

const settings = initialState("kg").settings;

const plan = { weight: 60, increment: 2.5, failures: 0 };

const completed: Exercise = {
  lift: "squat",
  weight: 60,
  sets: [5, 5, 5, 5, 5],
};

describe("next-load explanations", () => {
  it("previews the exact increased load that saving applies", () => {
    const preview = planPreview(plan, completed, settings);
    expect(preview).toEqual({
      plan: nextPlan(plan, completed, settings),
      reason: "All reps completed",
    });
    expect(preview.plan.weight).toBe(62.5);
  });

  it("explains skipped sets without counting them as a failed attempt", () => {
    const preview = planPreview(
      { ...plan, failures: 2 },
      { ...completed, sets: [5, 5, null, null, null] },
      settings,
    );

    expect(preview.reason).toBe("Unlogged sets — repeat this load");
    expect(preview.plan).toMatchObject({ weight: 60, failures: 2 });
  });

  it("distinguishes attempted zero reps from a skipped set", () => {
    const preview = planPreview(plan, { ...completed, sets: [5, 5, 5, 5, 0] }, settings);
    expect(preview.reason).toBe("Missed reps · attempt 1 of 3");
    expect(preview.plan).toMatchObject({ weight: 60, failures: 1 });
  });

  it("explains a third missed session and the actual rounded deload", () => {
    const preview = planPreview(
      { ...plan, failures: 2 },
      { ...completed, sets: [5, 5, 5, 5, 3] },
      settings,
    );

    expect(preview.reason).toBe("Deload after 3 missed sessions");
    expect(preview.plan).toMatchObject({ weight: 52.5, failures: 0 });
  });

  it("does not promise a lighter load when the bar is the minimum", () => {
    const preview = planPreview(
      { ...plan, failures: 2 },
      { ...completed, weight: 20, sets: [5, 5, 5, 5, 3] },
      settings,
    );

    expect(preview.reason).toBe("Deload limited by bar weight");
    expect(preview.plan.weight).toBe(20);
  });

  it("makes disabled automation explicit", () => {
    expect(planPreview(plan, completed, { ...settings, autoProgress: false }).reason).toBe(
      "Automatic increases are off",
    );
    expect(
      planPreview(plan, { ...completed, sets: [5, 5, 5, 5, 3] }, { ...settings, autoDeload: false })
        .reason,
    ).toBe("Missed reps · automatic deloads are off");
  });

  it("explains the load ceiling instead of promising an increase", () => {
    const preview = planPreview(plan, { ...completed, weight: maxWeight("kg") }, settings);
    expect(preview.reason).toContain("maximum planned weight reached");
    expect(preview.plan.weight).toBe(maxWeight("kg"));
  });
});
