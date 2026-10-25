import { clock } from "./format";
import {
  NAMES,
  ROUTINE,
  formatWeight,
  loggedSets,
  totalSets,
  weeklyCount,
  type AppState,
  type Session,
} from "./workout";

/** Next unlogged set, e.g. "Squat · Set 2/5", or "All sets logged". */
export function nextSetLabel(session: Session | null) {
  const next = session?.exercises.find((e) => e.sets.some((r) => r === null));

  return next
    ? `${NAMES[next.lift]} · Set ${next.sets.findIndex((r) => r === null) + 1}/${next.sets.length}`
    : "All sets logged";
}

/** Props for the home-screen widget: the active workout, or the next one. */
export function widgetProps(state: AppState, now = new Date()) {
  const { active } = state;

  if (active) {
    return {
      eyebrow: "Workout in progress",
      title: `Workout ${active.kind}`,
      progress: loggedSets(active) / totalSets(active),
      lifts: active.exercises.map((e) => ({
        name: NAMES[e.lift],
        detail: `${formatWeight(e.weight)} ${active.unit} · ${e.sets.filter((r) => r !== null).length}/${e.sets.length}`,
      })),
      footer: `Next: ${nextSetLabel(active)}`,
    };
  }

  return {
    eyebrow: "Next workout",
    title: `Workout ${state.next}`,
    progress: -1,
    lifts: ROUTINE[state.next].map((lift) => ({
      name: NAMES[lift],
      detail: `${formatWeight(state.plans[lift].weight)} ${state.settings.unit} · ${lift === "deadlift" ? "1×5" : "5×5"}`,
    })),
    footer: `${weeklyCount(state.history, now)} / 3 workouts this week`,
  };
}

/** Props for the ongoing workout notification; null when no workout is active. */
export function notificationProps(state: AppState, now = Date.now()) {
  const { active, rest } = state;

  if (!active) {
    return null;
  }

  const next = nextSetLabel(active);

  return {
    title: `Workout ${active.kind} · ${loggedSets(active)}/${totalSets(active)} sets`,
    status:
      rest && rest.endsAt > now
        ? `Rest until ${clock(rest.endsAt)} · Next: ${next}`
        : active.exercises.every((e) => e.sets.every((r) => r !== null))
          ? "All sets logged · Tap to finish"
          : `Next: ${next}`,
    progress: loggedSets(active) / totalSets(active),
  };
}
