import { describe, test } from "@e2e-dev/mobile";
import { expect } from "e2e";
import {
  expectAccessibleTargets,
  scrollWorkoutUntilVisible,
  startWorkout,
  tap,
} from "./support";

// Soft audit assertions collect every offender without losing the remaining
// screens; each following test navigates from the previous one's final state.
describe("accessibility targets", { serial: true }, () => {
  test(
    "audits names and 48 dp targets across every release surface",
    { timeout: 600_000 },
    async ({ app, screen }) => {
      await app.clearState();
      await app.open();
      await expect(screen.getByText("45 lb").first()).toBeVisible();
      await expectAccessibleTargets(screen, "first-run home (lb)");
      await tap(screen, screen.getByText("Settings"));
      await expectAccessibleTargets(screen, "Settings list");
      await tap(screen, screen.getByText("Weights & equipment"));
      await expectAccessibleTargets(screen, "Weights & equipment (top)");
      await screen.scrollUntilVisible(screen.getByText("Plates"));
      await tap(screen, screen.getByText("Plates"));
      await tap(screen, screen.getByText("Count my plates"));
      await expectAccessibleTargets(screen, "Plates editor enabled (top)");
      await screen.scrollUntilVisible(screen.getByText("Done"));
      await expectAccessibleTargets(screen, "Plates editor enabled (bottom)");
      await tap(screen, screen.getByText("Done"));
      for (const title of [
        "Progression",
        "Rest & focus",
        "Appearance",
        "Backup & export",
      ]) {
        await screen.scrollUntilVisible(screen.getByText(title));
        await tap(screen, screen.getByText(title));
        await expectAccessibleTargets(screen, title);
        await screen.scrollUntilVisible(screen.getByText("Done"));
        await expectAccessibleTargets(screen, `${title} (bottom)`);
        await tap(screen, screen.getByText("Done"));
      }
      await tap(screen, screen.getByText("Train"));

      const edit = screen.getByLabel("Edit Squat weight");
      await screen.scrollUntilVisible(edit, { direction: "up" });
      await tap(screen, edit);
      await expectAccessibleTargets(screen, "Squat weight sheet");
      await screen.scrollUntilVisible(screen.getByText("Save weight"));
      await tap(screen, screen.getByText("Save weight"));
      await startWorkout(screen, "A", 15);
      await expectAccessibleTargets(screen, "Active workout (top)");
      const firstSet = screen.getByLabel(/^Squat, set 1 of 5, not logged/);
      await scrollWorkoutUntilVisible(screen, firstSet);
      await tap(screen, firstSet);
      await expect(screen.getByText(/^Rest \d/)).toBeVisible();
      await expectAccessibleTargets(screen, "Rest dock after one set");
      await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, 5 of 5 reps/));
      await expectAccessibleTargets(screen, "Rep editor");
      await tap(screen, screen.getByText("5 reps", { exact: true }));
      const tools = screen.getByLabel("Warm-up & plates for Squat");
      await scrollWorkoutUntilVisible(screen, tools, { direction: "up" });
      await tap(screen, tools);
      await expectAccessibleTargets(screen, "Squat tools (top)");
      await screen.scrollUntilVisible(screen.getByText("Back to workout"));
      await expectAccessibleTargets(screen, "Squat tools (bottom)");
      await tap(screen, screen.getByText("Back to workout"));
      await tap(screen, screen.getByText("Finish"));
      await expectAccessibleTargets(screen, "Finish dialog");
      await tap(screen, screen.getByText("Save workout"));

      await tap(screen, screen.getByText("History"));
      await expect(screen.getByText("1 saved workout")).toBeVisible();
      await expectAccessibleTargets(screen, "History list");
      await tap(screen, screen.getByText("Workout A"));
      await expectAccessibleTargets(screen, "History detail");
      await app.back();
      await tap(screen, screen.getByText("Progress"));
      await expectAccessibleTargets(screen, "Progress (top)");
      await screen.scrollUntilVisible(
        screen.getByLabel("View Deadlift progress"),
      );
      await expectAccessibleTargets(screen, "Progress (bottom)");
    },
  );
});
