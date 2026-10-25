import { test } from "@e2e-dev/mobile";
import packageInfo from "../../package.json";
import { describe, expect } from "e2e";
import { chooseKilograms, discardWorkout, startWorkout, tap } from "./support";

// Settings is the surface the database domain tests cannot see: native
// switches, segmented controls, numeric text fields and bottom sheets.
describe("settings", { serial: true }, () => {
  test("lists the groups and their current values", async ({ app, screen }) => {
    await app.clearState();
    await app.open();
    // New installs default to pounds; the rest of this suite uses kilograms.
    await expect(screen.getByText("45 lb").first()).toBeVisible();
    await chooseKilograms(screen);
    await tap(screen, screen.getByText("Settings"));

    await expect(screen.getByText("Weights & equipment")).toBeVisible();
    await expect(screen.getByText("Progression")).toBeVisible();
    await expect(screen.getByText("Rest & focus")).toBeVisible();
    await expect(screen.getByText("Appearance")).toBeVisible();
    await expect(screen.getByText("Backup & export")).toBeVisible();
    await expect(screen.getByText("kg")).toBeVisible();
    await expect(screen.getByText("On")).toBeVisible();
    await expect(screen.getByText("1:30 / 3:00")).toBeVisible();
    await expect(screen.getByText("System")).toBeVisible();
    await expect(screen.getByText("0 workouts")).toBeVisible();

    const version = screen.getByText(`Fivefold ${packageInfo.version}`);
    await screen.scrollUntilVisible(version);
    await expect(version).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("Weights & equipment"), {
      direction: "up",
    });
  });

  test("converts planned weights between units", async ({ screen }) => {
    await tap(screen, screen.getByText("Weights & equipment"));
    await expect(screen.getByText("Kilograms")).toBeVisible();
    await expect(screen.getByText("Pounds")).toBeVisible();
    await expect(screen.getByText("20 kg").first()).toBeVisible();
    await expect(screen.getByText("Increase 2.5 kg").first()).toBeVisible();

    await tap(screen, screen.getByText("Pounds"));
    await expect(screen.getByText("45 lb").first()).toBeVisible();
    await expect(screen.getByText("65 lb")).toBeVisible();
    // The Plates row pushes Deadlift below the fold on compact phones.
    await screen.scrollUntilVisible(screen.getByText("90 lb"));
    await expect(screen.getByText("90 lb")).toBeVisible();
    await expect(screen.getByText("Increase 5 lb").first()).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("Done"));
    await tap(screen, screen.getByText("Done"));
    await expect(screen.getByText("lb")).toBeVisible();

    await tap(screen, screen.getByText("Weights & equipment"));
    await tap(screen, screen.getByText("Kilograms"));
    await screen.scrollUntilVisible(screen.getByText("Done"));
    await tap(screen, screen.getByText("Done"));
    await expect(screen.getByText("kg")).toBeVisible();
  });

  test("edits a planned weight with the numeric field", async ({ screen }) => {
    await tap(screen, screen.getByText("Train"));
    await tap(screen, screen.getByLabel("Edit Squat weight"));
    await expect(screen.getByText("Total weight, including bar")).toBeVisible();
    await screen.getByRole("textbox").first().fill("60");
    await tap(screen, screen.getByText("Save weight"));
    await expect(screen.getByText("60 kg")).toBeVisible();
  });

  test("shows warm-ups and plates for the planned weight", async ({ screen }) => {
    await startWorkout(screen, "A", 15);
    await tap(screen, screen.getByLabel("Warm-up & plates for Squat"));
    await expect(screen.getByText("Squat · Warm-up & plates")).toBeVisible();
    await expect(
      screen.getByText(/2 × 5 at 20 kg.*1 × 5 at 30 kg.*1 × 3 at 40 kg.*1 × 1 at 52\.5 kg/),
    ).toBeVisible();
    await expect(screen.getByText("1 × 20 kg")).toBeVisible();
    await expect(screen.getByText("Bar: 20 kg · Plates on each side")).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("Back to workout"));
    await tap(screen, screen.getByText("Back to workout"));
    await discardWorkout(screen);
  });

  test("toggles automatic progression and deloads", async ({ screen }) => {
    await tap(screen, screen.getByText("Settings"));
    await tap(screen, screen.getByText("Progression"));
    await expect(screen.getByText("Automatic increases")).toBeVisible();
    await expect(screen.getByText("Deload after 3 misses")).toBeVisible();

    await tap(screen, screen.getByText("Automatic increases"));
    await tap(screen, screen.getByText("Deload after 3 misses"));
    await tap(screen, screen.getByText("Done"));
    await expect(screen.getByText("Manual")).toBeVisible();

    await tap(screen, screen.getByText("Progression"));
    await tap(screen, screen.getByText("Automatic increases"));
    await tap(screen, screen.getByText("Deload after 3 misses"));
    await tap(screen, screen.getByText("Done"));
    await expect(screen.getByText("On")).toBeVisible();
  });

  test("switches the appearance and back to system", async ({ screen }) => {
    await tap(screen, screen.getByText("Appearance"));
    await tap(screen, screen.getByText("Dark"));
    await tap(screen, screen.getByText("Done"));
    await expect(screen.getByText("Dark")).toBeVisible();

    await tap(screen, screen.getByText("Appearance"));
    await tap(screen, screen.getByText("System"));
    await tap(screen, screen.getByText("Done"));
    await expect(screen.getByText("System")).toBeVisible();
  });

  test("changes rest lengths and workout toggles", async ({ screen }) => {
    await tap(screen, screen.getByText("Rest & focus"));
    await expect(screen.getByText("After a successful set")).toBeVisible();
    await expect(screen.getByText("After a missed rep")).toBeVisible();
    await expect(screen.getByText("Workout notifications")).toBeVisible();
    await expect(screen.getByText("Haptic feedback")).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("Keep screen awake"));
    await expect(screen.getByText("Keep screen awake")).toBeVisible();

    await screen.scrollUntilVisible(screen.getByText("After a successful set"), {
      direction: "up",
    });
    await tap(screen, screen.getByText("5:00").first());
    await screen.scrollUntilVisible(screen.getByText("Done"));
    await tap(screen, screen.getByText("Done"));
    await expect(screen.getByText("5:00 / 3:00")).toBeVisible();

    await tap(screen, screen.getByText("Rest & focus"));
    await tap(screen, screen.getByText("10:00"));
    await screen.scrollUntilVisible(screen.getByText("Haptic feedback"));
    await tap(screen, screen.getByText("Haptic feedback"));
    await screen.scrollUntilVisible(screen.getByText("Keep screen awake"));
    await tap(screen, screen.getByText("Keep screen awake"));
    await screen.scrollUntilVisible(screen.getByText("Done"));
    await tap(screen, screen.getByText("Done"));
    await expect(screen.getByText("5:00 / 10:00")).toBeVisible();
  });

  test("offers the backup and export actions", async ({ screen }) => {
    await tap(screen, screen.getByText("Backup & export"));
    await expect(screen.getByText(/Backups include everything/)).toBeVisible();
    await expect(screen.getByText("Export backup")).toBeVisible();
    await expect(screen.getByText("Restore backup")).toBeVisible();
    await expect(screen.getByText("Export CSV")).toBeVisible();
    await expect(screen.getByText("Share backup")).toBeVisible();

    const done = screen.getByText("Done");
    await screen.scrollUntilVisible(done);
    await tap(screen, done);
  });
});
