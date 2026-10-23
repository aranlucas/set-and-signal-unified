import "./support/native";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import App from "../App";
import * as actions from "../src/data/actions";
import { defaultPlateInventory } from "../src/domain/plates";
import { retry } from "../src/data/store";
import { initialState, startSession, logSet } from "../src/domain/workout";
import { finishedHistory, NOW } from "./support/fixture";
import { resetStorage, savedState } from "./support/storage";

declare global {
  var __FIVEFOLD_RENDER__: ((name: string) => void) | undefined;
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
type Counts = { total: number; byComponent: Record<string, number> };
const history = finishedHistory();
let renderer: ReactTestRenderer | undefined;
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
function host(
  type: string,
  predicate: (node: ReactTestInstance) => boolean = () => true,
) {
  const nodes = renderer!.root.findAll(
    (node) => node.type === type && predicate(node),
  );
  expect(nodes, `unique ${type}`).toHaveLength(1);
  return nodes[0];
}
const button = (label: string) =>
  renderer!.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      ["Button", "TextButton", "FilledTonalButton"].includes(node.type) &&
      text(node) === label,
  )[0];
function description(node: ReactTestInstance) {
  return (
    node.props.modifiers?.find((modifier: any) => modifier.name === "semantics")
      ?.args[0]?.contentDescription ?? ""
  );
}
const counter = (index: number) =>
  host("FilledTonalButton", (node) =>
    description(node).startsWith(`Squat, set ${index} of 5`),
  );
async function interact(action: () => void) {
  await act(async () => {
    action();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
}
async function press(label: string) {
  const target = button(label);
  expect(target, label).toBeDefined();
  await interact(() => target.props.onClick());
}
function hasText(value: string) {
  expect(
    renderer!.root.findAll(
      (node) => String(node.type) === "Text" && text(node) === value,
    ),
    value,
  ).not.toHaveLength(0);
}
async function fresh(active = true, resting = false, myPlates = false) {
  vi.setSystemTime(NOW);
  let state = { ...initialState("kg"), onboarded: true, history };
  if (myPlates) {
    state.settings.plates = defaultPlateInventory();
    state.settings.plates.kg[6] = 0;
    state.plans.squat.weight = 102.5;
  }
  if (active) state = startSession(state, NOW);
  if (resting) state = logSet(state, "squat", 0, 5, NOW);
  resetStorage(state);
  retry();
  await act(async () => {
    renderer = create(<App />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
}
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  delete globalThis.__FIVEFOLD_RENDER__;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("records compiled component invocations for the 10,000-session interaction baseline", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const originalError = console.error;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("react-test-renderer is deprecated.")
    )
      return;
    originalError(...args);
  });
  const results: Record<string, Counts> = {};
  let counts: Record<string, number> = {};
  globalThis.__FIVEFOLD_RENDER__ = (name) => {
    counts[name] = (counts[name] ?? 0) + 1;
  };
  const measure = async (name: string, action: () => Promise<void>) => {
    counts = {};
    await action();
    const byComponent = Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    );
    results[name] = {
      total: Object.values(byComponent).reduce((sum, count) => sum + count, 0),
      byComponent,
    };
  };
  const cleanup = async () => {
    await act(async () => renderer!.unmount());
    renderer = undefined;
    vi.clearAllTimers();
  };

  await fresh(false);
  await measure("start-workout", () => press("Start workout A"));
  expect(savedState().active?.kind).toBe("A");
  expect(description(counter(1))).toContain("not logged");
  hasText("0 / 15 sets");
  await cleanup();

  await fresh();
  await measure("log-set", () => interact(() => counter(1).props.onClick()));
  expect(text(counter(1))).toBe("5");
  expect(savedState().active?.exercises[0].sets[0]).toBe(5);
  hasText("Rest 1:30");
  await cleanup();

  await fresh(true, true);
  await measure("log-second-set", () =>
    interact(() => counter(2).props.onClick()),
  );
  expect(text(counter(2))).toBe("5");
  expect(savedState().rest?.setIndex).toBe(1);
  hasText("Squat · Set 3/5");
  hasText("Rest 1:30");
  await cleanup();

  await fresh();
  await press("Add note");
  await measure("note-keystroke", () =>
    interact(() => host("OutlinedTextField").props.onValueChange("a")),
  );
  expect(savedState().active?.notes).toBe("a");
  expect(host("OutlinedTextField").props.value.get()).toBe("a");
  await cleanup();

  await fresh(true, true);
  const deadline = savedState().rest?.endsAt;
  await measure("rest-tick", async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  });
  hasText("Rest 1:29");
  expect(savedState().rest?.endsAt).toBe(deadline);
  await cleanup();

  const tabs = ["History", "Progress", "Settings", "Train"];
  for (let index = 0; index < tabs.length; index++) {
    await fresh();
    // Each measured tab has a fresh root and follows the same navigation order.
    for (const tab of index ? [tabs[index - 1]] : [])
      await interact(() =>
        host("NavigationBarItem", (node) => text(node) === tab).props.onClick(),
      );
    const tab = tabs[index];
    await measure(`tab-${tab.toLowerCase()}`, () =>
      interact(() =>
        host("NavigationBarItem", (node) => text(node) === tab).props.onClick(),
      ),
    );
    expect(
      host("NavigationBarItem", (node) => text(node) === tab).props.selected,
    ).toBe(true);
    expect(savedState().active?.kind).toBe("A");
    if (tab === "History") {
      hasText("10000 saved workouts");
      expect(
        renderer!.root.findAll(
          (node) => String(node.type) === "LazyColumn.Item",
        ),
      ).toHaveLength(10_000);
    }
    if (tab === "Progress") hasText("Lift records");
    if (tab === "Settings") hasText("Weights & equipment");
    if (tab === "Train")
      expect(description(counter(1))).toContain("not logged");
    await cleanup();
  }

  await fresh();
  await measure("open-weight-sheet", () =>
    interact(() =>
      host(
        "TextButton",
        (node) => description(node) === "Edit Squat weight",
      ).props.onClick(),
    ),
  );
  expect(host("ModalBottomSheet")).toBeDefined();
  hasText("Total weight, including bar");
  await cleanup();

  await fresh();
  await interact(() =>
    host(
      "TextButton",
      (node) => description(node) === "Edit Squat weight",
    ).props.onClick(),
  );
  await measure("close-weight-sheet", () => press("Cancel"));
  expect(
    renderer!.root.findAll((node) => String(node.type) === "ModalBottomSheet"),
  ).toHaveLength(0);
  expect(savedState().active?.exercises[0].weight).toBe(20);
  await cleanup();

  await fresh();
  await interact(() =>
    host(
      "NavigationBarItem",
      (node) => text(node) === "Settings",
    ).props.onClick(),
  );
  const openRow = async (label: string) =>
    interact(() =>
      host("ListItem", (node) => text(node).startsWith(label))
        .props.modifiers.find((m: any) => m.name === "clickable")
        .args[0](),
    );
  await openRow("Weights & equipment");
  hasText("Standard gym");
  await openRow("Plates");
  await interact(() =>
    host(
      "Row",
      (node) =>
        text(node).startsWith("Count my plates") &&
        node.props.modifiers?.some((m: any) => m.name === "toggleable"),
    )
      .props.modifiers.find((m: any) => m.name === "toggleable")
      .args[1](),
  );
  await measure("plates-step", () =>
    interact(() =>
      host(
        "FilledTonalButton",
        (node) => description(node) === "Add a pair of 20 kg plates",
      ).props.onClick(),
    ),
  );
  expect(savedState().settings.plates?.kg).toEqual([4, 5, 4, 4, 4, 4, 4]);
  expect(savedState().settings.plates?.lb).toEqual([4, 4, 4, 4, 4, 4]);
  hasText("5 pairs");
  expect(results["plates-step"].byComponent.WorkoutScreen ?? 0).toBe(0);
  expect(results["plates-step"].byComponent.ExerciseCard ?? 0).toBe(0);
  const removeSmall = () =>
    host(
      "FilledTonalButton",
      (node) => description(node) === "Remove a pair of 1.25 kg plates",
    );
  for (let i = 0; i < 4; i++)
    await interact(() => removeSmall().props.onClick());
  hasText("0 pairs");
  expect(removeSmall().props.enabled).toBe(false);
  for (let i = 0; i < 15; i++)
    await interact(() => actions.stepPlatePair("kg", 1, 1));
  hasText("20 pairs");
  expect(
    host(
      "FilledTonalButton",
      (node) => description(node) === "Add a pair of 20 kg plates",
    ).props.enabled,
  ).toBe(false);
  await cleanup();

  await fresh(true, false, true);
  hasText("Your plates load 100 kg, not 102.5 kg.");
  await measure("tools-inexact", () =>
    interact(() =>
      host(
        "IconButton",
        (node) =>
          text(node) === "" &&
          node.findAll(
            (child) =>
              String(child.type) === "Icon" &&
              child.props.contentDescription === "Warm-up & plates for Squat",
          ).length === 1,
      ).props.onClick(),
    ),
  );
  hasText("You can't load 102.5 kg with your plates.");
  hasText("Closest below: 100 kg");
  hasText("Closest above: 105 kg");
  await interact(() =>
    host(
      "FilterChip",
      (node) => text(node) === "Closest above: 105 kg",
    ).props.onClick(),
  );
  hasText("105 kg total · Plates on each side");
  hasText("2 × 20 kg");
  hasText("1 × 2.5 kg");
  expect(savedState().active?.exercises[0].weight).toBe(102.5);
  // Unrelated settings must not invoke cards even while inventory guidance is active.
  counts = {};
  await interact(() => actions.updateSettings({ haptics: false }));
  expect(counts.ExerciseCard ?? 0).toBe(0);
  expect(counts.WorkoutScreen ?? 0).toBe(0);
  await press("Back to workout");
  await interact(() => actions.countMyPlates(false));
  await interact(() =>
    host(
      "IconButton",
      (node) =>
        node.findAll(
          (child) =>
            String(child.type) === "Icon" &&
            child.props.contentDescription === "Warm-up & plates for Squat",
        ).length === 1,
    ).props.onClick(),
  );
  hasText("1 × 1.25 kg");
  hasText("Standard plates: 25, 20, 15, 10, 5, 2.5, 1.25 kg.");
  await cleanup();

  const baseline = JSON.parse(
    readFileSync("artifacts/perf/renders-baseline.json", "utf8"),
  ) as Record<string, Counts>;
  for (const scenario of [
    "log-set",
    "log-second-set",
    "note-keystroke",
    "rest-tick",
  ]) {
    expect(results[scenario].total, scenario).toBeLessThanOrEqual(
      baseline[scenario].total,
    );
  }
  const beforePlates = JSON.parse(
    readFileSync("artifacts/perf/renders-pre-plates.json", "utf8"),
  ) as Record<string, Counts>;
  for (const [scenario, before] of Object.entries(beforePlates))
    expect(results[scenario].total, scenario).toBeLessThanOrEqual(before.total);
  const label = process.env.FIVEFOLD_PERF_LABEL ?? "current";
  if (!/^[\w-]+$/.test(label)) throw new Error("Invalid FIVEFOLD_PERF_LABEL");
  mkdirSync("artifacts/perf", { recursive: true });
  writeFileSync(
    `artifacts/perf/renders-${label}.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
  expect(results).toMatchInlineSnapshot(`
    {
      "close-weight-sheet": {
        "byComponent": {
          "AppShell": 1,
        },
        "total": 1,
      },
      "log-second-set": {
        "byComponent": {
          "AppBar": 1,
          "AppShell": 1,
          "Caption": 1,
          "ExerciseCard": 1,
          "ExternalSync": 1,
          "Page": 1,
          "Panel": 1,
          "RestDock": 1,
          "RestTimer": 2,
          "SetCounters": 1,
          "WorkoutScreen": 1,
        },
        "total": 12,
      },
      "log-set": {
        "byComponent": {
          "AppBar": 1,
          "AppShell": 1,
          "Caption": 1,
          "Divider": 1,
          "ExerciseCard": 1,
          "ExternalSync": 1,
          "Page": 1,
          "Panel": 1,
          "RestDock": 1,
          "RestTimer": 1,
          "SetCounters": 1,
          "WorkoutScreen": 1,
        },
        "total": 12,
      },
      "note-keystroke": {
        "byComponent": {
          "Field": 1,
          "WorkoutNotes": 1,
        },
        "total": 2,
      },
      "open-weight-sheet": {
        "byComponent": {
          "Action": 2,
          "AppShell": 1,
          "Caption": 1,
          "Field": 2,
          "Heading": 1,
          "WeightSheet": 1,
        },
        "total": 8,
      },
      "plates-step": {
        "byComponent": {
          "Action": 1,
          "Heading": 1,
          "PlatesEditor": 1,
          "SettingsScreen": 1,
        },
        "total": 4,
      },
      "rest-tick": {
        "byComponent": {
          "RestTimer": 1,
        },
        "total": 1,
      },
      "start-workout": {
        "byComponent": {
          "ActiveExercises": 1,
          "AppBar": 1,
          "Caption": 8,
          "Divider": 1,
          "ExerciseCard": 3,
          "ExternalSync": 1,
          "Page": 1,
          "Panel": 3,
          "RestDock": 1,
          "SetCounters": 3,
          "WorkoutNotes": 1,
          "WorkoutScreen": 1,
        },
        "total": 25,
      },
      "tab-history": {
        "byComponent": {
          "AppBar": 1,
          "AppNavigation": 1,
          "AppShell": 1,
          "Caption": 10001,
          "Choices": 1,
          "Divider": 10000,
          "HistoryContent": 1,
          "HistoryScreen": 1,
          "Panel": 10000,
          "SectionTitle": 10000,
        },
        "total": 40007,
      },
      "tab-progress": {
        "byComponent": {
          "AppBar": 1,
          "AppNavigation": 1,
          "AppShell": 1,
          "Caption": 44,
          "Divider": 10,
          "Page": 2,
          "Panel": 6,
          "ProgressScreen": 2,
          "SectionTitle": 14,
          "StatRow": 10,
        },
        "total": 91,
      },
      "tab-settings": {
        "byComponent": {
          "AppBar": 1,
          "AppNavigation": 1,
          "AppShell": 1,
          "Caption": 1,
          "Divider": 4,
          "ListGroup": 1,
          "Page": 1,
          "SettingsScreen": 1,
        },
        "total": 11,
      },
      "tab-train": {
        "byComponent": {
          "ActiveExercises": 1,
          "AppBar": 1,
          "AppNavigation": 1,
          "AppShell": 1,
          "Caption": 8,
          "Divider": 1,
          "ExerciseCard": 3,
          "Page": 1,
          "Panel": 3,
          "SetCounters": 3,
          "WorkoutNotes": 1,
          "WorkoutScreen": 1,
        },
        "total": 25,
      },
      "tools-inexact": {
        "byComponent": {
          "Action": 1,
          "AppShell": 1,
          "Caption": 5,
          "Heading": 2,
          "ToolsSheet": 1,
        },
        "total": 10,
      },
    }
  `);
}, 120_000);
