import { test } from "@e2e-dev/mobile";
import { describe, expect } from "e2e";
import { chooseKilograms, scrollWorkoutUntilVisible, startWorkout, tap } from "./support";
import { runSequentially } from "../support/sequential";

// The matching solver test proves these totals and minimum-plate breakdowns.
describe("my plates", { serial: true }, () => {
  test("counts available pairs and explains an impossible work load", async ({ app, screen }) => {
    await app.clearState();
    await app.open();
    await chooseKilograms(screen);
    await tap(screen, screen.getByText("Settings"));
    await tap(screen, screen.getByText("Weights & equipment"));
    await screen.scrollUntilVisible(screen.getByText("Plates"));
    await tap(screen, screen.getByText("Plates"));
    await tap(screen, screen.getByText("Count my plates"));
    const remove = screen.getByLabel("Remove a pair of 1.25 kg plates");
    await screen.scrollUntilVisible(remove);

    await runSequentially([0, 1, 2, 3], async () => {
      await tap(screen, remove);
    });

    await expect(screen.getByText("0 pairs")).toBeVisible();
    // Expo UI exposes the label and the disabled control as sibling nodes, so
    // check the boundary by behaviour: another tap must not go below zero.
    await tap(screen, remove);
    await expect(screen.getByText("0 pairs")).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("Done"));
    await tap(screen, screen.getByText("Done"));
    await tap(screen, screen.getByText("Train"));
    await screen.scrollUntilVisible(screen.getByLabel("Edit Squat weight"), {
      direction: "up",
    });
    await tap(screen, screen.getByLabel("Edit Squat weight"));
    await screen.getByRole("textbox").first().fill("102.5");
    await screen.scrollUntilVisible(screen.getByText("Save weight"));
    await tap(screen, screen.getByText("Save weight"));
    await startWorkout(screen, "A", 15);
    const caption = screen.getByText("Your plates load 100 kg, not 102.5 kg.");
    await scrollWorkoutUntilVisible(screen, caption);
    await expect(caption).toBeVisible();
    await scrollWorkoutUntilVisible(screen, screen.getByLabel("Warm-up & plates for Squat"), {
      direction: "up",
    });
    await tap(screen, screen.getByLabel("Warm-up & plates for Squat"));
    await expect(screen.getByText("Bar: 20 kg", { exact: true })).toBeVisible();
    const guidance = screen.getByText("You can't load 102.5 kg with your plates.");
    await screen.scrollUntilVisible(guidance);
    await expect(guidance).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("Closest below: 100 kg"));
    await expect(screen.getByText("Closest below: 100 kg")).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("Closest above: 105 kg"));
    await tap(screen, screen.getByText("Closest above: 105 kg"));
    await screen.scrollUntilVisible(screen.getByText("105 kg total · Plates on each side"));
    await expect(screen.getByText("105 kg total · Plates on each side")).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("2 × 20 kg"));
    await expect(screen.getByText("2 × 20 kg")).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("1 × 2.5 kg"));
    await expect(screen.getByText("1 × 2.5 kg")).toBeVisible();
    await screen.scrollUntilVisible(screen.getByText("Back to workout"));
    await tap(screen, screen.getByText("Back to workout"));
    await tap(screen, screen.getByText("Settings"));
    await tap(screen, screen.getByText("Weights & equipment"));
    await screen.scrollUntilVisible(screen.getByText("Plates"));
    await tap(screen, screen.getByText("Plates"));
    await tap(screen, screen.getByText("Count my plates"));
    await screen.scrollUntilVisible(screen.getByText("Done"));
    await tap(screen, screen.getByText("Done"));
    await tap(screen, screen.getByText("Train"));
    await scrollWorkoutUntilVisible(screen, screen.getByLabel("Warm-up & plates for Squat"), {
      direction: "up",
    });
    await tap(screen, screen.getByLabel("Warm-up & plates for Squat"));
    await screen.scrollUntilVisible(screen.getByText("1 × 1.25 kg"));
    await expect(screen.getByText("1 × 1.25 kg")).toBeVisible();
    const standard = screen.getByText("Standard plates: 25, 20, 15, 10, 5, 2.5, 1.25 kg.");
    await screen.scrollUntilVisible(standard);
    await expect(standard).toBeVisible();
  });
});
