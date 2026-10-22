import { test } from "@e2e-dev/mobile";
import { describe, expect, type Locator, type Screen } from "e2e";

// One installed-app run of the core training loop. The suite drives whatever
// release APK is installed under app.fivefold.lifts, so it covers the Compose
// controls that Vitest cannot reach. It starts from a clean install and owns
// the data it creates.
//
// Expo UI renders each control's label and its clickable region as two nodes,
// and a tap on the label is refused because the touch point belongs to the
// sibling button. Tapping the centre of the label reaches the control, so
// `tap` goes through the viewport instead of the node.
async function tap(screen: Screen, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Target has no visible box.");
  await screen.tapAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

const pendingSet = (screen: Screen) =>
  screen.getByLabel(/not logged\. Tap to log 5 reps/).first();

describe("workout A", { serial: true }, () => {
  test("starts from the next workout", async ({ app, screen }) => {
    await app.clearState();
    await app.open();

    await expect(screen.getByText("Workout A")).toBeVisible();
    await tap(screen, screen.getByText("Start workout A"));
    await expect(screen.getByText("0 / 15 sets")).toBeVisible();
  });

  test("logs a set and keeps it across a restart", async ({ app, screen }) => {
    await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
    await expect(screen.getByText("1 / 15 sets")).toBeVisible();
    await expect(
      screen.getByLabel(/^Squat, set 1 of 5, 5 of 5 reps/),
    ).toBeVisible();

    await app.restart();
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

  test("logs every set and advances to workout B", async ({ screen }) => {
    for (let logged = 0; logged < 15; logged++) {
      await screen.scrollUntilVisible(pendingSet(screen));
      await tap(screen, pendingSet(screen));
      await expect(screen.getByText(`${logged + 1} / 15 sets`)).toBeVisible();
    }

    await tap(screen, screen.getByText("Finish"));
    await tap(screen, screen.getByText("Save workout"));
    await expect(screen.getByText("Start workout B")).toBeVisible();
  });

  test("shows the finished workout in history", async ({ screen }) => {
    await tap(screen, screen.getByText("History"));
    await expect(screen.getByText("Workout A").first()).toBeVisible();

    await tap(screen, screen.getByText("Workout A").first());
    await expect(screen.getByText("Squat")).toBeVisible();
  });
});
