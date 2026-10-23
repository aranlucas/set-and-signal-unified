import { vi } from "vitest";
import { createSqliteAdapter } from "../support/sqlite";
import type { DocumentPickerOptions } from "expo-document-picker";
import type { SharingOptions } from "expo-sharing";
import type {
  NotificationChannelInput,
  NotificationHandler,
  NotificationRequestInput,
} from "expo-notifications";
import type {
  CustomNotificationComponent,
  CustomNotificationOptions,
  WidgetEnvironment,
} from "expo-widgets";
import type { ReactElement } from "react";

const sqliteAdapter = createSqliteAdapter().database;

export function openDatabaseSync(_name: string) {
  return sqliteAdapter;
}

export interface SnackbarMessage {
  message: string;
  withDismissAction: boolean;
  duration: "long" | "short";
}

export const nativeCalls = {
  showSnackbar: vi.fn((_message: SnackbarMessage) => Promise.resolve("dismissed")),
};

type Listener = (...args: unknown[]) => void;

function eventEmitter() {
  const listeners = new Map<string, Set<Listener>>();

  return {
    currentState: "active",
    addEventListener(event: string, listener: Listener) {
      let current = listeners.get(event);

      if (!current) {
        current = new Set<Listener>();
        listeners.set(event, current);
      }

      current.add(listener);

      return { remove: () => current?.delete(listener) };
    },
  };
}

const windowDimensions = { width: 411, height: 731, scale: 2.625, fontScale: 1 };

export const BackHandler = eventEmitter();

export const AppState = eventEmitter();

export function useWindowDimensions() {
  return windowDimensions;
}

export const StatusBar = "StatusBar";

export const AndroidHaptics = {
  Toggle_Off: "off",
  Confirm: "confirm",
  Reject: "reject",
};

export const NotificationFeedbackType = { Success: "success" };

export function performAndroidHapticsAsync() {
  return Promise.resolve();
}

export function notificationAsync() {
  return Promise.resolve();
}

export function activateKeepAwakeAsync() {
  return Promise.resolve();
}

export function deactivateKeepAwake() {
  return Promise.resolve();
}

export function setNotificationHandler(_handler: NotificationHandler | null): void {}

export function setNotificationChannelAsync(channel: string, _settings: NotificationChannelInput) {
  return Promise.resolve({ id: channel });
}

export function requestPermissionsAsync() {
  return Promise.resolve({ granted: true });
}

export function cancelScheduledNotificationAsync(_identifier: string) {
  return Promise.resolve();
}

export function scheduleNotificationAsync(_request: NotificationRequestInput) {
  return Promise.resolve("test-notification");
}

export const AndroidImportance = { HIGH: 4, LOW: 2 };

export const SchedulableTriggerInputTypes = { DATE: "date" };

export function isAvailableAsync() {
  return Promise.resolve(true);
}

export function shareAsync(_uri: string, _options?: SharingOptions) {
  return Promise.resolve();
}

export function getDocumentAsync(_options?: DocumentPickerOptions) {
  return Promise.resolve({ canceled: true as const });
}

interface WidgetAdapter<Props extends object> {
  updateSnapshot(snapshot: Props): void;
}

function widgetAdapter<Props extends object>(): WidgetAdapter<Props> {
  return {
    updateSnapshot(_snapshot: Props) {},
  };
}

export function createWidget<
  Props extends object = object,
  Configuration extends object | undefined = undefined,
>(
  _name: string,
  _render: (props: Props, context: WidgetEnvironment<Configuration>) => ReactElement,
  _initialProps?: Props,
) {
  return widgetAdapter<Props>();
}

export function createCustomNotification<Props extends object = object>(
  _name: string,
  _render: CustomNotificationComponent<Props>,
) {
  return {
    post(_content: Props, _options?: CustomNotificationOptions) {
      return Promise.resolve();
    },
    cancelAll() {
      return Promise.resolve();
    },
  };
}
