import { defaultPlateInventory } from "../src/domain/plates";
import "./support/native";
import { nativeCalls } from "./support/native";
import { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { BackHandler } from "react-native";
import * as native from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../App";
import { ToolsSheet } from "../src/components/Sheets";
import { commit, retry } from "../src/data/store";
import * as actions from "../src/data/actions";
import * as surfaces from "../src/data/surfaces";
import * as notifications from "../src/data/notifications";
import { notify } from "../src/data/notices";
import { setNotes } from "../src/domain/commands";
import {
  finishSession,
  initialState,
  logSet,
  startSession,
} from "../src/domain/workout";
import { NOW } from "./support/fixture";
import { resetStorage, savedState } from "./support/storage";

let renderer: ReactTestRenderer;
const text = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
const host = (type: string, label?: string) =>
  renderer.root.findAll(
    (node) =>
      String(node.type) === type &&
      (label === undefined || text(node) === label),
  )[0];
const press = async (label: string) => {
  const button = ["Button", "TextButton", "FilledTonalButton"]
    .map((type) => host(type, label))
    .find(Boolean);
  expect(button, label).toBeDefined();
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.props.onClick());
};
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  nativeCalls.showSnackbar.mockClear();
  const finished = finishSession(
    logSet(
      startSession(initialState("kg"), NOW - 100000),
      "squat",
      0,
      5,
      NOW - 100000,
    ),
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
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  delete globalThis.__FIVEFOLD_RENDER__;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("shows a singular set in the home Last workout card", async () => {
  resetStorage({ ...savedState(), active: null, rest: null });
  retry();
  await act(async () => {
    renderer = create(<App />);
  });
  expect(host("Text", "Last workout")).toBeDefined();
  expect(
    renderer.root.findAll(
      (node) => String(node.type) === "Text" && text(node).endsWith("· 1 set"),
    ),
  ).toHaveLength(1);
});
it.each([
  ["unloadable", 22.5, true, "Bar: 20 kg"],
  ["below-bar", 10, true, "Bar: 20 kg"],
  ["loadable", 25, true, "Bar: 20 kg · Plates on each side"],
  ["empty-bar", 20, true, "Bar: 20 kg · Plates on each side"],
  ["standard gym", 23, false, "Bar: 20 kg · Plates on each side"],
] as const)(
  "describes only the plates shown for a %s weight",
  async (_, weight, counted, caption) => {
    const state = initialState("kg");
    const plates = defaultPlateInventory();
    plates.kg[6] = 0;
    resetStorage({
      ...state,
      settings: { ...state.settings, plates: counted ? plates : null },
      plans: { ...state.plans, squat: { ...state.plans.squat, weight } },
    });
    retry();
    await act(async () => {
      renderer = create(<ToolsSheet lift="squat" onDismiss={() => {}} />);
    });
    const captions = renderer.root.findAll(
      (node) => String(node.type) === "Text" && text(node).startsWith("Bar:"),
    );
    expect(captions.map(text)).toEqual([caption]);
    if (weight === 22.5)
      expect(
        host("Text", "You can't load 22.5 kg with your plates."),
      ).toBeDefined();
    if (weight === 25) expect(host("Text", "1 × 2.5 kg")).toBeDefined();
    if (weight === 20) expect(host("Text", "Empty bar")).toBeDefined();
  },
);
it.each([1, 2])(
  "aligns plate count slots for 0–20 pairs at %ix font scale",
  async (fontScale) => {
    vi.spyOn(native, "useWindowDimensions").mockReturnValue({
      ...native.useWindowDimensions(),
      fontScale,
    });
    const state = savedState();
    const plates = defaultPlateInventory();
    plates.kg = [0, 1, 4, 9, 10, 19, 20];
    resetStorage({ ...state, settings: { ...state.settings, plates } });
    retry();
    await act(async () => {
      renderer = create(<App />);
    });
    await act(async () =>
      host("NavigationBarItem", "Settings").props.onClick(),
    );
    for (const label of ["Weights & equipment", "Plates"]) {
      const row = renderer.root.findAll(
        (node) =>
          String(node.type) === "ListItem" && text(node).startsWith(label),
      )[0];
      await act(async () =>
        row.props.modifiers.find((m: any) => m.name === "clickable").args[0](),
      );
    }
    const slots = renderer.root.findAll(
      (node) =>
        String(node.type) === "Column" &&
        node.children.length === 1 &&
        /^\d+ pairs?$/.test(text(node)),
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
      expect(slot.props.modifiers).toContainEqual({
        name: "width",
        args: [72 * fontScale],
      });
      expect(slot.props.horizontalAlignment).toBe("center");
    }
    const buttons = renderer.root.findAll(
      (node) =>
        String(node.type) === "FilledTonalButton" &&
        node.props.modifiers?.some((m: any) => m.name === "semantics"),
    );
    expect(buttons).toHaveLength(14);
    for (const button of buttons)
      expect(button.props.modifiers).toContainEqual({
        name: "defaultMinSize",
        args: [{ minWidth: 48, minHeight: 48 }],
      });
    expect(buttons[0].props.modifiers).toContainEqual({
      name: "semantics",
      args: [{ contentDescription: "Remove a pair of 25 kg plates" }],
    });
    expect(buttons[1].props.modifiers).toContainEqual({
      name: "semantics",
      args: [{ contentDescription: "Add a pair of 25 kg plates" }],
    });
  },
);
it("keeps one Android Back registration while reading the latest dialog, details and tab", async () => {
  const registration = vi.spyOn(BackHandler, "addEventListener");
  await act(async () => {
    renderer = create(<App />);
  });
  expect(registration).toHaveBeenCalledOnce();
  const back = registration.mock.calls[0][1] as () =>
    boolean | null | undefined;
  let handled: boolean | null | undefined;
  await act(async () => {
    handled = back();
  });
  expect(handled).toBe(false);
  await act(async () => host("NavigationBarItem", "History").props.onClick());
  // Native LazyColumn rows expose their click action through a modifier.
  const row = renderer.root.findAll(
    (node) =>
      String(node.type) === "Column" &&
      node.props.modifiers?.some(
        (m: any) =>
          m.name === "semantics" &&
          m.args[0].contentDescription?.startsWith("Open workout"),
      ),
  )[0];
  await act(async () =>
    row.props.modifiers.find((m: any) => m.name === "clickable").args[0](),
  );
  await press("Delete workout");
  expect(host("AlertDialog")).toBeDefined();
  await act(async () => {
    handled = back();
  });
  expect(handled).toBe(true);
  expect(host("AlertDialog")).toBeUndefined();
  expect(host("Text", "Details")).toBeDefined();
  await act(async () => {
    handled = back();
  });
  expect(handled).toBe(true);
  expect(host("Text", "1 saved workout")).toBeDefined();
  await act(async () => {
    handled = back();
  });
  expect(handled).toBe(true);
  expect(host("NavigationBarItem", "Train").props.selected).toBe(true);
  expect(registration).toHaveBeenCalledOnce();
});
it("shows repeated notices imperatively without a React commit", async () => {
  await act(async () => {
    renderer = create(<App />);
  });
  const rendered = vi.fn();
  globalThis.__FIVEFOLD_RENDER__ = rendered;
  notify("Ready");
  notify("Ready");
  expect(nativeCalls.showSnackbar).toHaveBeenCalledTimes(2);
  expect(nativeCalls.showSnackbar).toHaveBeenLastCalledWith({
    message: "Ready",
    withDismissAction: true,
    duration: "long",
  });
  expect(rendered).not.toHaveBeenCalled();
  delete globalThis.__FIVEFOLD_RENDER__;
});
it("syncs only output-related slices and ignores notes and unrelated settings", async () => {
  const widget = vi.spyOn(surfaces, "syncWidget");
  const notification = vi.spyOn(surfaces, "syncWorkoutNotification");
  const rest = vi.spyOn(notifications, "syncRestAlert");
  await act(async () => {
    renderer = create(<App />);
  });
  widget.mockClear();
  notification.mockClear();
  rest.mockClear();
  await act(async () => {
    commit((s) => setNotes(s, "a"));
    actions.updateSettings({ haptics: false });
  });
  expect(widget).not.toHaveBeenCalled();
  expect(notification).not.toHaveBeenCalled();
  expect(rest).not.toHaveBeenCalled();
  await act(async () => {
    actions.deleteWorkout(savedState().history[0].id);
  });
  expect(widget).not.toHaveBeenCalled();
  expect(notification).not.toHaveBeenCalled();
  expect(rest).not.toHaveBeenCalled();
  await act(async () => {
    actions.saveWeight("deadlift", 60, 5);
  });
  expect(widget).toHaveBeenCalledOnce();
  expect(notification).not.toHaveBeenCalled();
  expect(rest).not.toHaveBeenCalled();
  widget.mockClear();
  await act(async () => {
    actions.recordSet("squat", 0, 5);
  });
  expect(widget).toHaveBeenCalledOnce();
  expect(notification).toHaveBeenCalledOnce();
  expect(rest).toHaveBeenCalledOnce();
  widget.mockClear();
  notification.mockClear();
  rest.mockClear();
  await act(async () => {
    actions.extendRest();
  });
  expect(widget).not.toHaveBeenCalled();
  expect(notification).toHaveBeenCalledOnce();
  expect(rest).toHaveBeenCalledOnce();
});
it("preserves note expansion across discard and a subsequent workout", async () => {
  await act(async () => {
    renderer = create(<App />);
  });
  await press("Add note");
  await act(async () => host("OutlinedTextField").props.onValueChange("a"));
  await press("Discard");
  await press("Discard workout");
  await press("Start workout B");
  expect(host("OutlinedTextField")).toBeDefined();
  expect(savedState().active?.notes).toBe("");
});

it("commits a supplied inventory through the stable action without changing workout data", async () => {
  const before = savedState();
  const plates = defaultPlateInventory();
  plates.kg[6] = 0;
  await act(async () => {
    expect(actions.setPlateInventory(plates)).toBe(true);
  });
  expect(savedState()).toEqual({
    ...before,
    settings: { ...before.settings, plates },
  });
});
