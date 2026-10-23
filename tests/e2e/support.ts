import {
  accessibilityViolations,
  parseAccessibilityTree,
} from "../support/accessibility";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Screen } from "e2e";

// Expo UI renders each control's label and its clickable region as two nodes,
// and a tap on the label is refused because the touch point belongs to the
// sibling button. Tapping the label's centre reaches the control, but a sheet
// that is still sliding up reports a box below its final position, so wait for
// two matching reads before tapping.
export async function tap(
  screen: Screen,
  target: Locator,
  { stableFor = 0 }: { stableFor?: number } = {},
) {
  let box = await target.boundingBox();
  let stableSince = Date.now();
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
        if (!stable) stableSince = Date.now();
        return stable && Date.now() - stableSince >= stableFor;
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

/** New installs default to pounds; suites that assert kilogram loads pick kg first. */
export async function chooseKilograms(screen: Screen) {
  await tap(screen, screen.getByText("Kilograms"));
  await expect(screen.getByText("20 kg").first()).toBeVisible();
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

/** Device-only features absent from the engine (font scale and shared files). */
export function adb(...args: string[]): string {
  return execFileSync(adbExecutable(), ["-s", deviceSerial(), ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16_000_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function adbExecutable() {
  for (const root of [
    process.env.ANDROID_HOME,
    join(homedir(), "Library/Android/sdk"),
  ]) {
    if (root && existsSync(join(root, "platform-tools/adb")))
      return join(root, "platform-tools/adb");
  }
  return "adb";
}
function deviceSerial() {
  if (process.env.E2E_DEVICE) return process.env.E2E_DEVICE;
  const devices = execFileSync(adbExecutable(), ["devices"], {
    encoding: "utf8",
    timeout: 10_000,
  })
    .split(/\r?\n/)
    .flatMap((line) => /^([^\s]+)\s+device\b/.exec(line)?.[1] ?? []);
  if (devices.length !== 1)
    throw new Error(
      `Set E2E_DEVICE to one adb serial: found ${devices.length} online devices (${devices.join(", ") || "none"}).`,
    );
  return devices[0];
}
export function displayMetrics() {
  const densityOutput = adb("shell", "wm", "density");
  const density = Number(
    [...densityOutput.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)].at(
      -1,
    )?.[1],
  );
  const size = [
    ...adb("shell", "wm", "size").matchAll(
      /(?:Physical|Override) size:\s*(\d+)x(\d+)/g,
    ),
  ].at(-1);
  if (!density || !size)
    throw new Error("Cannot read Android display size/density");
  return { width: Number(size[1]), height: Number(size[2]), dp: density / 160 };
}

/** A box assertion that also catches text wrapping beyond the display edges. */
export async function expectWithinScreen(target: Locator) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, "Visible text must expose bounds").not.toBeNull();
  const { width, height } = displayMetrics();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
}

/**
 * Prefer the engine's semantic tree. Its Android adapter maps clickable View
 * rows to generic "group" nodes and omits clickable/name attributes from
 * getAttribute(), so it cannot enumerate ALL unnamed interactive controls.
 * UIAutomator supplies those missing flags, merged descendants and scroll
 * clipping bounds. The post-dump engine read proves the session still works.
 */
export async function expectAccessibleTargets(screen: Screen, name: string) {
  const roles = [
    "button",
    "switch",
    "checkbox",
    "radio",
    "tab",
    "link",
    "textbox",
    "slider",
    "spinbutton",
    "combobox",
    "menuitem",
    "option",
  ] as const;
  const engineTargets: {
    box: Awaited<ReturnType<Locator["boundingBox"]>>;
    enabled: boolean;
    label: string | null;
  }[] = [];
  for (const role of roles) {
    for (const node of await screen.getByRole(role).all()) {
      engineTargets.push({
        box: await node.boundingBox(),
        enabled: await node.isEnabled(),
        label:
          (await node.getAttribute("content-desc")) ??
          (await node.textContent()),
      });
    }
  }
  // UiAutomation is exclusive: retire the helper instrumentation before the
  // separate UIAutomator client connects. The next engine read reconnects its
  // helper in the same session, without closing or restarting the app.
  adb("shell", "am", "force-stop", "com.callstack.agentdevice.snapshothelper");
  const xml = adb("exec-out", "uiautomator", "dump", "/dev/tty");
  const nodes = parseAccessibilityTree(xml);
  expect(
    nodes.some((node) => node.attributes.package === "app.fivefold.lifts"),
    `${name}: dump must describe Fivefold`,
  ).toBe(true);
  // The dump command must not steal/terminate agent-device's automation.
  expect(
    await screen.getByRole("group").count(),
    `${name}: engine session must remain usable after UIAutomator dump`,
  ).toBeGreaterThan(0);
  const failures = accessibilityViolations(nodes, displayMetrics());
  console.log(
    `Accessibility ${name}: ${engineTargets.length} semantic targets; ${failures.length} violations${failures.length ? "\n" + failures.join("\n") : ""}`,
  );
  expect
    .soft(failures, `${name}: accessibility violations\n${failures.join("\n")}`)
    .toEqual([]);
}
