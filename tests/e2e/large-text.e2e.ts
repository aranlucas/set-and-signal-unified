import { afterAll, describe, test } from "@e2e-dev/mobile";
import { expect, type Locator } from "e2e";
import {
  adb,
  chooseKilograms,
  expectWithinScreen,
  scrollWorkoutUntilVisible,
  startWorkout,
  tap,
} from "./support";
import { runSequentially } from "../support/sequential";
import { requireValue } from "../support/require-value";

interface PlateControlColumns {
  remove: number[];
  add: number[];
}

// This file owns the system setting, even if an assertion/engine action fails.
afterAll(() => {
  adb("shell", "settings", "put", "system", "font_scale", "1.0");
});

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, "Layout target must have visible bounds").not.toBeNull();

  return requireValue(box, "Layout target must have visible bounds.");
}

describe("200% text", { serial: true }, () => {
  test("keeps tab labels on one line without overlaps", async ({ app, screen }) => {
    await app.clearState();
    adb("shell", "settings", "put", "system", "font_scale", "2.0");
    await app.open();
    await chooseKilograms(screen);

    const labels = ["Train", "History", "Progress", "Settings"].map((label) =>
      screen.getByText(label),
    );

    await Promise.all(labels.map(expectWithinScreen));

    const boxes = await Promise.all(labels.map(bounds));

    for (const box of boxes) {
      expect(box.height, "Tab labels must stay a single line at 200% text").toBeLessThan(
        boxes[0].height * 1.5,
      );
    }

    for (let i = 1; i < boxes.length; i++) {
      expect(
        boxes[i - 1].x + boxes[i - 1].width,
        "Tab labels must not overlap",
      ).toBeLessThanOrEqual(boxes[i].x);
    }
  });

  test(
    "aligns plate controls through the 20-pair boundary",
    { timeout: 180_000 },
    async ({ screen }) => {
      await tap(screen, screen.getByText("Settings"));
      await tap(screen, screen.getByText("Weights & equipment"));
      await screen.scrollUntilVisible(screen.getByText("Plates"));
      await tap(screen, screen.getByText("Plates"));
      await tap(screen, screen.getByText("Count my plates"));
      const add = screen.getByLabel("Add a pair of 25 kg plates");
      const remove = screen.getByLabel("Remove a pair of 25 kg plates");
      await screen.scrollUntilVisible(add);

      await runSequentially(
        Array.from({ length: 16 }, (_, index) => index),
        async () => {
          await tap(screen, add);
        },
      );

      await expect(screen.getByText("20 pairs")).toBeVisible();
      // The labelled node may be a sibling of the disabled button: prove the
      // disabled boundary by one extra physical tap leaving the count at 20.
      await tap(screen, add);
      await expect(screen.getByText("20 pairs")).toBeVisible();

      const columns: PlateControlColumns = {
        remove: [],
        add: [],
      };

      const controls = [25, 20, 15, 10, 5, 2.5, 1.25].flatMap((size) => [
        { action: "remove" as const, label: "Remove", size },
        { action: "add" as const, label: "Add", size },
      ]);

      await runSequentially(controls, async ({ action, label, size }) => {
        const control = screen.getByLabel(`${label} a pair of ${size} kg plates`);
        await screen.scrollUntilVisible(control);
        columns[action].push((await bounds(control)).x);
      });

      for (const action of ["add", "remove"] as const) {
        const xs = columns[action];
        expect(
          Math.max(...xs) - Math.min(...xs),
          `${action} controls must share one x column (±2 px)`,
        ).toBeLessThanOrEqual(2);
      }

      await screen.scrollUntilVisible(remove, { direction: "up" });

      await runSequentially(
        Array.from({ length: 16 }, (_, index) => index),
        async () => {
          await tap(screen, remove);
        },
      );

      const small = screen.getByLabel("Remove a pair of 1.25 kg plates");
      await screen.scrollUntilVisible(small);

      await runSequentially([0, 1, 2, 3], async () => {
        await tap(screen, small);
      });

      await expect(screen.getByText("0 pairs")).toBeVisible();
      await screen.scrollUntilVisible(screen.getByText("Done"));
      await tap(screen, screen.getByText("Done"));
    },
  );

  test(
    "fits the workout warning, equal set buttons and tools guidance",
    { timeout: 150_000 },
    async ({ screen, device }) => {
      await tap(screen, screen.getByText("Train"));
      const edit = screen.getByLabel("Edit Squat weight");
      await screen.scrollUntilVisible(edit, { direction: "up" });
      await tap(screen, edit);
      await screen.getByRole("textbox").first().fill("22.5");
      await device.dismissKeyboard();
      await screen.scrollUntilVisible(screen.getByText("Save weight"));
      await tap(screen, screen.getByText("Save weight"));
      await startWorkout(screen, "A", 15);
      const warning = screen.getByText("Your plates load 20 kg, not 22.5 kg.");
      await scrollWorkoutUntilVisible(screen, warning);
      await expectWithinScreen(warning);
      const sets = screen.getByLabel(/^Squat, set [1-5] of 5, not logged/);
      const boxes = await Promise.all((await sets.all()).map(bounds));

      expect(boxes).toHaveLength(5);
      expect(
        Math.max(...boxes.map((b) => b.width)) - Math.min(...boxes.map((b) => b.width)),
        "Five set buttons must have equal widths (±2 px)",
      ).toBeLessThanOrEqual(2);

      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i - 1].x + boxes[i - 1].width).toBeLessThanOrEqual(boxes[i].x);
      }

      const tools = screen.getByLabel("Warm-up & plates for Squat");
      await scrollWorkoutUntilVisible(screen, tools, { direction: "up" });
      await tap(screen, tools);

      await runSequentially(
        [
          "Bar: 20 kg",
          "You can't load 22.5 kg with your plates.",
          "Closest below: 20 kg",
          "Closest above: 25 kg",
        ],
        async (text) => {
          const target = screen.getByText(text, { exact: true });
          await screen.scrollUntilVisible(target);
          await expectWithinScreen(target);
        },
      );

      await expect(screen.getByText(/Bar: 20 kg.*Plates on each side/)).not.toBeVisible();
    },
  );
});
