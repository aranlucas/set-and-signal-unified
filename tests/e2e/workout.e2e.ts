import { test } from "@e2e-dev/mobile";
import { describe, expect } from "e2e";
import {
  finishWorkout,
  logAllSets,
  startWorkout,
  tap,
} from "./support";

// One installed-app run of workout A. The suite drives whatever release APK
// is installed under app.fivefold.lifts, so it covers the Compose controls
// that Vitest cannot reach. It starts from a clean install and owns the data
// it creates.
describe("workout A", { serial: true }, () => {
  test("starts from a clean install", async ({ app, screen }) => {
    await app.clearState();
    await app.open();

    await expect(screen.getByText("Fivefold")).toBeVisible();
    await expect(screen.getByText("Start workout A")).toBeVisible();
    await startWorkout(screen, "A", 15);
    await expect(screen.getByText("Workout A")).toBeVisible();
  });

  test("runs the rest timer and undoes a set", async ({ screen }) => {
    await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
    await expect(screen.getByText("1 / 15 sets")).toBeVisible();
    await expect(
      screen.getByLabel(/^Squat, set 1 of 5, 5 of 5 reps/),
    ).toBeVisible();

    await expect(screen.getByText("Squat · Set 2/5")).toBeVisible();
    await expect(screen.getByText(/^Rest 1:(2\d|30)$/)).toBeVisible();

    await tap(screen, screen.getByText("+30s"));
    await expect(screen.getByText(/^Rest (1:5\d|2:0\d)$/)).toBeVisible();

    await tap(screen, screen.getByText("Skip"));
    await expect(screen.getByText(/^Rest /)).not.toBeVisible();

    await tap(screen, screen.getByText("Undo"));
    await expect(screen.getByText("0 / 15 sets")).toBeVisible();
    await expect(
      screen.getByLabel(/^Squat, set 1 of 5, not logged/),
    ).toBeVisible();
  });

  test("keeps a logged set across a restart", async ({ app, screen }) => {
    await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
    await expect(screen.getByText("1 / 15 sets")).toBeVisible();

    await app.restart();
    await expect(screen.getByText("Workout A")).toBeVisible();
    await expect(screen.getByText("1 / 15 sets")).toBeVisible();
    await expect(
      screen.getByLabel(/^Squat, set 1 of 5, 5 of 5 reps/),
    ).toBeVisible();
  });

  test("corrects reps, records zero and clears a set", async ({ screen }) => {
    const set = () => screen.getByLabel(/^Squat, set 1 of 5/).first();
    await tap(screen, set());
    await expect(
      screen.getByText("Currently: 5 reps. Choose the correct result."),
    ).toBeVisible();

    await tap(screen, screen.getByText("3 reps"));
    await expect(
      screen.getByLabel(/^Squat, set 1 of 5, 3 of 5 reps/),
    ).toBeVisible();

    await tap(screen, set());
    await tap(screen, screen.getByText("0 reps"));
    await expect(
      screen.getByLabel(/^Squat, set 1 of 5, 0 of 5 reps/),
    ).toBeVisible();

    await tap(screen, set());
    await tap(screen, screen.getByText("Clear set"));
    await expect(
      screen.getByLabel(/^Squat, set 1 of 5, not logged/),
    ).toBeVisible();
    await expect(screen.getByText("0 / 15 sets")).toBeVisible();
  });

  test("records a note, logs every set and saves", async ({ device, screen }) => {
    const addNote = screen.getByText("Add note");
    await screen.scrollUntilVisible(addNote);
    await tap(screen, addNote);
    await screen.getByRole("textbox").fill(
      "Felt strong. Belt on from set 3.",
    );
    await device.dismissKeyboard();
    await tap(screen, screen.getByText("Hide note"));

    await logAllSets(screen, 15);
    await finishWorkout(screen);

    await expect(screen.getByText("Start workout B")).toBeVisible();
    await expect(screen.getByText("Workout B")).toBeVisible();
  });

  test("shows the workout and its note in history", async ({ app, screen }) => {
    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("1 saved workouts")).toBeVisible();
    await expect(screen.getByText("Workout A")).toBeVisible();

    await tap(screen, screen.getByText("Workout A"));
    await expect(screen.getByText("Details")).toBeVisible();
    await expect(screen.getByText("Workout A")).toBeVisible();
    await expect(screen.getByText("Squat")).toBeVisible();
    await expect(screen.getByText(/1,750 kg volume/)).toBeVisible();
    await expect(
      screen.getByText("Felt strong. Belt on from set 3."),
    ).toBeVisible();

    await app.back();
    await expect(screen.getByText("1 saved workouts")).toBeVisible();
  });

  test("shows the completed lift on progress", async ({ screen }) => {
    await tap(screen, screen.getByText("Progress"));
    await expect(screen.getByText("1 / 3 workouts this week")).toBeVisible();
    await expect(screen.getByText("1 total")).toBeVisible();
    await expect(screen.getByText("Lift records")).toBeVisible();

    await tap(screen, screen.getByText("Deadlift").last());
    const prescription = screen.getByText("Best completed prescription");
    await screen.scrollUntilVisible(prescription);
    await expect(prescription).toBeVisible();
    await expect(screen.getByText("No record yet")).toBeVisible();

    const squatRecord = screen.getByLabel("View Squat progress");
    await screen.scrollUntilVisible(squatRecord, { direction: "up" });
    await tap(screen, squatRecord);

    const chartBar = screen.getByLabel(/20 kg, all reps completed$/);
    await screen.scrollUntilVisible(chartBar);
    await expect(chartBar).toBeVisible();
    await expect(screen.getByText("5 / 5 / 5 / 5 / 5 reps")).toBeVisible();
  });

  test("advances to workout B with the next weights", async ({ screen }) => {
    await tap(screen, screen.getByText("Train"));
    await expect(screen.getByText("Workout B")).toBeVisible();
    await expect(screen.getByText("Start workout B")).toBeVisible();
    await expect(screen.getByText("22.5 kg")).toBeVisible();
    await expect(screen.getByText("40 kg")).toBeVisible();
    await expect(screen.getByText("Workout A")).toBeVisible();
    await expect(screen.getByText(/· 15 sets$/)).toBeVisible();
  });
});
