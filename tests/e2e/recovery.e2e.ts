import { test } from "@e2e-dev/mobile";
import { describe, expect } from "e2e";
import { discardWorkout, startWorkout, tap } from "./support";

// Recovery paths: abandoning a workout, resuming one after a process death,
// saving a partial session and removing it from history.
describe("workout recovery", { serial: true }, () => {
  test("discards an active workout without saving", async ({ app, screen }) => {
    await app.clearState();
    await app.open();
    await startWorkout(screen, "A", 15);
    await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));

    await discardWorkout(screen);
    await expect(screen.getByText("Start workout A")).toBeVisible();

    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("0 saved workouts")).toBeVisible();
    await expect(screen.getByText("No workouts yet")).toBeVisible();
  });

  test("resumes an active workout after a restart", async ({ app, screen }) => {
    await tap(screen, screen.getByText("Train"));
    await startWorkout(screen, "A", 15);
    await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
    await tap(screen, screen.getByLabel(/^Squat, set 2 of 5, not logged/));
    await expect(screen.getByText("2 / 15 sets")).toBeVisible();

    await app.restart();
    await expect(screen.getByText("Workout A")).toBeVisible();
    await expect(screen.getByText("2 / 15 sets")).toBeVisible();
    await expect(
      screen.getByLabel(/^Squat, set 2 of 5, 5 of 5 reps/),
    ).toBeVisible();

    await discardWorkout(screen);
    await expect(screen.getByText("Start workout A")).toBeVisible();
  });

  test("switches the next workout between A and B", async ({ screen }) => {
    await tap(screen, screen.getByText("Switch A / B"));
    await expect(screen.getByText("Workout B")).toBeVisible();
    await expect(screen.getByText("Start workout B")).toBeVisible();

    await tap(screen, screen.getByText("Switch A / B"));
    await expect(screen.getByText("Workout A")).toBeVisible();
    await expect(screen.getByText("Start workout A")).toBeVisible();
  });

  test("saves a partial workout", async ({ screen }) => {
    await startWorkout(screen, "A", 15);
    await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
    await tap(screen, screen.getByText("Finish"));
    await expect(screen.getByText("Save an unfinished workout?")).toBeVisible();
    await tap(screen, screen.getByText("Save workout"));

    await expect(screen.getByText("Start workout B")).toBeVisible();
    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("1 saved workouts")).toBeVisible();
    await expect(screen.getByText("Workout A")).toBeVisible();
  });

  test("keeps the saved workout across a restart", async ({ app, screen }) => {
    await app.restart();
    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("1 saved workouts")).toBeVisible();

    await tap(screen, screen.getByText("Workout A"));
    await expect(
      screen.getByLabel(/^Squat, set 2 of 5, skipped/),
    ).toBeVisible();
    const skippedHint = screen.getByText(/– means skipped/);
    await screen.scrollUntilVisible(skippedHint);
    await expect(skippedHint).toBeVisible();
  });

  test("deletes the workout from history", async ({ screen }) => {
    const remove = screen.getByText("Delete workout");
    await screen.scrollUntilVisible(remove);
    await tap(screen, remove);
    await expect(screen.getByText("Delete this workout?")).toBeVisible();
    await tap(screen, screen.getByText("Delete workout").last());

    await expect(screen.getByText("0 saved workouts")).toBeVisible();
    await tap(screen, screen.getByText("Train"));
    await expect(screen.getByText("Start workout B")).toBeVisible();
  });
});
