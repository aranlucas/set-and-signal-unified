import { test } from "@e2e-dev/mobile";
import { expect } from "e2e";
import { tap, chooseKilograms, startWorkout } from "./support";

test("keeps a logged set after process restart and stays out of completed history", async ({
  app,
  screen,
}) => {
  await app.clearState();
  await app.open();
  await chooseKilograms(screen);
  await startWorkout(screen, "A", 15);
  await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
  await expect(screen.getByText("1 / 15 sets")).toBeVisible();
  await app.restart();
  await expect(screen.getByText("1 / 15 sets")).toBeVisible();
  await expect(screen.getByLabel(/^Squat, set 1 of 5, 5 of 5 reps/)).toBeVisible();
  await tap(screen, screen.getByText("History"));
  await expect(screen.getByText("No workouts yet")).toBeVisible();
  await tap(screen, screen.getByText("Train"));
  await expect(screen.getByText("1 / 15 sets")).toBeVisible();
});
