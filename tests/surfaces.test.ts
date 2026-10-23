import { describe, expect, it } from "vitest";
import {
  nextSetLabel,
  notificationProps,
  widgetProps,
} from "../src/domain/surfaces";
import { initialState, logSet, startSession } from "../src/domain/workout";
const NOW = 1792650000000;

describe("widget and notification surfaces", () => {
  it("shows the next workout's planned loads when idle", () => {
    const props = widgetProps(initialState("kg"), new Date(NOW));
    expect(props.title).toBe("Workout A");
    expect(props.progress).toBe(-1);
    expect(props.lifts.map((l) => l.name)).toEqual([
      "Squat",
      "Bench press",
      "Barbell row",
    ]);
    expect(props.lifts[0].detail).toBe("20 kg · 5×5");
    expect(props.footer).toBe("0 / 3 workouts this week");
  });
  it("shows active progress, per-lift counts and the next set", () => {
    let s = startSession(initialState("kg"), NOW, "B");
    s = logSet(s, "squat", 0, 5, NOW);
    const props = widgetProps(s, new Date(NOW));
    expect(props.eyebrow).toBe("Workout in progress");
    expect(props.progress).toBeCloseTo(1 / 11);
    expect(props.lifts[0].detail).toBe("20 kg · 1/5");
    expect(props.lifts[2].detail).toBe("40 kg · 0/1");
    expect(props.footer).toBe("Next: Squat · Set 2/5");
  });
  it("has no notification without an active workout", () => {
    expect(notificationProps(initialState("kg"), NOW)).toBeNull();
  });
  it("includes the rest deadline only while it is in the future", () => {
    let s = startSession(initialState("kg"), NOW);
    s = logSet(s, "squat", 0, 5, NOW);
    const resting = notificationProps(s, NOW + 1000)!;
    expect(resting.title).toBe("Workout A · 1/15 sets");
    expect(resting.status).toMatch(/^Rest until .+ · Next: Squat · Set 2\/5$/);
    expect(notificationProps(s, NOW + 91_000)!.status).toBe(
      "Next: Squat · Set 2/5",
    );
  });
  it("prompts to finish once every set is logged", () => {
    let s = startSession(initialState("kg"), NOW);
    for (const e of s.active!.exercises)
      for (let i = 0; i < e.sets.length; i++) s = logSet(s, e.lift, i, 5, NOW);
    expect(nextSetLabel(s.active)).toBe("All sets logged");
    expect(notificationProps(s, NOW + 999_999)!.status).toBe(
      "All sets logged · Tap to finish",
    );
  });
});
