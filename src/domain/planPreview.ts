import {
  nextPlan,
  type Exercise,
  type LiftPlan,
  type Settings,
} from "./workout";

/** Explain the exact plan that saving will apply; never calculate a second load. */
export function planPreview(
  previous: LiftPlan,
  exercise: Exercise,
  settings: Settings,
) {
  const plan = nextPlan(previous, exercise, settings);
  let reason: string;
  if (exercise.sets.every((reps) => reps === 5)) {
    reason = !settings.autoProgress
      ? "Automatic increases are off"
      : plan.weight > exercise.weight
        ? "All reps completed"
        : "All reps completed · maximum planned weight reached";
  } else if (exercise.sets.some((reps) => reps === null)) {
    reason = "Unlogged sets — repeat this load";
  } else if (!settings.autoDeload) {
    reason = "Missed reps · automatic deloads are off";
  } else if (previous.failures >= 2) {
    reason =
      plan.weight >= exercise.weight
        ? "Deload limited by bar weight"
        : "Deload after 3 missed sessions";
  } else {
    reason = `Missed reps · attempt ${plan.failures} of 3`;
  }
  return { plan, reason };
}
