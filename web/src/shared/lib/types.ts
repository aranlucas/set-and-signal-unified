import type { FivefoldPolicyState } from "@set-and-signal/training/fivefold";
import type { WorkoutSource } from "@set-and-signal/training/records";
import type { TOptions } from "i18next";
// Set & Signal domain contracts for persisted state and runtime data.
import type { TranslationKey } from "@/i18n/i18n-types.js";
import type { Accent } from "@/shared/lib/accents.js";

export type { Accent } from "@/shared/lib/accents.js";

/* ============================ primitives ============================ */

export type Unit = "kg" | "lb";

export type Theme = "dark" | "light";

export type Body = "male" | "female";

export type GifSize = "full" | "mini";

export type EffortScale = "none" | "rir" | "rpe";

export type EffortKind = "rir" | "rpe";

export type Mode = "reps" | "time" | "cardio";

export type PolicyId = "off" | "linear" | "greyskull" | "double" | "time" | "fivefold";

export type FormulaId = "epley" | "brzycki" | "lombardi";

export type IsoDate = string; // 'YYYY-MM-DD'

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // JS getDay(); JSON round-trips keys to strings

export type Id = string; // uid(): Date.now().toString(36)+rand

/** One planned workout on a weekday slot or calendar override. */
export interface DaySession {
  routineId: Id;
  start?: string; // local HH:MM
  label?: string;
}

/** One-off override for an ISO calendar date (rest or ordered sessions). */
export type DayPlanEntry =
  | { rest: true; sessions?: never }
  | { rest?: false; sessions: DaySession[] };

/* ============================ persisted state ============================ */

export interface Reminder {
  on: boolean;
  time: string;
  tz: string | null;
} // time 'HH:MM'; tz IANA name

export interface ExWeightHint {
  w: number;
  d: IsoDate;
}

export interface BodyweightEntry {
  d: IsoDate;
  w: number;
  t: number | null;
} // t = epoch ms of weigh-in

// Barbell setup for the plate calculator. `avail` is one side's plate inventory,
// heaviest first is not required (the calculator sorts); absent = unit defaults.
export interface PlateSetup {
  on: boolean;
  bar: number; // bar weight in the profile unit
  avail: number[]; // plate weights available, profile unit
}

// Tape-measure entry (cm). Fields are optional — you log the ones you take.
export interface MeasuresEntry {
  d: IsoDate;
  chest?: number;
  waist?: number;
  hips?: number;
  arm?: number;
  thigh?: number;
}

export interface AppState {
  fivefoldNext?: "A" | "B";
  // settings
  unit: Unit;
  restSec: number;
  sound: boolean;
  keepAwake: boolean;
  lang: string; // key of LANGUAGES in languages.ts
  theme: Theme;
  accent: Accent;
  body: Body;
  targetW: number | null; // goal bodyweight
  gifSize: GifSize;
  effort: EffortScale | null; // null = no scale chosen
  reminder: Reminder;

  // data
  bodyweight: BodyweightEntry[];
  measures: MeasuresEntry[];
  plates: PlateSetup | null; // null = never configured (unit defaults shown in Settings)
  routines: Routine[];
  week: Partial<Record<Weekday, DaySession[]>>; // weekday -> ordered sessions; missing/empty = rest
  dayPlan: Record<IsoDate, DayPlanEntry>; // one-off overrides (Calendar rescheduling)
  exWeights: Record<Id, ExWeightHint>; // exercise id -> last confirmed working weight
  workouts: Workout[];
  active: ActiveWorkout | null;
  customEx: CustomEx[];

  _ts?: number; // stamped by persist(); sync ordering
}

/* ============================ routines & config ============================ */

export interface Routine {
  id: Id;
  name: string;
  emoji: string; // icon glyph name, not a unicode emoji
  prog?: PolicyId; // routine-wide progression default
  ex: ExConfig[];
  sessionPlan?: SessionPlan;
}

/** An accepted adaptation snapshot; later routine edits never rewrite its source. */
export interface SessionPlan {
  sourceId: Id;
  sourceName: string;
  equipment: string[];
  budgetMin: number;
  restSec: number;
  rows: { original: ExConfig; planned: ExConfig | null }[];
}

// One planned exercise. Fields beyond id/sets depend on mode; absent fields are absent.
export interface ExConfig {
  fivefold?: FivefoldPolicyState;
  id: Id; // EXDB id or customEx id
  sets: number;
  mode?: Mode; // written only for 'time'; cardio derives from bp==='cardio'
  // reps mode
  reps?: number;
  weight?: number; // external load; bodyweight exercises: ADDED weight (belt)
  // time mode
  sec?: number;
  // cardio mode
  min?: number; // duration minutes
  speed?: number; // km/h
  // flags (absent reads as false)
  bodyweight?: boolean; // no self-load
  side?: boolean; // unilateral; `reps` is always the TOTAL across both sides
  // progression overrides
  prog?: PolicyId;
  inc?: number; // load increment; only meaningful > 0
  repsMin?: number; // double-progression range bottom
  repsMax?: number; // bodyweight/double range ceiling
  sg?: string; // superset group id; needs an adjacent partner (cleanupSg)
}

/* ============================ sets ============================ */

interface SetBase {
  recordedWeight?: number;
  done: boolean;
}

// reps-mode set:   { w, r }
// time-mode set:   { sec, w }        (w = added weight, 0 for plain holds)
// cardio-mode set: { min, speed }
export interface RepsSet extends SetBase {
  w: number;
  r: number;
  rir?: number;
  rpe?: number;
  wu?: boolean; // warm-up set: excluded from volume, set counts, PRs and progression reads
}

export interface TimeSet extends SetBase {
  sec: number;
  w: number;
  rir?: number;
  rpe?: number;
}

export interface CardioSet extends SetBase {
  min: number;
  speed: number;
}

export type LoggedSet = RepsSet | TimeSet | CardioSet;

// A set carries either rir or rpe, never both, never null (cleared = key dropped).
// No discriminant exists in the data — narrow via modeOf(target) at call sites.

/* ============================ workouts ============================ */

// A completed custom exercise keeps the display name and canonical muscle weights it had at
// the time of logging. This makes history and recovery durable even after that exercise is
// removed from the profile catalogue.
export interface MuscleSnapshot {
  n?: string;
  bp?: string;
  muscleWeights?: Partial<Record<string, number>>;
}

export interface WorkoutEntry {
  id: Id;
  sets: LoggedSet[];
  topW?: number | null; // optional user-confirmed working weight
  target?: ExConfig | null; // prescription captured for planned sessions; omitted for CSV imports
  muscleSnapshot?: MuscleSnapshot | null;
}

export interface Workout {
  progressionApplied?: string[];
  garminActivityIds?: string[];
  source?: WorkoutSource;
  id: Id;
  d: IsoDate;
  start: number; // epoch ms
  end: number; // epoch ms; >= start
  routineId: Id | null; // null = freestyle / imported
  name: string;
  bw?: number | null; // weigh-in the workout was logged at (NOT the bodyweight flag)
  entries: WorkoutEntry[]; // finish filters to entries with >=1 done set
  prs: Id[]; // exercise ids with a new top weight this session ([] allowed)
  vol: number; // sum w*r over done sets, computed after construction
  note?: string; // free-text session notes, written from the finish summary
  sessionPlan?: SessionPlan;
}

/* ============================ active workout ============================ */

export interface ActiveEntry {
  id: Id;
  sg?: string; // copied from config so supersets survive into the session
  target: ExConfig; // snapshot of the routine config
  plan: Prescription | null; // nextPrescription() result at build time
  sets: LoggedSet[]; // buildSets() + applyPrescription()
  topW?: number; // appears once the user confirms a working weight
  asked?: boolean; // transient session marker: working weight prompt already shown
}

export interface ActiveWorkout {
  id: Id;
  d: IsoDate;
  start: number;
  routineId: Id | null;
  name: string;
  bw: number | null;
  cur: number; // index into entries currently on screen
  entries: ActiveEntry[];
  sessionPlan?: SessionPlan;
}

/* ============================ progression ============================ */

export type PrescriptionKind = "first" | "up" | "hold" | "deload" | "off";

export interface TranslationMessage {
  key: TranslationKey;
  defaultValue: string;
  values?: TOptions;
}

export interface Prescription {
  policy: PolicyId;
  kind: PrescriptionKind;
  weight?: number; // decided fields only; undefined = keep what the plan said
  reps?: number;
  sec?: number;
  sets?: number; // only bodyweight 'up' may add a set
  why?: TranslationMessage;
}

export interface SessionRead {
  // readSession(): time variant lacks count/low/amrap/reps; reps variant lacks held/best
  mode: Mode;
  goal: number;
  weight: number;
  ok: boolean;
  held?: number[];
  best?: number;
  count?: number;
  low?: number;
  amrap?: number;
  reps?: number[];
}

/* ============================ exercises ============================ */

export interface Exercise {
  id: Id;
  n: string; // name
  bp: string; // body part
  eq: string; // equipment
  tg: string; // primary target muscle
  mg: string; // main secondary
  sm: string[]; // secondary muscles
  img: string;
  gif: string;
}

export type CatalogExercise = Exercise & { missing?: boolean }; // exOr() fallback shape

export interface CustomEx {
  id: Id; // uid(), or 'im'+uid() when minted by CSV import
  n: string; // display name
  bp: string; // body part incl. 'cardio'
  desc?: string;
  // extras only on CSV-imported customs (mergeImport stores them verbatim):
  custom?: true;
  eq?: string; // 'custom'
  tg?: string;
}

/* ============================ plan share bundle ============================ */

export interface PlanBundleRoutine {
  id: Id;
  name: string;
  emoji?: string;
  prog?: PolicyId;
  ex: ExConfig[];
}

export interface PlanBundleCustom {
  id: Id;
  n: string;
  bp: string;
  desc?: string;
}

export interface PlanBundle {
  opengym_plan: 2;
  exported: IsoDate;
  name: string;
  week: Partial<Record<string, DaySession[]>>;
  routines: PlanBundleRoutine[];
  customEx: PlanBundleCustom[];
}

/* ============================ curated templates ============================ */

export type CuratedItem =
  | [exId: Id, sets: number, reps: number]
  | { id: Id; sets: number; min: number; speed: number };

export interface CuratedPlan {
  key: string;
  name: string;
  emoji: string;
  eq: string[];
  prog?: PolicyId;
  week: Record<number, number>; // weekday -> index into routines
  routines: [name: string, emoji: string, items: CuratedItem[]][];
}

/* ============================ UI store shapes ============================ */

export type SheetClose = () => Promise<void>;

export interface Timer {
  left: number;
  total: number;
  endsAt: number;
}

export interface WorkTimer extends Timer {
  label: string;
}

/* ============================ store surface ============================ */

// The API's auth responses intentionally expose only this small public identity shape.
// Internal server fields never cross the browser boundary.
export interface User {
  id: string;
  name: string;
  admin?: boolean;
}

export interface StoreState {
  appState: AppState;
  user: User | null;
  isGuest: boolean;
  isReady: boolean;
}
