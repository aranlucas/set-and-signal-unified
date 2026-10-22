import * as Notifications from "expo-notifications";
import { NAMES, type Rest } from "../domain/workout";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
const channel = "rest";
export async function enableRestAlerts(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync(channel, {
    name: "Rest timer",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 200, 100, 200],
  });
  const status = await Notifications.requestPermissionsAsync();
  return status.granted;
}
let queue = Promise.resolve();
export function syncRestAlert(
  rest: Rest | null,
  enabled: boolean,
  onError: () => void,
) {
  // Serialize cancellation/scheduling so a quick second tap cannot leave a stale alert.
  queue = queue
    .then(async () => {
      await Notifications.cancelScheduledNotificationAsync("fivefold-rest");
      if (!enabled || !rest || rest.endsAt <= Date.now()) return;
      await Notifications.scheduleNotificationAsync({
        identifier: "fivefold-rest",
        content: {
          title: "Ready for your next set",
          body: `${NAMES[rest.lift]} · Take a breath, brace, and lift.`,
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: rest.endsAt,
          channelId: channel,
          // setAlarmClock() is not deferred by Doze or OEM battery savers, so the
          // alert lands when the in-app countdown hits zero. Falls back to best
          // effort if the exact-alarm permission is unavailable.
          delivery: "alarmClock",
        },
      });
    })
    .catch(onError);
}
