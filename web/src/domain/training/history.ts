// Pure helpers over the app state (ported 1:1 from the vanilla app).
import { isoOf, weekKey, fmtNum } from "@/shared/lib/format.js";
import { isBarbellEq, isCardio, isBodyweightEq } from "@/domain/exercises/exercise-metadata.js";
import { barWeightFor } from "@/domain/training/plates.js";
import { translate } from "@/i18n/translate.js";
import type {
  ActiveWorkout,
  AppState,
  BodyweightEntry,
  EffortKind,
  EffortScale,
  ExConfig,
  Id,
  IsoDate,
  LoggedSet,
  Mode,
  RepsSet,
  TimeSet,
  CardioSet,
  PlateSetup,
  Unit,
} from "@/shared/lib/types.js";

type EffortOfProps = { effort?: EffortScale | null };

type CleanupSgResult = { sg?: string };

type SessionLoadProps = { sets?: SetFields[]; target?: AnyConfig | null; topW?: number | null };

type LastEntryForProps = { workouts: WorkoutLike[] };

type BestWeightForProps = { workouts: WorkoutLike[] };

type BuildSetsProps = {
  workouts: WorkoutLike[];
  exWeights?: Record<string, { w?: number; d?: IsoDate }>;
  unit?: Unit;
  plates?: PlateSetup | null;
};

type SupersetUnitsProps = { sg?: string };

type StreakWeeksProps = { workouts: WorkoutLike[] };

// Configs arrive from plans, workouts, backups and tests where `mode` may be any string;
// the valid values are picked off and everything else falls back to the body part.
export type AnyConfig = Partial<Omit<ExConfig, "mode">> & { mode?: string };

// Plans, workouts, backups and CSV imports predate the LoggedSet union; reading a
// cross-mode field off one is what the original did (it reads as undefined → falsy).
export type SetFields = Partial<Omit<RepsSet & TimeSet & CardioSet, "rir" | "rpe" | "wu">> & {
  rir?: number | null; // null tolerated on read (cleared = key dropped)
  rpe?: number | null;
  wu?: boolean;
};

// Structural view of a workout for the pure helpers: older histories lack `topW`/`target`,
// and tests drive these helpers with minimal literals.
export interface WorkoutLike {
  id?: string;
  progressionApplied?: string[];
  d: IsoDate;
  entries: Array<{
    id: Id;
    sets: SetFields[];
    topW?: number | null;
    target?: AnyConfig | null;
  }>;
}

// How an exercise is logged (issue #16). This used to be derived from the body part alone,
// which meant a plank or a farmer's carry could only be timed by filing it under cardio.
// A routine entry can now say so explicitly:
//   reps   — weight × reps      sets look like { w, r }
//   time   — a work duration    sets look like { sec, w }   (w = 0 for bodyweight)
//   cardio — duration + speed   sets look like { min, speed }
// An entry without `mode` behaves exactly as before, so every existing plan, workout and
// plan file is read unchanged and nothing needs migrating.
export function modeOf(cfg?: AnyConfig | null): Mode {
  const modeValue = cfg?.mode;

  if (modeValue === "reps" || modeValue === "time" || modeValue === "cardio") {
    return modeValue;
  }

  return isCardio(cfg?.id) ? "cardio" : "reps";
}

export const isTimed = (cfg: AnyConfig | null | undefined) => modeOf(cfg) === "time";

// Two flags that ride on top of a mode rather than making new ones (issues #31/#32), because
// "bodyweight" and "per side" are true of a rep set and of a timed hold alike:
//   bodyweight — the exercise carries no load of its own, so `w` means *added* weight and is
//                asked for only once you say there is some. Seeded from the equipment field.
//                Spelled out rather than `bw`, which a workout already uses for the weigh-in
//                it was logged at — two different things one letter apart is a bug waiting.
//   side       — the exercise is unilateral. You still log what you did: 16, the total across
//                both sides. The split is derived for planning ("8 per side"), never entered
//                — a number that sometimes means one side and sometimes both is the thing
//                that made this ambiguous in the first place, and one rep count that always
//                means the same thing beats two that need a legend.
// Both are absent on every plan, workout and backup written before they existed, and absent
// reads as false, so nothing needs migrating.
export const isBw = (cfg: AnyConfig | null | undefined) =>
  cfg?.bodyweight != null ? cfg.bodyweight : isBodyweightEq(cfg?.id);

export const isPerSide = (cfg: AnyConfig | null | undefined) => !!cfg?.side;

// What one side did, for display only. Half of an odd total is shown as it falls (8.5) rather
// than rounded away: it means the sides were not even, which is worth seeing.
export const sideReps = (reps: number | null | undefined) => (reps || 0) / 2;

// Unilateral work moves in pairs, so its rep target steps by two — 16, 18, 20 — and a total
// that stayed odd would put a rep on one side and not the other.
export const repStep = (cfg: AnyConfig | null | undefined) => (isPerSide(cfg) ? 2 : 1);

// mm:ss for a work duration — seconds alone read badly past a minute ("90 s" vs "1:30").
export function fmtSec(sec?: number | null): string {
  const n = Math.max(0, Math.round(Number(sec) || 0));

  return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
}

// How hard a set felt, if the profile logs it at all. Two scales for the same thing, kept in
// their own fields: RIR counts the reps still in the tank, RPE reads the same effort off a
// 10-point scale from the top (RPE 8 ≈ RIR 2). A set logged on one scale is never silently
// rewritten as the other — switching the setting changes what new sets ask for, nothing else.
// `min`..`max` is the range the stepper walks. RIR bottoms out at 0 (a set taken to failure);
// RPE bottoms out at 6, since the scale is only meaningful for working sets and anything
// lighter is a warm-up nobody rates.
export interface EffortDef {
  f: "rir" | "rpe";
  hd: string;
  step: number;
  min: number;
  max: number;
}

export const EFFORT: Record<EffortKind, EffortDef> = {
  rir: { f: "rir", hd: "RIR", step: 0.5, min: 0, max: 10 },
  rpe: { f: "rpe", hd: "RPE", step: 0.5, min: 6, max: 10 },
};

// One tap of an effort stepper. Empty is not 0 — an unlogged effort must not become "went to
// failure" from one stray tap — so − on an empty cell leaves it empty, and + starts at the
// bottom of the scale and walks up from there in even steps. Stepping back off the bottom
// clears the cell again, so a mistap is undoable. null means "nothing logged"; the caller
// stores that by dropping the key rather than writing a null.
export function stepEffort(
  kind: EffortScale | undefined,
  cur: number | null | undefined,
  dir: number,
): number | null {
  const scale = kind && kind !== "none" ? EFFORT[kind] : null;

  if (!scale) {
    return cur ?? null;
  }

  if (cur == null) {
    return dir < 0 ? null : scale.min;
  }

  const nextValue = Math.round((cur + dir * scale.step) * 100) / 100;

  if (dir < 0 && nextValue < scale.min) {
    return null;
  }

  // only the ceiling is enforced on the way up: a value typed below the floor (nothing stops
  // someone entering RPE 3) still steps in even increments instead of snapping to the floor.
  return dir > 0 ? Math.min(scale.max, nextValue) : Math.max(scale.min, nextValue);
}

// A typed effort is capped but not floored — clamping up while someone types "10" would turn
// the first keystroke into the floor and fight the input.
export const capEffort = (kind: EffortScale | undefined, v?: number | null) =>
  v == null || !kind || kind === "none" ? v : Math.min(EFFORT[kind].max, v);

/** The configured scale, or no effort column until a scale is chosen. */
export const effortOf = (profile?: EffortOfProps | null): EffortScale => profile?.effort ?? "none";

// The "(RIR 2)" / "(RPE 8)" tail on a set summary, empty when nothing was logged.
const effortTail = (s: SetFields): string => {
  const k = s.rir == null ? (s.rpe != null ? "rpe" : null) : "rir";
  const v = k && (k === "rir" ? s.rir : s.rpe);

  return k && v != null ? ` (${EFFORT[k].hd} ${fmtNum(v)})` : "";
};

// One-line summary of a logged set. `cfg` carries the mode when the caller has it (a routine
// entry or a workout entry); passing an id alone keeps the old body-part behaviour.
export function setLabel(id: Id, s: SetFields, cfg?: AnyConfig | null): string {
  const config = cfg || { id };
  const mode = modeOf(config);
  // A warm-up says what it is right in the label — in the recap and in history it must
  // never read as a working set.
  const wu = isWarmup(s) ? "WU " : "";

  if (mode === "cardio") {
    return `${wu}${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h`;
  }

  const weight = s.w || 0;

  if (mode === "time") {
    return wu + fmtSec(s.sec) + (weight > 0 ? ` · ${fmtNum(weight)}` : "");
  }

  // Bodyweight reads as what you did — "12", or "+10 × 12" once there is a belt involved —
  // rather than "0×12", which says a set was performed with no weight and means nothing.
  // A per-side set needs no mark here: the number logged is the total, the same as every
  // other set in the app.
  const reps = s.r || 0;

  if (isBw({ ...config, id: config.id ?? id })) {
    const load = weight > 0 ? `+${fmtNum(weight)} × ` : "";

    return `${wu}${load}${reps}` + effortTail(s);
  }

  return `${wu}${fmtNum(weight)}×${reps}` + effortTail(s);
}

// Default config for a freshly added exercise.
export function defaultConfig(id: Id, mode?: Mode, barWeight = 0): Omit<ExConfig, "id"> {
  const resolvedMode = mode || modeOf({ id });

  if (resolvedMode === "cardio") {
    return { sets: 1, min: 20, speed: 8 };
  }

  // Written only when it is true, so a barbell config is byte-for-byte what it was before
  // the flag existed and a plan file gains nothing it does not need.
  const bodyweightDefaults = isBodyweightEq(id) ? { bodyweight: true } : {};
  const startingWeight = isBarbellEq(id) ? Math.max(0, barWeight) : 0;

  if (resolvedMode === "time") {
    return { sets: 3, sec: 45, weight: startingWeight, mode: "time", ...bodyweightDefaults };
  }

  return { sets: 3, reps: 10, weight: startingWeight, mode: "reps", ...bodyweightDefaults };
}

// One-line summary of a planned exercise ("3 × 10 · 60 kg"), shared by the routine editor
// and the plan export so a mode is described the same way everywhere.
export function exLine(cfg: AnyConfig, unit: string): string {
  const mode = modeOf(cfg);
  const n = cfg.sets || 1;
  // Added weight reads as added: "+10 kg" on a dip belt, "60 kg" on a barbell.
  const load = cfg.weight ? " · " + (isBw(cfg) ? "+" : "") + fmtNum(cfg.weight) + " " + unit : "";

  if (mode === "cardio") {
    return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`;
  }

  if (mode === "time") {
    return `${n} × ${fmtSec(cfg.sec || 45)}${load}`;
  }

  // This is the line with room for it, so the split is spelled out: "3 × 16 · 8/side".
  const split = isPerSide(cfg)
    ? " · " +
      translate("exercise.measurement.side", "{{reps}}/side", {
        reps: fmtNum(sideReps(cfg.reps)),
      })
    : "";

  return `${n} × ${String(cfg.reps)}${load}${split}`;
}

// Drop superset ids that no longer have an adjacent partner (after unlink/reorder/remove).
export function cleanupSg<T extends CleanupSgResult>(ex: T[]) {
  for (const [index, exercise] of ex.entries()) {
    if (exercise.sg && !(ex[index - 1]?.sg === exercise.sg || ex[index + 1]?.sg === exercise.sg)) {
      delete exercise.sg;
    }
  }
}

// What lastEntryFor hands back: the confirmed sets of the most recent session that has one,
// plus its prescription (`target`, omitted for imported CSV history).
export interface LastEntry {
  d: IsoDate;
  sets: SetFields[];
  target: AnyConfig | null;
}

// A warm-up set (reps mode only, added by the ramp generator). It is logged so the
// session reads honestly, but it must not count as training: volume, set counters,
// best-weight and progression all skip it. Absent on every set written before the
// generator existed, and absent reads as false.
export const isWarmup = (s: SetFields): boolean => !!s.wu;

const working = <T extends SetFields>(sets: T[]): T[] => sets.filter((s) => !isWarmup(s));

// Working load for one logged entry. Done working sets win; otherwise the confirmed
// top set or the prescription this session started from. A 0 on the bar is missing
// data, not a bodyweight session, so callers can still progress from target.weight.
export function sessionLoad(entry?: SessionLoadProps | null, fallback?: AnyConfig | null): number {
  const loggedSets = (entry?.sets || []).filter((set) => !isWarmup(set));
  const logged = Math.max(0, ...loggedSets.flatMap((set) => (set.done ? [set.w || 0] : [])));

  if (logged > 0) {
    return logged;
  }

  if (entry?.topW && entry.topW > 0) {
    return entry.topW;
  }

  const target = entry?.target || fallback || {};

  const targetWeight = target.weight ?? 0;

  if (targetWeight > 0) {
    return targetWeight;
  }

  return 0;
}

export function lastEntryFor(state: LastEntryForProps, exId: Id): LastEntry | null {
  for (let i = state.workouts.length - 1; i >= 0; i--) {
    // Warm-ups are left out of the recap: "last time" is what you actually worked at.
    const entry = state.workouts[i].entries.find(
      (candidate) =>
        candidate.id === exId && candidate.sets.some((set) => set.done && !isWarmup(set)),
    );

    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    if (entry?.sets?.some((set) => set.done)) {
      return {
        d: state.workouts[i].d,
        sets: working(entry.sets).filter((set) => set.done),
        target: entry.target || null,
      };
    }
  }

  return null;
}

export function bestWeightFor(state: BestWeightForProps, exId: Id): number {
  let bestWeight = 0;

  for (const workout of state.workouts) {
    for (const entry of workout.entries) {
      if (entry.id === exId) {
        bestWeight = entryBestWeight(entry, bestWeight);
      }
    }
  }

  return bestWeight;
}

function entryBestWeight(entry: WorkoutLike["entries"][number], bestWeight: number): number {
  for (const set of entry.sets) {
    if (set.done && (set.w || 0) > bestWeight && !isWarmup(set)) {
      bestWeight = set.w || 0;
    }
  }

  return entry.topW && entry.topW > bestWeight ? entry.topW : bestWeight;
}

// List views can look up every exercise without rescanning history for each row.
export function bestWeightsFor(workouts: WorkoutLike[]): Map<Id, number> {
  const weights = new Map<Id, number>();

  for (const workout of workouts) {
    for (const entry of workout.entries) {
      weights.set(entry.id, entryBestWeight(entry, weights.get(entry.id) ?? 0));
    }
  }

  return weights;
}

export {
  effectiveRoutine,
  effectiveRoutineId,
  effectiveRoutineIds,
  effectiveSessions,
} from "@/domain/training/schedule.js";

export function buildSets(state: BuildSetsProps, cfg: ExConfig): LoggedSet[] {
  const last = lastEntryFor(state, cfg.id);
  const n = Math.max(1, cfg.sets || 1);
  const mode = modeOf(cfg);

  // Last time's set at the same position, falling back to its final set when the plan grew.
  const prevAt = (i: number): SetFields | null =>
    last ? last.sets[i] || last.sets.at(-1) || null : null;

  const emptyBar =
    state.unit && isBarbellEq(cfg.id) && !isBw(cfg) ? barWeightFor(state.unit, state.plates) : 0;

  const requestedWeight = cfg.weight ?? 0;
  const configuredWeight = requestedWeight > 0 ? requestedWeight : emptyBar;

  if (mode === "cardio") {
    const sets: CardioSet[] = [];

    for (let i = 0; i < n; i++) {
      const prev = prevAt(i);
      sets.push({
        min: prev?.min ?? cfg.min ?? 20,
        speed: prev?.speed ?? cfg.speed ?? 8,
        done: false,
      });
    }

    return sets;
  }

  if (mode === "time") {
    const sets: TimeSet[] = [];

    for (let i = 0; i < n; i++) {
      // Only carry a previous value over when it came from a timed set — switching an
      // exercise from reps to time must not seed the duration from a rep count.
      const prev = prevAt(i);
      const carried = prev && (prev.sec ?? 0) > 0 ? prev : null;
      const previousWeight = carried?.w ?? 0;
      sets.push({
        sec: carried?.sec ?? cfg.sec ?? 45,
        w: previousWeight > 0 ? previousWeight : configuredWeight,
        done: false,
      });
    }

    return sets;
  }

  const sets: RepsSet[] = [];
  const conf = state.exWeights?.[cfg.id];

  for (let i = 0; i < n; i++) {
    const prev = prevAt(i);
    const usable = prev && (prev.r ?? 0) > 0 ? prev : null;
    const previousWeight = usable?.w ?? 0;

    const w =
      conf?.w != null && conf.w > 0
        ? conf.w
        : previousWeight > 0
          ? previousWeight
          : configuredWeight;

    sets.push({ w, r: usable?.r ?? cfg.reps ?? 10, done: false });
  }

  return sets;
}

export function workoutVolume(w: Pick<WorkoutLike, "entries">): number {
  let v = 0;

  // No special case for unilateral work: a per-side set logs its total, so both sides are
  // already in the rep count that arrives here. Warm-up sets are preparation, not volume.
  for (const e of w.entries) {
    for (const s of working(e.sets)) {
      if (s.done) {
        v += (s.w || 0) * (s.r || 0);
      }
    }
  }

  return v;
}

export function setsDone(w: Pick<WorkoutLike, "entries">): number {
  let n = 0;

  for (const e of w.entries) {
    for (const s of working(e.sets)) {
      if (s.done) {
        n++;
      }
    }
  }

  return n;
}

export function setsDoneActive(
  activeWorkout: Pick<ActiveWorkout, "entries"> | null | undefined,
): number {
  let n = 0;

  if (activeWorkout) {
    for (const entry of activeWorkout.entries) {
      for (const set of working(entry.sets)) {
        if (set.done) {
          n++;
        }
      }
    }
  }

  return n;
}

export const lastBW = (appState: Pick<AppState, "bodyweight">): BodyweightEntry | null =>
  appState.bodyweight.at(-1) ?? null;

// Group consecutive items sharing a superset id (sg) into "units" of indices.
// items may be routine exercises ({sg}) or active-workout entries ({sg}).
export function supersetUnits(items: ReadonlyArray<SupersetUnitsProps>): number[][] {
  const units: number[][] = [];

  for (const [index, item] of items.entries()) {
    const previousItem = items[index - 1];

    if (index > 0 && item.sg && previousItem?.sg && item.sg === previousItem.sg) {
      units.at(-1)?.push(index);
    } else {
      units.push([index]);
    }
  }

  return units;
}

export function unitOf(units: number[][], idx: number): number[] {
  return units.find((u) => u.includes(idx)) || [idx];
}

export function streakWeeks(state: StreakWeeksProps): number {
  if (state.workouts.length === 0) {
    return 0;
  }

  const weeks = new Set(state.workouts.map((workout) => weekKey(workout.d)));
  let streak = 0;
  const cur = new Date();

  for (let i = 0; i < 520; i++) {
    const week = weekKey(isoOf(cur));

    if (weeks.has(week)) {
      streak++;
    } else if (i > 0) {
      break;
    }

    cur.setDate(cur.getDate() - 7);
  }

  return streak;
}
