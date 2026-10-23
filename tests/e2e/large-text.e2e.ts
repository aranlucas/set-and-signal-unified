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

// This file owns the system setting, even if an assertion/engine action fails.
afterAll(() => {
  adb("shell", "settings", "put", "system", "font_scale", "1.0");
});
async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, "Layout target must have visible bounds").not.toBeNull();
  return box!;
}
describe("200% text", { serial: true }, () => {
  test("keeps tab labels on one line without overlaps", async ({
    app,
    screen,
  }) => {
    await app.clearState();
    adb("shell", "settings", "put", "system", "font_scale", "2.0");
    await app.open();
    await chooseKilograms(screen);
    const labels = ["Train", "History", "Progress", "Settings"].map((label) =>
      screen.getByText(label),
    );
    for (const label of labels) await expectWithinScreen(label);
    const boxes = await Promise.all(labels.map(bounds));
    for (const box of boxes)
      expect(
        box.height,
        "Tab labels must stay a single line at 200% text",
      ).toBeLessThan(boxes[0].height * 1.5);
    for (let i = 1; i < boxes.length; i++)
      expect(
        boxes[i - 1].x + boxes[i - 1].width,
        "Tab labels must not overlap",
      ).toBeLessThanOrEqual(boxes[i].x);
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
      for (let i = 0; i < 16; i++) await tap(screen, add);
      await expect(screen.getByText("20 pairs")).toBeVisible();
      // The labelled node may be a sibling of the disabled button: prove the
      // disabled boundary by one extra physical tap leaving the count at 20.
      await tap(screen, add);
      await expect(screen.getByText("20 pairs")).toBeVisible();
      const columns: { remove: number[]; add: number[] } = {
        remove: [],
        add: [],
      };
      for (const size of [25, 20, 15, 10, 5, 2.5, 1.25]) {
        for (const [action, label] of [
          ["remove", "Remove"],
          ["add", "Add"],
        ] as const) {
          const control = screen.getByLabel(
            `${label} a pair of ${size} kg plates`,
          );
          await screen.scrollUntilVisible(control);
          columns[action].push((await bounds(control)).x);
        }
      }
      for (const [action, xs] of Object.entries(columns))
        expect(
          Math.max(...xs) - Math.min(...xs),
          `${action} controls must share one x column (±2 px)`,
        ).toBeLessThanOrEqual(2);
      await screen.scrollUntilVisible(remove, { direction: "up" });
      for (let i = 0; i < 16; i++) await tap(screen, remove);
      const small = screen.getByLabel("Remove a pair of 1.25 kg plates");
      await screen.scrollUntilVisible(small);
      for (let i = 0; i < 4; i++) await tap(screen, small);
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
      const boxes = [];
      for (const set of await sets.all()) boxes.push(await bounds(set));
      expect(boxes).toHaveLength(5);
      expect(
        Math.max(...boxes.map((b) => b.width)) -
          Math.min(...boxes.map((b) => b.width)),
        "Five set buttons must have equal widths (±2 px)",
      ).toBeLessThanOrEqual(2);
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i - 1].x + boxes[i - 1].width).toBeLessThanOrEqual(
          boxes[i].x,
        );
      const tools = screen.getByLabel("Warm-up & plates for Squat");
      await scrollWorkoutUntilVisible(screen, tools, { direction: "up" });
      await tap(screen, tools);
      for (const text of [
        "Bar: 20 kg",
        "You can't load 22.5 kg with your plates.",
        "Closest below: 20 kg",
        "Closest above: 25 kg",
      ]) {
        const target = screen.getByText(text, { exact: true });
        await screen.scrollUntilVisible(target);
        await expectWithinScreen(target);
      }
      await expect(
        screen.getByText(/Bar: 20 kg.*Plates on each side/),
      ).not.toBeVisible();
    },
  );
});
