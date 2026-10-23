import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import App from "../app";
import * as actions from "../src/data/actions";
import { defaultPlateInventory } from "../src/domain/plates";
import { commit, retry } from "../src/data/store";
import { initialState, startSession, logSet } from "../src/domain/workout";
import { finishedHistory, NOW } from "./support/fixture";
import { resetStorage, savedState } from "./support/storage";
import { runSequentially } from "./support/sequential";
import { configureTestNativeServices } from "./support/native";
import { parseJson } from "./support/parse-json";
import {
  act,
  cleanup,
  hostCallback,
  hostProps,
  modifierAction,
  render,
  semanticDescription,
  text,
  unmount,
  type Root,
  type TestInstance,
} from "./support/native-renderer";

const CountsSchema = z.object({
  total: z.number(),
  byComponent: z.record(z.string(), z.number()),
});

const CountsRecordSchema = z.record(z.string(), CountsSchema);

type Counts = z.infer<typeof CountsSchema>;

const history = finishedHistory();

let renderer: Root | undefined;

const currentRenderer = () => {
  if (!renderer) {
    throw new Error("App has not been rendered");
  }

  return renderer;
};

function host(type: string, predicate: (node: TestInstance) => boolean = () => true) {
  const nodes = currentRenderer().container.queryAll(
    (node) => node.type === type && predicate(node),
  );

  expect(nodes, `unique ${type}`).toHaveLength(1);

  return nodes[0];
}

const button = (label: string) =>
  currentRenderer().container.queryAll(
    (node) =>
      ["Button", "TextButton", "FilledTonalButton"].includes(node.type) && text(node) === label,
  )[0];

const description = semanticDescription;

const click = (node: TestInstance) => hostCallback(node, "onClick")();

beforeEach(() => {
  configureTestNativeServices();
});

const counter = (index: number) =>
  host("FilledTonalButton", (node) => description(node).startsWith(`Squat, set ${index} of 5`));

async function interact(action: () => void | Promise<void>) {
  await act(async () => {
    await action();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
}

async function press(label: string) {
  const target = button(label);
  expect(target, label).toBeDefined();
  await interact(() => click(target));
}

function hasText(value: string) {
  expect(
    currentRenderer().container.queryAll((node) => node.type === "Text" && text(node) === value),
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

  if (active) {
    state = startSession(state, NOW);
  }

  if (resting) {
    state = logSet(state, "squat", 0, 5, NOW);
  }

  resetStorage(state);
  retry();
  renderer = render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
}

it("counts root App rerenders when its selected theme changes", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const counts: string[] = [];
  globalThis.fivefoldRenderCounter = (name) => counts.push(name);

  await fresh(false);
  expect(counts).toContain("App");
  counts.length = 0;

  act(() => {
    expect(
      commit((state) => ({
        ...state,
        settings: { ...state.settings, theme: "dark" },
      })),
    ).toBe(true);
  });

  expect(counts.filter((name) => name === "App")).toHaveLength(1);
});

afterEach(() => {
  cleanup();
  renderer = undefined;
  delete globalThis.fivefoldRenderCounter;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("records compiled component invocations for the 10,000-session interaction baseline", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const results: Record<string, Counts> = {};
  let counts: Record<string, number> = {};
  globalThis.fivefoldRenderCounter = (name) => {
    counts[name] = (counts[name] ?? 0) + 1;
  };

  const measure = async (name: string, action: () => Promise<void>) => {
    counts = {};
    await action();

    const byComponent = Object.fromEntries(
      Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)),
    );

    results[name] = {
      total: Object.values(byComponent).reduce((sum, count) => sum + count, 0),
      byComponent,
    };
  };

  const unmountCurrent = () => {
    unmount(currentRenderer());
    renderer = undefined;
    vi.clearAllTimers();
  };

  await fresh(false);
  await measure("start-workout", () => press("Start workout A"));
  expect(savedState().active?.kind).toBe("A");
  expect(description(counter(1))).toContain("not logged");
  hasText("0 / 15 sets");
  unmountCurrent();

  await fresh();
  await measure("log-set", () => interact(() => click(counter(1))));
  expect(text(counter(1))).toBe("5");
  expect(savedState().active?.exercises[0].sets[0]).toBe(5);
  hasText("Rest 1:30");
  unmountCurrent();

  await fresh(true, true);
  await measure("log-second-set", () => interact(() => click(counter(2))));
  expect(text(counter(2))).toBe("5");
  expect(savedState().rest?.setIndex).toBe(1);
  hasText("Squat · Set 3/5");
  hasText("Rest 1:30");
  unmountCurrent();

  await fresh();
  await press("Add note");
  await measure("note-keystroke", () =>
    interact(() => hostCallback(host("OutlinedTextField"), "onValueChange")("a")),
  );
  expect(savedState().active?.notes).toBe("a");
  expect(hostProps(host("OutlinedTextField")).value?.get()).toBe("a");
  unmountCurrent();

  await fresh(true, true);
  const deadline = savedState().rest?.endsAt;
  await measure("rest-tick", async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  });
  hasText("Rest 1:29");
  expect(savedState().rest?.endsAt).toBe(deadline);
  unmountCurrent();

  const tabs = ["History", "Progress", "Settings", "Train"];

  await runSequentially(tabs, async (tab, index) => {
    await fresh();

    // Each measured tab has a fresh root and follows the same navigation order.
    const previousTab = index > 0 ? tabs[index - 1] : undefined;

    if (previousTab) {
      await interact(() => click(host("NavigationBarItem", (node) => text(node) === previousTab)));
    }

    await measure(`tab-${tab.toLowerCase()}`, () =>
      interact(() => click(host("NavigationBarItem", (node) => text(node) === tab))),
    );
    expect(hostProps(host("NavigationBarItem", (node) => text(node) === tab)).selected).toBe(true);
    expect(savedState().active?.kind).toBe("A");

    if (tab === "History") {
      hasText("10000 saved workouts");
      expect(
        currentRenderer().container.queryAll((node) => node.type === "LazyColumn.Item"),
      ).toHaveLength(10_000);
    }

    if (tab === "Progress") {
      hasText("Lift records");
    }

    if (tab === "Settings") {
      hasText("Weights & equipment");
    }

    if (tab === "Train") {
      expect(description(counter(1))).toContain("not logged");
    }

    unmountCurrent();
  });

  await fresh();
  await measure("open-weight-sheet", () =>
    interact(() => click(host("TextButton", (node) => description(node) === "Edit Squat weight"))),
  );
  expect(host("ModalBottomSheet")).toBeDefined();
  hasText("Total weight, including bar");
  unmountCurrent();

  await fresh();
  await interact(() =>
    click(host("TextButton", (node) => description(node) === "Edit Squat weight")),
  );
  await measure("close-weight-sheet", () => press("Cancel"));
  expect(
    currentRenderer().container.queryAll((node) => node.type === "ModalBottomSheet"),
  ).toHaveLength(0);
  expect(savedState().active?.exercises[0].weight).toBe(20);
  unmountCurrent();

  await fresh();
  await interact(() => click(host("NavigationBarItem", (node) => text(node) === "Settings")));

  const openRow = (label: string) =>
    interact(() =>
      modifierAction(
        host("ListItem", (node) => text(node).startsWith(label)),
        "clickable",
        0,
      )(),
    );

  await openRow("Weights & equipment");
  hasText("Standard gym");
  await openRow("Plates");

  const plateToggle = host(
    "Row",
    (node) =>
      text(node).startsWith("Count my plates") &&
      Boolean(hostProps(node).modifiers?.some((entry) => entry.name === "toggleable")),
  );

  await interact(() => modifierAction(plateToggle, "toggleable", 1)());
  await measure("plates-step", () =>
    interact(() =>
      click(
        host("FilledTonalButton", (node) => description(node) === "Add a pair of 20 kg plates"),
      ),
    ),
  );
  expect(savedState().settings.plates?.kg).toEqual([4, 5, 4, 4, 4, 4, 4]);
  expect(savedState().settings.plates?.lb).toEqual([4, 4, 4, 4, 4, 4]);
  hasText("5 pairs");
  expect(results["plates-step"].byComponent.WorkoutScreen ?? 0).toBe(0);
  expect(results["plates-step"].byComponent.ExerciseCard ?? 0).toBe(0);

  const removeSmall = () =>
    host("FilledTonalButton", (node) => description(node) === "Remove a pair of 1.25 kg plates");

  await runSequentially([0, 1, 2, 3], async () => {
    await interact(() => click(removeSmall()));
  });

  hasText("0 pairs");
  expect(hostProps(removeSmall()).enabled).toBe(false);

  await runSequentially(
    Array.from({ length: 15 }, (_, index) => index),
    async () => {
      await interact(() => {
        actions.stepPlatePair("kg", 1, 1);
      });
    },
  );

  hasText("20 pairs");
  expect(
    hostProps(
      host("FilledTonalButton", (node) => description(node) === "Add a pair of 20 kg plates"),
    ).enabled,
  ).toBe(false);
  unmountCurrent();

  await fresh(true, false, true);
  hasText("Your plates load 100 kg, not 102.5 kg.");
  await measure("tools-inexact", () =>
    interact(() =>
      click(
        host(
          "IconButton",
          (node) =>
            text(node) === "" &&
            node.queryAll(
              (child) =>
                child.type === "Icon" &&
                hostProps(child).contentDescription === "Warm-up & plates for Squat",
            ).length === 1,
        ),
      ),
    ),
  );
  hasText("You can't load 102.5 kg with your plates.");
  hasText("Closest below: 100 kg");
  hasText("Closest above: 105 kg");
  await interact(() => click(host("FilterChip", (node) => text(node) === "Closest above: 105 kg")));
  hasText("105 kg total · Plates on each side");
  hasText("2 × 20 kg");
  hasText("1 × 2.5 kg");
  expect(savedState().active?.exercises[0].weight).toBe(102.5);
  // Unrelated settings must not invoke cards even while inventory guidance is active.
  counts = {};
  await interact(() => {
    actions.updateSettings({ haptics: false });
  });
  expect(counts.ExerciseCard ?? 0).toBe(0);
  expect(counts.WorkoutScreen ?? 0).toBe(0);
  await press("Back to workout");
  await interact(() => {
    actions.countMyPlates(false);
  });
  await interact(() =>
    click(
      host(
        "IconButton",
        (node) =>
          node.queryAll(
            (child) =>
              child.type === "Icon" &&
              hostProps(child).contentDescription === "Warm-up & plates for Squat",
          ).length === 1,
      ),
    ),
  );
  hasText("1 × 1.25 kg");
  hasText("Standard plates: 25, 20, 15, 10, 5, 2.5, 1.25 kg.");
  unmountCurrent();

  const baseline = parseJson(
    readFileSync("artifacts/perf/renders-baseline.json", "utf8"),
    CountsRecordSchema,
  );

  for (const scenario of ["log-set", "log-second-set", "note-keystroke", "rest-tick"]) {
    expect(results[scenario].total, scenario).toBeLessThanOrEqual(baseline[scenario].total);
  }

  const beforePlates = parseJson(
    readFileSync("artifacts/perf/renders-pre-plates.json", "utf8"),
    CountsRecordSchema,
  );

  for (const [scenario, before] of Object.entries(beforePlates)) {
    expect(results[scenario].total, scenario).toBeLessThanOrEqual(before.total);
  }

  const label = z.string().default("current").parse(process.env.FIVEFOLD_PERF_LABEL);

  if (!/^[\w-]+$/.test(label)) {
    throw new Error("Invalid FIVEFOLD_PERF_LABEL");
  }

  mkdirSync("artifacts/perf", { recursive: true });
  writeFileSync(`artifacts/perf/renders-${label}.json`, JSON.stringify(results, null, 2) + "\n");
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
