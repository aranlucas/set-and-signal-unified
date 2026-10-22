import { expect, type Locator, type Screen } from "e2e";

// Expo UI renders each control's label and its clickable region as two nodes,
// and a tap on the label is refused because the touch point belongs to the
// sibling button. Tapping the label's centre reaches the control, but a sheet
// that is still sliding up reports a box below its final position, so wait for
// two matching reads before tapping.
export async function tap(screen: Screen, target: Locator) {
  let box = await target.boundingBox();
  await expect
    .poll(
      async () => {
        const next = await target.boundingBox();
        const stable =
          box !== null &&
          next !== null &&
          Math.abs(next.x - box.x) < 1 &&
          Math.abs(next.y - box.y) < 1 &&
          Math.abs(next.width - box.width) < 1 &&
          Math.abs(next.height - box.height) < 1;
        box = next;
        return stable;
      },
      { message: "Target must settle before tapping" },
    )
    .toBe(true);
  if (!box) throw new Error("Target has no visible box.");
  await screen.tapAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** Scrolls active-workout content without starting inside the fixed Rest dock. */
export async function scrollWorkoutUntilVisible(
  screen: Screen,
  target: Locator,
  { direction = "down" }: { direction?: "up" | "down" } = {},
) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await target.isVisible()) return;

    // Compose flattens the scroll container out of the accessibility tree.
    // The default viewport swipe starts at 80% height, inside the Rest dock
    // on smaller screens. Anchor the path to the persistent navigation and
    // toolbar instead, keeping both ends safely inside workout content.
    const navigation = await screen.getByText("Train").boundingBox();
    const toolbar = await screen.getByText("Finish").boundingBox();
    if (!navigation || !toolbar) {
      throw new Error(
        "Workout navigation and toolbar must have visible bounds.",
      );
    }
    const x =
      (navigation.x + navigation.width / 2 + toolbar.x + toolbar.width / 2) / 2;
    const upper = Math.max(navigation.y * 0.3, toolbar.y + toolbar.height * 2);
    const lower = navigation.y * 0.65;
    if (upper >= lower) {
      throw new Error("Workout content has no safe vertical swipe path.");
    }
    await screen.swipe({
      from: { x, y: direction === "down" ? lower : upper },
      to: { x, y: direction === "down" ? upper : lower },
    });
  }
  // Retry visibility after the last gesture, and retain a normal assertion
  // failure (with its locator and screen evidence) if the target is missing.
  await expect(target).toBeVisible();
}

/** Starts the next workout from the home screen and checks it is active. */
export async function startWorkout(
  screen: Screen,
  kind: "A" | "B",
  totalSets: number,
) {
  const start = screen.getByText(`Start workout ${kind}`);
  await screen.scrollUntilVisible(start);
  await tap(screen, start);
  await expect(screen.getByText(`0 / ${totalSets} sets`)).toBeVisible();
}

const pendingSets = (screen: Screen) =>
  screen.getByLabel(/not logged\. Tap to log 5 reps/);

/**
 * Logs every remaining work set at 5 reps. `already` is the number the screen
 * has counted before the first tap, so the loop can start from a partly
 * completed workout. The header counter is outside the lazy list's viewport
 * while the sets are being tapped, so it is read once at the end instead of
 * after every set.
 */
export async function logAllSets(
  screen: Screen,
  totalSets: number,
  already = 0,
) {
  const counter = screen.getByText(`${totalSets} / ${totalSets} sets`);
  await scrollWorkoutUntilVisible(
    screen,
    screen.getByText(`${already} / ${totalSets} sets`),
    { direction: "up" },
  );
  for (let logged = already; logged < totalSets; logged++) {
    const pending = pendingSets(screen).first();
    await scrollWorkoutUntilVisible(screen, pending);
    await tap(screen, pending);
  }
  await scrollWorkoutUntilVisible(screen, counter, { direction: "up" });
  await expect(counter).toBeVisible();
}

/** Opens the finish dialog and confirms it with the given action. */
export async function finishWorkout(
  screen: Screen,
  confirm: "Save workout" | "Discard workout" = "Save workout",
) {
  await tap(screen, screen.getByText("Finish"));
  await tap(screen, screen.getByText(confirm));
}

/** Scrolls to the bottom of the active workout and discards it. */
export async function discardWorkout(screen: Screen) {
  const discard = screen.getByText("Discard");
  await scrollWorkoutUntilVisible(screen, discard);
  await tap(screen, discard);
  await tap(screen, screen.getByText("Discard workout"));
}
