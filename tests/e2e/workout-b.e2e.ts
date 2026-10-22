import { test } from "@e2e-dev/mobile";
import { describe, expect } from "e2e";
import {
  finishWorkout,
  logAllSets,
  scrollWorkoutUntilVisible,
  startWorkout,
  tap,
} from "./support";

// Workout B has a different shape: overhead press instead of bench and row,
// and one deadlift set. These tests run after a complete A so the weights and
// history are the ones a real training cycle produces.
describe("workout B", { serial: true }, () => {
  test("completes workout A before starting B", async ({ app, screen }) => {
    await app.clearState();
    await app.open();

    await startWorkout(screen, "A", 15);
    await logAllSets(screen, 15);
    await finishWorkout(screen);
    await expect(screen.getByText("Start workout B")).toBeVisible();
  });

  test("completes workout B and advances the full cycle", async ({
    screen,
  }) => {
    await startWorkout(screen, "B", 11);
    await expect(screen.getByText("Workout B")).toBeVisible();
    await expect(screen.getByText("1 × 5 reps")).toBeVisible();
    const deadlift = screen.getByLabel(/^Deadlift, set 1 of 1, not logged/);
    await scrollWorkoutUntilVisible(screen, deadlift);
    await expect(deadlift).toBeVisible();

    await logAllSets(screen, 11);
    await finishWorkout(screen);
    await expect(screen.getByText("Start workout A")).toBeVisible();

    // Every lift completed all reps, so each one takes its plan's increment.
    await expect(screen.getByText("25 kg")).toBeVisible();
    await expect(screen.getByText("22.5 kg").first()).toBeVisible();
    await expect(screen.getByText("32.5 kg")).toBeVisible();
  });

  test("shows the deadlift set in workout B history", async ({
    app,
    screen,
  }) => {
    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("2 saved workouts")).toBeVisible();
    await expect(screen.getByText("Workout B")).toBeVisible();

    await tap(screen, screen.getByText("Workout B"));
    await expect(screen.getByText("Workout B")).toBeVisible();
    await expect(screen.getByText("Deadlift")).toBeVisible();
    await expect(screen.getByText("40 kg")).toBeVisible();
    await expect(screen.getByText(/1,262.5 kg volume/)).toBeVisible();
    await expect(
      screen.getByLabel(/^Deadlift, set 1 of 1, 5 of 5 reps/),
    ).toBeVisible();

    await app.back();
    await expect(screen.getByText("2 saved workouts")).toBeVisible();
  });

  test("saves an unfinished workout as skipped", async ({ screen }) => {
    await tap(screen, screen.getByText("Train"));
    await startWorkout(screen, "A", 15);
    await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
    await expect(screen.getByText("1 / 15 sets")).toBeVisible();

    await tap(screen, screen.getByText("Finish"));
    await expect(screen.getByText("Save an unfinished workout?")).toBeVisible();
    await expect(screen.getByText(/1 of 15 sets logged\./)).toBeVisible();
    await tap(screen, screen.getByText("Save workout"));

    await expect(screen.getByText("Start workout B")).toBeVisible();
    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("3 saved workouts")).toBeVisible();
    await expect(screen.getByText(/· 1\/15 sets$/).first()).toBeVisible();

    await tap(screen, screen.getByText("Workout A").first());
    await expect(
      screen.getByLabel(/^Squat, set 2 of 5, skipped/),
    ).toBeVisible();
  });

  test("keeps a skipped lift's planned weight", async ({ screen }) => {
    await tap(screen, screen.getByText("Train"));
    await expect(screen.getByText("Start workout B")).toBeVisible();
    await expect(screen.getByText("25 kg")).toBeVisible();

    await tap(screen, screen.getByText("Progress"));
    const deadlift = screen.getByText("Next 45 kg · 1×5");
    await screen.scrollUntilVisible(deadlift);
    await expect(deadlift).toBeVisible();
  });
});
