import { expect, type Locator, type Screen } from "e2e";

// Expo UI renders each control's label and its clickable region as two nodes,
// and a tap on the label is refused because the touch point belongs to the
// sibling button. Tapping the label's centre reaches the control, but a sheet
// that is still sliding up reports a box below its final position, so wait for
// two matching reads before tapping.
export async function tap(screen: Screen, target: Locator) {
  let box = await target.boundingBox();
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = await target.boundingBox();
    if (
      box &&
      next &&
      Math.abs(next.x - box.x) < 1 &&
      Math.abs(next.y - box.y) < 1 &&
      Math.abs(next.width - box.width) < 1 &&
      Math.abs(next.height - box.height) < 1
    ) {
      box = next;
      break;
    }
    box = next;
  }
  if (!box) throw new Error("Target has no visible box.");
  await screen.tapAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
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
  await screen.scrollUntilVisible(
    screen.getByText(`${already} / ${totalSets} sets`),
    { direction: "up" },
  );
  for (let logged = already; logged < totalSets; logged++) {
    const pending = pendingSets(screen).first();
    await screen.scrollUntilVisible(pending);
    await tap(screen, pending);
  }
  await screen.scrollUntilVisible(counter, { direction: "up" });
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
  await screen.scrollUntilVisible(discard);
  await tap(screen, discard);
  await tap(screen, screen.getByText("Discard workout"));
}
