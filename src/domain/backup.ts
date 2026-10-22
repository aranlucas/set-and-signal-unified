import {
  type AppState,
  LIFTS,
  ROUTINE,
  maxWeight,
  maxBarWeight,
  type Session,
} from "./workout";

const finite = (x: unknown, min: number, max: number): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const bool = (x: unknown) => typeof x === "boolean";
function validSession(s: any, finished: boolean): s is Session {
  return (
    s &&
    typeof s.id === "string" &&
    s.id.length < 150 &&
    (s.kind === "A" || s.kind === "B") &&
    finite(s.startedAt, 1, 8.64e15) &&
    (finished
      ? finite(s.finishedAt, s.startedAt, 8.64e15)
      : s.finishedAt === null) &&
    (s.unit === "kg" || s.unit === "lb") &&
    typeof s.notes === "string" &&
    s.notes.length <= 2000 &&
    Array.isArray(s.exercises) &&
    s.exercises.length === 3 &&
    s.exercises.every(
      (e: any, i: number) =>
        e &&
        e.lift === ROUTINE[s.kind as "A" | "B"][i] &&
        finite(e.weight, 0, maxWeight(s.unit)) &&
        Array.isArray(e.sets) &&
        e.sets.length === (e.lift === "deadlift" ? 1 : 5) &&
        e.sets.every(
          (r: unknown) =>
            r === null || (finite(r, 0, 5) && Number.isInteger(r)),
        ),
    )
  );
}
export function parseBackup(text: string): AppState {
  if (text.length > 20_000_000)
    throw new Error("This backup is too large (maximum 20 MB).");
  let s: any;
  try {
    s = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON. Choose a Fivefold backup.");
  }
  const settings = s?.settings;
  if (
    !s ||
    s.version !== 1 ||
    !bool(s.onboarded) ||
    !["A", "B"].includes(s.next) ||
    !settings ||
    !["kg", "lb"].includes(settings.unit) ||
    !finite(settings.bar, 1, maxBarWeight(settings.unit)) ||
    !finite(settings.restSeconds, 15, 600) ||
    !finite(settings.failedRestSeconds, 15, 600) ||
    !["system", "light", "dark"].includes(settings.theme) ||
    !["autoProgress", "autoDeload", "haptics", "keepAwake", "restAlerts"].every(
      (k) => bool(settings[k]),
    ) ||
    !LIFTS.every(
      (l) =>
        s.plans?.[l] &&
        finite(s.plans[l].weight, 0, maxWeight(settings.unit)) &&
        finite(s.plans[l].increment, 0.25, 50) &&
        Number.isInteger(s.plans[l].failures) &&
        finite(s.plans[l].failures, 0, 10000),
    ) ||
    !(
      s.active === null ||
      (validSession(s.active, false) && s.active.unit === settings.unit)
    ) ||
    !Array.isArray(s.history) ||
    s.history.length > 20000 ||
    !s.history.every((h: unknown) => validSession(h, true)) ||
    new Set(s.history.map((h: Session) => h.id)).size !== s.history.length ||
    (s.active && s.history.some((h: Session) => h.id === s.active.id)) ||
    !(
      s.rest === null ||
      (s.rest &&
        s.active &&
        s.active.exercises.some((e: any) => e.lift === s.rest.lift) &&
        Number.isInteger(s.rest.setIndex) &&
        finite(s.rest.setIndex, 0, s.rest.lift === "deadlift" ? 0 : 4) &&
        finite(s.rest.endsAt, 1, 8.64e15) &&
        finite(s.rest.duration, 15, 3600))
    )
  ) {
    throw new Error(
      "This is not a supported Fivefold backup. Your current data has not been changed.",
    );
  }
  return s as AppState;
}
