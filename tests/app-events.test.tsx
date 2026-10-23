import { defaultPlateInventory } from "../src/domain/plates";
import { configureTestNativeServices, nativeCalls } from "./support/native";
import { BackHandler } from "react-native";
import * as native from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../app";
import { ToolsSheet } from "../src/components/sheets";
import { commit, retry } from "../src/data/store";
import * as actions from "../src/data/actions";
import * as surfaces from "../src/data/surfaces";
import * as notifications from "../src/data/notifications";
import { notify } from "../src/data/notices";
import { setNotes } from "../src/domain/commands";
import { finishSession, initialState, logSet, startSession } from "../src/domain/workout";
import { NOW } from "./support/fixture";
import { resetStorage, savedState } from "./support/storage";
import { runSequentially } from "./support/sequential";
import {
  act,
  cleanup,
  hostCallback,
  hostProps,
  modifierAction,
  render,
  semanticDescription,
  text,
  type Root,
} from "./support/native-renderer";

let renderer: Root | undefined;

const currentRenderer = () => {
  if (!renderer) {
    throw new Error("App has not been rendered");
  }

  return renderer;
};

const host = (type: string, label?: string) =>
  currentRenderer().container.queryAll(
    (node) => node.type === type && (label === undefined || text(node) === label),
  )[0];

const press = (label: string) => {
  const button = ["Button", "TextButton", "FilledTonalButton"]
    .map((type) => host(type, label))
    .find(Boolean);

  expect(button, label).toBeDefined();

  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }

  act(() => hostCallback(button, "onClick")());
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  configureTestNativeServices();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  nativeCalls.showSnackbar.mockClear();

  const finished = finishSession(
    logSet(startSession(initialState("kg"), NOW - 100000), "squat", 0, 5, NOW - 100000),
    NOW - 50000,
  );

  resetStorage(
    startSession(
      {
        ...finished,
        onboarded: true,
        settings: { ...finished.settings, restAlerts: true },
      },
      NOW,
    ),
  );
  retry();
});

afterEach(() => {
  cleanup();
  renderer = undefined;
  delete globalThis.fivefoldRenderCounter;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("shows a singular set in the home Last workout card", () => {
  resetStorage({ ...savedState(), active: null, rest: null });
  retry();
  renderer = render(<App />);
  expect(host("Text", "Last workout")).toBeDefined();
  expect(
    currentRenderer().container.queryAll(
      (node) => node.type === "Text" && text(node).endsWith("· 1 set"),
    ),
  ).toHaveLength(1);
});

it.each([
  ["unloadable", 22.5, true, "Bar: 20 kg"],
  ["below-bar", 10, true, "Bar: 20 kg"],
  ["loadable", 25, true, "Bar: 20 kg · Plates on each side"],
  ["empty-bar", 20, true, "Bar: 20 kg · Plates on each side"],
  ["standard gym", 23, false, "Bar: 20 kg · Plates on each side"],
] as const)("describes only the plates shown for a %s weight", (_, weight, counted, caption) => {
  const state = initialState("kg");
  const plates = defaultPlateInventory();
  plates.kg[6] = 0;
  resetStorage({
    ...state,
    settings: { ...state.settings, plates: counted ? plates : null },
    plans: { ...state.plans, squat: { ...state.plans.squat, weight } },
  });
  retry();
  renderer = render(<ToolsSheet lift="squat" onDismiss={() => {}} />);

  const captions = currentRenderer().container.queryAll(
    (node) => node.type === "Text" && text(node).startsWith("Bar:"),
  );

  expect(captions.map(text)).toEqual([caption]);

  if (weight === 22.5) {
    expect(host("Text", "You can't load 22.5 kg with your plates.")).toBeDefined();
  }

  if (weight === 25) {
    expect(host("Text", "1 × 2.5 kg")).toBeDefined();
  }

  if (weight === 20) {
    expect(host("Text", "Empty bar")).toBeDefined();
  }
});

it.each([1, 2])("aligns plate count slots for 0–20 pairs at %ix font scale", async (fontScale) => {
  vi.spyOn(native, "useWindowDimensions").mockReturnValue({
    ...native.useWindowDimensions(),
    fontScale,
  });
  const state = savedState();
  const plates = defaultPlateInventory();
  plates.kg = [0, 1, 4, 9, 10, 19, 20];
  resetStorage({ ...state, settings: { ...state.settings, plates } });
  retry();
  renderer = render(<App />);
  act(() => hostCallback(host("NavigationBarItem", "Settings"), "onClick")());

  await runSequentially(["Weights & equipment", "Plates"], (label) => {
    const row = currentRenderer().container.queryAll(
      (node) => node.type === "ListItem" && text(node).startsWith(label),
    )[0];

    act(() => modifierAction(row, "clickable", 0)());
  });

  const slots = currentRenderer().container.queryAll(
    (node) =>
      node.type === "Column" && node.children.length === 1 && /^\d+ pairs?$/.test(text(node)),
  );

  expect(slots.map(text)).toEqual([
    "0 pairs",
    "1 pair",
    "4 pairs",
    "9 pairs",
    "10 pairs",
    "19 pairs",
    "20 pairs",
  ]);

  for (const slot of slots) {
    expect(hostProps(slot).modifiers).toContainEqual({
      name: "width",
      args: [72 * fontScale],
    });
    expect(hostProps(slot).horizontalAlignment).toBe("center");
  }

  const buttons = currentRenderer().container.queryAll(
    (node) =>
      node.type === "FilledTonalButton" &&
      Boolean(hostProps(node).modifiers?.some((entry) => entry.name === "semantics")),
  );

  expect(buttons).toHaveLength(14);

  for (const button of buttons) {
    expect(hostProps(button).modifiers).toContainEqual({
      name: "defaultMinSize",
      args: [{ minWidth: 48, minHeight: 48 }],
    });
  }

  expect(hostProps(buttons[0]).modifiers).toContainEqual({
    name: "semantics",
    args: [{ contentDescription: "Remove a pair of 25 kg plates" }],
  });
  expect(hostProps(buttons[1]).modifiers).toContainEqual({
    name: "semantics",
    args: [{ contentDescription: "Add a pair of 25 kg plates" }],
  });
});

it("keeps one Android Back registration while reading the latest dialog, details and tab", () => {
  const registration = vi.spyOn(BackHandler, "addEventListener");
  renderer = render(<App />);
  expect(registration).toHaveBeenCalledOnce();
  // SAFETY: this is the callback passed to the hardwareBackPress registration below.
  const back = registration.mock.calls[0][1] as () => boolean | null | undefined;
  let handled: boolean | null | undefined;
  act(() => {
    handled = back();
  });
  expect(handled).toBe(false);
  act(() => hostCallback(host("NavigationBarItem", "History"), "onClick")());

  // Native LazyColumn rows expose their click action through a modifier.
  const row = currentRenderer().container.queryAll(
    (node) => node.type === "Column" && semanticDescription(node).startsWith("Open workout"),
  )[0];

  act(() => modifierAction(row, "clickable", 0)());
  press("Delete workout");
  expect(host("AlertDialog")).toBeDefined();
  act(() => {
    handled = back();
  });
  expect(handled).toBe(true);
  expect(host("AlertDialog")).toBeUndefined();
  expect(host("Text", "Details")).toBeDefined();
  act(() => {
    handled = back();
  });
  expect(handled).toBe(true);
  expect(host("Text", "1 saved workout")).toBeDefined();
  act(() => {
    handled = back();
  });
  expect(handled).toBe(true);
  expect(hostProps(host("NavigationBarItem", "Train")).selected).toBe(true);
  expect(registration).toHaveBeenCalledOnce();
});

it("shows repeated notices imperatively without a React commit", () => {
  renderer = render(<App />);
  const rendered = vi.fn();
  globalThis.fivefoldRenderCounter = rendered;
  notify("Ready");
  notify("Ready");
  expect(nativeCalls.showSnackbar).toHaveBeenCalledTimes(2);
  expect(nativeCalls.showSnackbar).toHaveBeenLastCalledWith({
    message: "Ready",
    withDismissAction: true,
    duration: "long",
  });
  expect(rendered).not.toHaveBeenCalled();
  delete globalThis.fivefoldRenderCounter;
});

it("syncs only output-related slices and ignores notes and unrelated settings", () => {
  const widget = vi.spyOn(surfaces, "syncWidget");
  const notification = vi.spyOn(surfaces, "syncWorkoutNotification");
  const rest = vi.spyOn(notifications, "syncRestAlert");
  renderer = render(<App />);
  widget.mockClear();
  notification.mockClear();
  rest.mockClear();
  act(() => {
    commit((s) => setNotes(s, "a"));
    actions.updateSettings({ haptics: false });
  });
  expect(widget).not.toHaveBeenCalled();
  expect(notification).not.toHaveBeenCalled();
  expect(rest).not.toHaveBeenCalled();
  act(() => {
    actions.deleteWorkout(savedState().history[0].id);
  });
  expect(widget).not.toHaveBeenCalled();
  expect(notification).not.toHaveBeenCalled();
  expect(rest).not.toHaveBeenCalled();
  act(() => {
    actions.saveWeight("deadlift", 60, 5);
  });
  expect(widget).toHaveBeenCalledOnce();
  expect(notification).not.toHaveBeenCalled();
  expect(rest).not.toHaveBeenCalled();
  widget.mockClear();
  act(() => {
    actions.recordSet("squat", 0, 5);
  });
  expect(widget).toHaveBeenCalledOnce();
  expect(notification).toHaveBeenCalledOnce();
  expect(rest).toHaveBeenCalledOnce();
  widget.mockClear();
  notification.mockClear();
  rest.mockClear();
  act(() => {
    actions.extendRest();
  });
  expect(widget).not.toHaveBeenCalled();
  expect(notification).toHaveBeenCalledOnce();
  expect(rest).toHaveBeenCalledOnce();
});

it("preserves note expansion across discard and a subsequent workout", () => {
  renderer = render(<App />);
  press("Add note");
  act(() => hostCallback(host("OutlinedTextField"), "onValueChange")("a"));
  press("Discard");
  press("Discard workout");
  press("Start workout B");
  expect(host("OutlinedTextField")).toBeDefined();
  expect(savedState().active?.notes).toBe("");
});

it("commits a supplied inventory through the stable action without changing workout data", () => {
  const before = savedState();
  const plates = defaultPlateInventory();
  plates.kg[6] = 0;
  act(() => {
    expect(actions.setPlateInventory(plates)).toBe(true);
  });
  expect(savedState()).toEqual({
    ...before,
    settings: { ...before.settings, plates },
  });
});
