import { validPlateInventory } from "./plates";
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
const unsupportedState = "This isn't a Fivefold backup.";
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
function validSession(s: unknown, finished: boolean): s is Session {
  return (
    record(s) &&
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
      (e: unknown, i: number) =>
        record(e) &&
        e.lift === ROUTINE[s.kind as "A" | "B"][i] &&
        finite(e.weight, 0, maxWeight(s.unit as "kg" | "lb")) &&
        Array.isArray(e.sets) &&
        e.sets.length === (e.lift === "deadlift" ? 1 : 5) &&
        e.sets.every(
          (r: unknown) =>
            r === null || (finite(r, 0, 5) && Number.isInteger(r)),
        ),
    )
  );
}
// Local storage shares the schema checks, but not external-import resource limits.
export function validateState(value: unknown): AppState {
  const s = value as AppState | null | undefined;
  const settings = s?.settings;
  if (
    !s ||
    s.version !== 1 ||
    !bool(s.onboarded) ||
    !["A", "B"].includes(s.next) ||
    !settings ||
    !["kg", "lb"].includes(settings.unit) ||
    !(
      settings.plates === undefined ||
      settings.plates === null ||
      validPlateInventory(settings.plates)
    ) ||
    !finite(settings.bar, 1, maxBarWeight(settings.unit)) ||
    !finite(settings.restSeconds, 15, 600) ||
    !finite(settings.failedRestSeconds, 15, 600) ||
    !["system", "light", "dark"].includes(settings.theme) ||
    !(
      [
        "autoProgress",
        "autoDeload",
        "haptics",
        "keepAwake",
        "restAlerts",
      ] as const
    ).every((k) => bool(settings[k])) ||
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
    !s.history.every((h: unknown) => validSession(h, true)) ||
    new Set(s.history.map((h: Session) => h.id)).size !== s.history.length ||
    (s.active && s.history.some((h: Session) => h.id === s.active?.id)) ||
    !(
      s.rest === null ||
      (s.rest &&
        s.active &&
        s.active.exercises.some((e) => e.lift === s.rest?.lift) &&
        Number.isInteger(s.rest.setIndex) &&
        finite(s.rest.setIndex, 0, s.rest.lift === "deadlift" ? 0 : 4) &&
        finite(s.rest.endsAt, 1, 8.64e15) &&
        finite(s.rest.duration, 15, 3600))
    )
  ) {
    throw new Error(unsupportedState);
  }
  return settings.plates === undefined
    ? { ...s, settings: { ...settings, plates: null } }
    : s;
}
export function parseBackup(text: string): AppState {
  if (text.length > 20_000_000)
    throw new Error("This backup is too large (maximum 20 MB).");
  let s: unknown;
  try {
    s = JSON.parse(text);
  } catch {
    throw new Error("This isn't a Fivefold backup.");
  }
  if (record(s) && Array.isArray(s.history) && s.history.length > 20000)
    throw new Error(unsupportedState);
  return validateState(s);
}
