import { test } from "@e2e-dev/mobile";
import { describe, expect, type Screen } from "e2e";
import { logAllSets, startWorkout, tap, chooseKilograms } from "./support";
import { runSequentially } from "../support/sequential";

async function expectTrainingWeeks(screen: Screen, saved: number) {
  const heading = screen.getByText("Training consistency");
  await screen.scrollUntilVisible(heading);
  await expect(heading).toBeVisible();

  const currentWeek = screen.getByText("This week");
  await screen.scrollUntilVisible(currentWeek);
  await expect(currentWeek).toBeVisible();
  await expect(screen.getByText(/^(Week of .+|This week)$/)).toHaveText([
    /^Week of .+$/,
    /^Week of .+$/,
    /^Week of .+$/,
    "This week",
  ]);
  // The fixture saves only in the current week: the three older rows are
  // empty, and the current week's count must be the fourth row.
  await expect(screen.getByText(/^\d+ \/ 3 workouts$/)).toHaveText([
    "0 / 3 workouts",
    "0 / 3 workouts",
    "0 / 3 workouts",
    `${saved} / 3 workouts`,
  ]);
}

// One clean fixture, one full A, and one partial B. Members deliberately
// share device state so the regression checks do not repeat workout setup.
// Run the whole file against an installed build; no model calls are needed.
describe("training insights", { serial: true }, () => {
  test("filters empty history with All, A and B", async ({ app, screen }) => {
    await app.clearState();
    await app.open();
    await chooseKilograms(screen);
    await tap(screen, screen.getByText("History"));

    await expect(screen.getByText("0 saved workouts")).toBeVisible();
    await expect(screen.getByText("No workouts yet")).toBeVisible();

    // Compose exposes the selected segment last in its accessibility tree.
    await runSequentially(["All", "A", "B"], async (label) => {
      await expect(screen.getByText(label)).toBeVisible();
    });

    await tap(screen, screen.getByText("A"));
    await expect(screen.getByText("0 workouts A")).toBeVisible();
    await expect(screen.getByText("No workouts yet")).toBeVisible();

    await tap(screen, screen.getByText("B"));
    await expect(screen.getByText("0 workouts B")).toBeVisible();
    await expect(screen.getByText("No workouts yet")).toBeVisible();
    await expect(screen.getByText("0 saved workouts")).toBeVisible();

    await tap(screen, screen.getByText("All"));
    await expect(screen.getByText("No workouts yet")).toBeVisible();
    await expect(screen.getByText("0 saved workouts")).toBeVisible();
  });

  test("explains successful increases before saving a complete A", async ({ screen }) => {
    await tap(screen, screen.getByText("Train"));
    await startWorkout(screen, "A", 15);
    await logAllSets(screen, 15);
    await tap(screen, screen.getByText("Finish"));

    await expect(screen.getByText("Finish this workout?")).toBeVisible();
    const summary = screen.getByText(/^15 of 15 sets logged\./);
    await expect(summary).toContainText("Squat → 22.5 kg");
    await expect(summary).toContainText("Bench press → 22.5 kg");
    await expect(summary).toContainText("Barbell row → 32.5 kg");
    await expect(summary).toContainText(
      /All reps completed.*All reps completed.*All reps completed/s,
    );

    await tap(screen, screen.getByText("Save workout"));
    await expect(screen.getByText("Start workout B")).toBeVisible();
    await expect(screen.getByText("22.5 kg")).toBeVisible();
  });

  test("keeps the total while filtering A, empty B and All", async ({ app, screen }) => {
    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("1 saved workout")).toBeVisible();
    await expect(screen.getByText("Workout A")).toBeVisible();

    await tap(screen, screen.getByText("A"));
    await expect(screen.getByText("1 workout A")).toBeVisible();
    await expect(screen.getByText("1 saved workout")).toBeVisible();
    await expect(screen.getByText("Workout A")).toBeVisible();

    await tap(screen, screen.getByText("B"));
    await expect(screen.getByText("0 workouts B")).toBeVisible();
    await expect(screen.getByText("1 saved workout")).toBeVisible();
    await expect(screen.getByText("No workout B yet")).toBeVisible();
    await expect(screen.getByText("Workout A")).not.toBeVisible();

    await tap(screen, screen.getByText("All"));
    await expect(screen.getByText("Workout A")).toBeVisible();
    await expect(screen.getByText("1 saved workout")).toBeVisible();
    await tap(screen, screen.getByText("Workout A"));
    await expect(screen.getByText(/1,750 kg volume/)).toBeVisible();
    await expect(screen.getByLabel(/^Squat, set 5 of 5, 5 of 5 reps/)).toBeVisible();
    await app.back();
    await expect(screen.getByText("1 saved workout")).toBeVisible();
  });

  test("counts a saved workout once and retains records and weight history", async ({ screen }) => {
    await tap(screen, screen.getByText("Progress"));
    await expectTrainingWeeks(screen, 1);

    const records = screen.getByText("Lift records");
    await screen.scrollUntilVisible(records, { direction: "up" });
    await expect(records).toBeVisible();
    const squat = screen.getByLabel("View Squat progress");
    await screen.scrollUntilVisible(squat);
    await tap(screen, squat);

    const history = screen.getByText("Weight history");
    await screen.scrollUntilVisible(history);
    await expect(history).toBeVisible();
    const best = screen.getByText("Best with every rep");
    await screen.scrollUntilVisible(best);
    await expect(best).toBeVisible();
    await expect(screen.getByText("20 kg").first()).toBeVisible();
    const completed = screen.getByLabel(/20 kg, all reps completed$/);
    await screen.scrollUntilVisible(completed);
    await expect(completed).toBeVisible();
    const sets = screen.getByText("5 / 5 / 5 / 5 / 5 reps");
    await screen.scrollUntilVisible(sets);
    await expect(sets).toBeVisible();
  });

  test("explains unlogged sets and repeats unfinished B loads", async ({ screen }) => {
    await tap(screen, screen.getByText("Train"));
    await startWorkout(screen, "B", 11);
    await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
    await expect(screen.getByText("1 / 11 sets")).toBeVisible();
    await tap(screen, screen.getByText("Finish"));

    await expect(screen.getByText("Save an unfinished workout?")).toBeVisible();
    const summary = screen.getByText(/^1 of 11 sets logged\./);
    await expect(summary).toContainText("Squat → 22.5 kg");
    await expect(summary).toContainText("Overhead press → 20 kg");
    await expect(summary).toContainText("Deadlift → 40 kg");
    await expect(summary).toContainText(
      /Unlogged sets — repeat this load.*Unlogged sets — repeat this load.*Unlogged sets — repeat this load/s,
    );

    // Opening the preview does not save or advance the active workout.
    await tap(screen, screen.getByText("Cancel"));
    await expect(screen.getByText("1 / 11 sets")).toBeVisible();
    await tap(screen, screen.getByText("Finish"));
    await tap(screen, screen.getByText("Save workout"));
    await expect(screen.getByText("Start workout A")).toBeVisible();

    await tap(screen, screen.getByText("Progress"));
    await expectTrainingWeeks(screen, 2);
    const squat = screen.getByText("Next 22.5 kg · 5×5");
    await screen.scrollUntilVisible(squat.first(), { direction: "up" });
    await expect(squat.first()).toBeVisible();
    const press = screen.getByText("Next 20 kg · 5×5");
    await screen.scrollUntilVisible(press);
    await expect(press).toBeVisible();
    const deadlift = screen.getByText("Next 40 kg · 1×5");
    await screen.scrollUntilVisible(deadlift);
    await expect(deadlift).toBeVisible();
  });

  test("persists both saved workouts and progress across a restart", async ({ app, screen }) => {
    await app.restart();
    await expect(screen.getByText("Start workout A")).toBeVisible();
    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("2 saved workouts")).toBeVisible();

    await tap(screen, screen.getByText("A"));
    await expect(screen.getByText("1 workout A")).toBeVisible();
    await expect(screen.getByText("Workout A")).toBeVisible();
    await expect(screen.getByText("Workout B")).not.toBeVisible();
    await tap(screen, screen.getByText("B"));
    await expect(screen.getByText("1 workout B")).toBeVisible();
    await expect(screen.getByText("2 saved workouts")).toBeVisible();
    await expect(screen.getByText("Workout B")).toBeVisible();
    await expect(screen.getByText("Workout A")).not.toBeVisible();

    await tap(screen, screen.getByText("Workout B"));
    await expect(screen.getByLabel(/^Squat, set 1 of 5, 5 of 5 reps/)).toBeVisible();
    await expect(screen.getByLabel(/^Squat, set 2 of 5, skipped/)).toBeVisible();
    await app.back();
    await tap(screen, screen.getByText("All"));
    await expect(screen.getByText("2 saved workouts")).toBeVisible();

    await tap(screen, screen.getByText("Progress"));
    await expectTrainingWeeks(screen, 2);
    const complete = screen.getByLabel(/20 kg, all reps completed$/);
    await screen.scrollUntilVisible(complete);
    await expect(complete).toBeVisible();
    await expect(screen.getByLabel(/22\.5 kg, incomplete reps$/)).toBeVisible();
    const skipped = screen.getByText("5 / – / – / – / – reps");
    await screen.scrollUntilVisible(skipped);
    await expect(skipped).toBeVisible();
  });
});
