import * as Notifications from "expo-notifications";
import { notificationProps, widgetProps } from "../domain/surfaces";
import { type AppState } from "../domain/workout";
import { workoutWidget } from "../widgets/WorkoutWidget";
import { WorkoutNotification } from "../widgets/WorkoutNotification";

let lastWidget = "";
/** Mirrors the next/active workout onto the home-screen widget. */
export function syncWidget(state: AppState) {
  const props = widgetProps(state);
  const key = JSON.stringify(props);
  if (key === lastWidget) return;
  try {
    workoutWidget.updateSnapshot(props);
    lastWidget = key;
  } catch {
    // A widget is optional; the app never depends on it.
  }
}

const channelId = "workout";
const id = "fivefold-workout";
let channel: Promise<unknown> | undefined;
let queue = Promise.resolve();
let lastNotification = "";
let restEnded: ReturnType<typeof setTimeout> | undefined;
/** Keeps an ongoing, silent workout notification in sync with the session. */
export function syncWorkoutNotification(state: AppState, enabled: boolean) {
  // Swap "Rest until…" for the next set when the deadline passes.
  clearTimeout(restEnded);
  const left = (state.rest?.endsAt ?? 0) - Date.now();
  if (enabled && left > 0)
    restEnded = setTimeout(
      () => syncWorkoutNotification(state, enabled),
      left + 50,
    );
  const props = enabled ? notificationProps(state) : null;
  const key = JSON.stringify(props);
  if (key === lastNotification) return;
  lastNotification = key;
  // Serialized like rest alerts so a quick tap sequence can't reorder posts.
  queue = queue
    .then(async () => {
      if (!props) {
        await WorkoutNotification.cancelAll();
        return;
      }
      channel ??= Notifications.setNotificationChannelAsync(channelId, {
        name: "Workout in progress",
        importance: Notifications.AndroidImportance.LOW,
        showBadge: false,
      });
      await channel;
      // Posting with the same id replaces the notification in place.
      await WorkoutNotification.post(props, {
        id,
        channelId,
        ongoing: true,
        title: props.title,
        text: props.status,
        color: "#216B53",
      });
    })
    .catch(() => {
      // Retry on the next change, e.g. after notifications are re-enabled.
      lastNotification = "";
    });
}
