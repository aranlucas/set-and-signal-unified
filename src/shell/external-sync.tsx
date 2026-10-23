import { useEffect } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { getSnapshot, useAppState } from "../data/store";
import { notify } from "../data/notices";
import { syncRestAlert } from "../data/notifications";
import { syncWidget, syncWorkoutNotification } from "../data/surfaces";
import { loggedSets } from "../domain/workout";
import { nextSetLabel } from "../domain/surfaces";

export function ExternalSync() {
  const rest = useAppState((s) => s.rest);
  const alerts = useAppState((s) => s.settings.restAlerts);
  const hasActiveWorkout = useAppState((s) => s.active !== null);
  const keepAwake = useAppState((s) => s.settings.keepAwake);
  const exercises = useAppState((s) => s.active?.exercises);
  const kind = useAppState((s) => s.active?.kind);
  const unit = useAppState((s) => s.active?.unit ?? s.settings.unit);
  const next = useAppState((s) => (s.active ? null : s.next));
  const plans = useAppState((s) => (s.active ? null : s.plans));
  const history = useAppState((s) => (s.active ? null : s.history));
  const notificationKind = useAppState((s) => (s.settings.restAlerts ? s.active?.kind : undefined));

  const notificationLogged = useAppState((s) =>
    s.settings.restAlerts && s.active ? loggedSets(s.active) : 0,
  );

  const notificationNext = useAppState((s) =>
    s.settings.restAlerts ? nextSetLabel(s.active) : "",
  );

  const notificationDeadline = useAppState((s) =>
    s.settings.restAlerts ? s.rest?.endsAt : undefined,
  );

  useEffect(() => {
    syncRestAlert(rest, alerts, () => notify("Couldn't schedule rest alerts."));
  }, [rest, alerts]);
  useEffect(() => {
    syncWidget(getSnapshot().state);
  }, [exercises, kind, unit, next, plans, history]);
  useEffect(() => {
    syncWorkoutNotification(getSnapshot().state, alerts);
  }, [notificationKind, notificationLogged, notificationNext, notificationDeadline, alerts]);
  useEffect(() => {
    if (hasActiveWorkout && keepAwake) {
      void activateKeepAwakeAsync("fivefold-workout").catch(() => {});
    } else {
      void deactivateKeepAwake("fivefold-workout").catch(() => {});
    }

    return () => {
      void deactivateKeepAwake("fivefold-workout").catch(() => {});
    };
  }, [hasActiveWorkout, keepAwake]);

  return null;
}
