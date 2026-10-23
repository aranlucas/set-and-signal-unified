import {
  createElement,
  Fragment,
  isValidElement,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import { vi } from "vitest";

const nativeCalls = vi.hoisted(() => ({
  showSnackbar: vi.fn(async () => "dismissed"),
}));

vi.mock("../../src/data/storage", () => import("./storage"));
vi.mock("@expo/ui/jetpack-compose", () => {
  const names = [
    "AlertDialog",
    "Button",
    "Card",
    "Column",
    "FilledTonalButton",
    "FilterChip",
    "FlowRow",
    "HorizontalDivider",
    "Host",
    "Icon",
    "IconButton",
    "LazyColumn",
    "LinearProgressIndicator",
    "ListItem",
    "ModalBottomSheet",
    "NavigationBar",
    "NavigationBarItem",
    "OutlinedTextField",
    "Row",
    "SegmentedButton",
    "SingleChoiceSegmentedButtonRow",
    "Spacer",
    "Switch",
    "Text",
    "TextButton",
    "TopAppBar",
  ];
  const slots: Record<string, string[]> = {
    TopAppBar: ["Title", "NavigationIcon", "Actions"],
    NavigationBarItem: ["Icon", "Label"],
    ListItem: ["HeadlineContent", "SupportingContent", "TrailingContent"],
    AlertDialog: ["Title", "Text", "ConfirmButton", "DismissButton"],
    OutlinedTextField: ["Label", "Suffix", "SupportingText"],
    SegmentedButton: ["Label"],
    FilterChip: ["Label"],
  };
  // Compound controls forward to named host nodes and retain their slots.
  const controls: Record<string, any> = Object.fromEntries(
    names.map((name) => [
      name,
      slots[name] || name === "LazyColumn"
        ? Object.assign(
            ({ children, ...props }: any) =>
              createElement(name, props, children),
            Object.fromEntries(
              (slots[name] ?? []).map((slot) => [slot, `${name}.${slot}`]),
            ),
          )
        : name,
    ]),
  );
  // Expo UI only collects strings, numbers and nested Text spans.
  function validateTextChildren(children: unknown): void {
    if (
      children == null ||
      typeof children === "boolean" ||
      typeof children === "string" ||
      typeof children === "number"
    )
      return;
    if (Array.isArray(children)) {
      children.forEach(validateTextChildren);
      return;
    }
    if (isValidElement<{ children?: ReactNode }>(children)) {
      if (children.type === Text) {
        validateTextChildren(children.props.children);
        return;
      }
      const type = children.type;
      const name =
        type === Fragment
          ? "Fragment"
          : typeof type === "function"
            ? type.name || "Anonymous"
            : String(type);
      throw new Error(
        `Unsupported child element of type "${name}" inside <Text>`,
      );
    }
    throw new Error(
      `Unsupported child of type "${typeof children}" inside <Text>`,
    );
  }
  function Text({ children, ...props }: { children?: ReactNode }) {
    validateTextChildren(children);
    return createElement("Text", props, children);
  }
  controls.Text = Text;
  controls.LazyColumn.Items = ({ data, children, keyExtractor }: any) =>
    createElement(
      "LazyColumn.Items",
      {},
      data.map((item: any, index: number) =>
        createElement(
          "LazyColumn.Item",
          { key: keyExtractor(item, index) },
          children({ item, index }),
        ),
      ),
    );
  const colors = Object.fromEntries(
    [
      "background",
      "primary",
      "onPrimary",
      "primaryContainer",
      "onPrimaryContainer",
      "secondaryContainer",
      "surfaceContainerLow",
      "surfaceContainerHighest",
      "onSurface",
      "onSurfaceVariant",
      "outlineVariant",
      "error",
      "errorContainer",
      "onErrorContainer",
    ].map((name) => [name, `color-${name}`]),
  );
  return {
    ...controls,
    useMaterialColors: () => colors,
    useNativeState: (initial: unknown) =>
      useState(() => {
        const state = {
          value: initial,
          get: () => state.value,
          set: (value: unknown) => {
            state.value = value;
          },
        };
        return state;
      })[0],
    SnackbarHost: ({ ref, ...props }: any) => {
      useImperativeHandle(
        ref,
        () => ({ showSnackbar: nativeCalls.showSnackbar }),
        [],
      );
      return createElement("SnackbarHost", props);
    },
  };
});
vi.mock("@expo/ui/jetpack-compose/modifiers", () => {
  const names = [
    "background",
    "fillMaxSize",
    "fillMaxWidth",
    "verticalScroll",
    "paddingAll",
    "padding",
    "clip",
    "weight",
    "size",
    "defaultMinSize",
    "semantics",
    "height",
    "width",
    "clickable",
    "toggleable",
    "selectableGroup",
  ];
  const modifier =
    (name: string) =>
    (...args: unknown[]) => ({ name, args });
  return {
    ...Object.fromEntries(names.map((name) => [name, modifier(name)])),
    Shapes: { RoundedCorner: modifier("RoundedCorner") },
  };
});
vi.mock("react-native", () => {
  const emitter = () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    return {
      currentState: "active",
      addEventListener: (event: string, listener: (...args: any[]) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
        return { remove: () => listeners.get(event)!.delete(listener) };
      },
    };
  };
  // A 411 dp phone, so content uses the 16 dp gutter.
  const window = { width: 411, height: 731, scale: 2.625, fontScale: 1 };
  return {
    BackHandler: emitter(),
    AppState: emitter(),
    useWindowDimensions: () => window,
  };
});
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
vi.mock("expo-haptics", () => ({
  performAndroidHapticsAsync: async () => {},
  notificationAsync: async () => {},
  AndroidHaptics: { Toggle_Off: "off", Confirm: "confirm", Reject: "reject" },
  NotificationFeedbackType: { Success: "success" },
}));
vi.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: async () => {},
  deactivateKeepAwake: async () => {},
}));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  requestPermissionsAsync: async () => ({ granted: true }),
  cancelScheduledNotificationAsync: async () => {},
  scheduleNotificationAsync: async () => {},
  AndroidImportance: { HIGH: 4, LOW: 2 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
vi.mock("expo-sharing", () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => {},
}));
vi.mock("expo-document-picker", () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}));
vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { cache: "cache" },
}));
vi.mock("expo-widgets", () => {
  const surface = () => ({
    updateSnapshot: () => {},
    post: async () => {},
    cancelAll: async () => {},
  });
  return { createWidget: surface, createCustomNotification: surface };
});

export { nativeCalls };
