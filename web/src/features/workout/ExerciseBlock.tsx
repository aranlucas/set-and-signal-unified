import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useEffortLabels } from "@/shared/hooks/use-effort-labels";
import { useExerciseMetadataLabels } from "@/shared/hooks/use-exercise-metadata-labels";
import { useStore } from "@/app/store/useStore";
import { useWorkoutTimer } from "@/features/workout/useWorkoutTimer";
import { exOr, isBarbellEq } from "@/domain/exercises/exercises";
import {
  lastEntryFor,
  bestWeightFor,
  setLabel,
  modeOf,
  isBw,
  isPerSide,
  sideReps,
  repStep,
  isWarmup,
  EFFORT,
  effortOf,
  stepEffort,
  capEffort,
} from "@/domain/training/history";
import { fmtNum, fmtDate } from "@/shared/lib/format";
import Media from "@/shared/components/Media";
import Icon from "@/shared/components/Icon";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { NumberField } from "@/shared/components/NumField";
import { PlateRow } from "@/shared/components/PlateRow";
import { barWeightFor } from "@/domain/training/plates";
import type { LoggedSet, ActiveWorkout, EffortKind, Prescription } from "@/shared/lib/types";
import type { SetWorkoutSheet } from "@/features/workout/workout-state";
import { fieldOf, repsOf, weightOf, type SetField } from "@/features/workout/workout-set-fields";

type ExerciseBlockProps = {
  entryIdx: number;
  compact?: boolean;
  onToggle: (i: number) => void;
  onField: (i: number, f: SetField, v: number | null) => void;
  onAddSet: () => void;
  onRemoveSet: () => void;
  onToggleWarmup: () => void;
  onStartTimed: (i: number) => void;
  setWorkoutSheet: SetWorkoutSheet;
};

const translatedReason = (t: TFunction, why: NonNullable<Prescription["why"]>): string =>
  t(why.key, why.defaultValue, why.values ?? {});

/* One stepper column over a logged set. `f` names the field on the set; `eff`/`opt` only
   appear on the effort column. */
interface Col {
  f: SetField;
  step: number;
  dec: boolean;
  hd: string;
  eff?: EffortKind; // effort columns walk their own scale (stepEffort/capEffort)
  opt?: boolean; // an unlogged effort is not 0 — clearing drops the key instead
  min?: number;
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
export function ExerciseBlock({
  entryIdx,
  compact,
  onToggle,
  onField,
  onAddSet,
  onRemoveSet,
  onToggleWarmup,
  onStartTimed,
  setWorkoutSheet,
}: ExerciseBlockProps) {
  const { t } = useTranslation();
  const effortLabels = useEffortLabels();
  const metadata = useExerciseMetadataLabels();
  const appState = useStore((state) => state.appState);
  const working = useWorkoutTimer((state) => state.work);
  const [setKeys] = useState(() => new Map<string, string>());

  if (!appState.active) {
    return null;
  }

  const A: ActiveWorkout = appState.active;
  const entry = A.entries[entryIdx];

  const setKeyFor = (position: number) => {
    const mapKey = `${entry.id}:${position}`;
    const existing = setKeys.get(mapKey);

    if (existing) {
      return existing;
    }

    const key = `${entry.id}-set-${setKeys.size}`;
    setKeys.set(mapKey, key);

    return key;
  };

  const ex = exOr(entry.id);
  const mode = modeOf({ ...entry.target, id: entry.id });
  const cardio = mode === "cardio";
  const timed = mode === "time";
  const last = lastEntryFor(appState, entry.id);

  // The same number the "confirm your working weight" sheet calls your best, so the two
  // never disagree inside one session: heaviest logged set, or the working weight you kept.
  const best = cardio
    ? 0
    : Math.max(bestWeightFor(appState, entry.id), appState.exWeights[entry.id]?.w || 0);

  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan;
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  const cfg = { ...entry.target, id: entry.id };
  const bw = !cardio && isBw(cfg);
  const barbell = !bw && isBarbellEq(ex);
  const emptyBar = barbell ? barWeightFor(appState.unit, appState.plates) : 0;
  const added = bw && entry.sets.some((set) => (weightOf(set) ?? 0) > 0);
  const hasWarmup = entry.sets.some(isWarmup);

  // The load the plate breakdown is drawn for: the set you're working on, else the last
  // one. Only loaded rep work has plates to put on a bar.
  const plateWeight =
    mode === "reps" && barbell
      ? (weightOf(entry.sets.find((set) => !set.done && !isWarmup(set)) ?? entry.sets.at(-1)) ?? 0)
      : 0;

  const loadCol: Col = {
    f: "w",
    step: barbell && appState.unit === "lb" ? 5 : 2.5,
    dec: true,
    min: emptyBar,
    hd: bw
      ? t("exercise.measurement.added", "Added ({{unit}})", { unit: appState.unit })
      : barbell
        ? t("exercise.totalWeight", "Total weight ({{unit}})", { unit: appState.unit })
        : t("exercise.weight", "Weight ({{unit}})", { unit: appState.unit }),
  };

  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol: Col = { f: "r", step: repStep(cfg), dec: false, hd: t("exercise.reps", "Reps") };

  const col1: Col = cardio
    ? { f: "min", step: 1, dec: false, hd: t("workout.durationMin", "Duration (min)") }
    : timed
      ? { f: "sec", step: 5, dec: false, hd: t("progression.seconds", "Seconds") }
      : bw && !added
        ? repCol
        : loadCol;

  const col2: Col | null = cardio
    ? { f: "speed", step: 0.5, dec: true, hd: t("exercise.speedKmH", "Speed (km/h)") }
    : timed
      ? bw && !added
        ? null
        : loadCol
      : bw && !added
        ? null
        : repCol;

  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(appState);

  const col3: Col | null =
    mode !== "reps" || kind === "none"
      ? null
      : {
          ...EFFORT[kind],
          eff: kind,
          dec: true,
          opt: true,
          hd: kind === "rir" ? effortLabels.rir : effortLabels.rpe,
        };

  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s: LoggedSet, i: number, col: Col, dir: number) => {
    const cur = fieldOf(s, col.f);

    if (col.eff) {
      return onField(i, col.f, stepEffort(col.eff, cur ?? null, dir));
    }

    onField(
      i,
      col.f,
      Math.max(col.min ?? 0, Math.round(((cur || 0) + dir * col.step) * 100) / 100),
    );
  };

  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  const cell = (s: LoggedSet, i: number, col: Col, cls: string) => (
    <div
      className={`min-w-0 sm:col-span-1 sm:flex-1 ${
        (col3 && cls === "eff") || (!col2 && cls === "w") ? "col-span-2" : ""
      }`}
    >
      <span className="mb-1 block text-center text-xs font-medium tracking-wide text-muted-foreground uppercase sm:hidden">
        {col.hd}
      </span>
      <div className="flex min-w-0 items-center overflow-hidden rounded-md bg-muted">
        <Button
          variant="stepper"
          type="button"
          className={`${col3 ? (cls === "eff" ? "sm:w-5" : "sm:w-6") : "sm:w-8"} flex size-11 flex-none items-center justify-center sm:h-10`}
          aria-label={`Decrease ${ex.n}, ${t("exercise.sets", "Sets")} ${i + 1}, ${col.hd}`}
          onClick={() => bump(s, i, col, -1)}
        >
          <Icon name="minus" />
        </Button>
        <span className="flex min-w-10 flex-1 items-baseline justify-center gap-1 px-0.5 sm:min-w-0">
          <NumberField
            aria-label={`${ex.n}, ${t("exercise.sets", "Sets")} ${i + 1}, ${col.hd}`}
            decimal={col.dec}
            nullable={col.opt}
            value={fieldOf(s, col.f)}
            density={col3 ? "compact" : "default"}
            onChange={(v) =>
              onField(
                i,
                col.f,
                (col.eff ? capEffort(col.eff, v) : Math.max(col.min ?? 0, v ?? 0)) ?? null,
              )
            }
          />
        </span>
        <Button
          variant="stepper"
          type="button"
          className={`${col3 ? (cls === "eff" ? "sm:w-5" : "sm:w-6") : "sm:w-8"} flex size-11 flex-none items-center justify-center sm:h-10`}
          aria-label={`Increase ${ex.n}, ${t("exercise.sets", "Sets")} ${i + 1}, ${col.hd}`}
          onClick={() => bump(s, i, col, 1)}
        >
          <Icon name="plus" />
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Media exercise={ex} key={entry.id} compact={compact} minimizable />
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div
          className={`${compact ? "text-lg" : "text-xl"} leading-tight font-semibold tracking-tight capitalize`}
        >
          {ex.n}
        </div>
        <Button
          variant="circle"
          className="flex size-11 flex-none items-center justify-center active:scale-95 sm:size-9"
          aria-label={t("common.details", "Details")}
          onClick={() => setWorkoutSheet({ type: "detail", exercise: ex })}
        >
          <Icon name="info" />
        </Button>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {cardio && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            <Icon name="figureRun" />
            {t("workout.type.cardio", "Cardio")}
          </span>
        )}
        {/* You log the total; this is the split, so the set in front of you is unambiguous
          without the rep count having to mean two different things (issue #31). */}
        {!cardio && !timed && isPerSide(cfg) && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary normal-case">
            <Icon name="shuffle" />
            {t("exercise.measurement.perSide", "{{value}} per side", {
              value: fmtNum(sideReps(repsOf(entry.sets.find((set) => !set.done) ?? entry.sets[0]))),
            })}
          </span>
        )}
        {(ex.tg || ex.bp) && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/60 capitalize">
            {metadata.muscle(ex.tg || ex.bp)}
          </span>
        )}
        {ex.eq && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/60 capitalize">
            {metadata.equipment(ex.eq)}
          </span>
        )}
        {best > 0 && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/60 normal-case">
            {t("exercise.best", "Best:")} {fmtNum(best)} {appState.unit}
          </span>
        )}
      </div>
      {last && (
        <div className="mb-1 text-sm leading-snug text-muted-foreground">
          {t("workout.lastTime", "Last time")} ({fmtDate(t, last.d)}):{" "}
          {last.sets.map((s) => setLabel(entry.id, s, last.target)).join(", ")}
        </div>
      )}
      {plan && plan.why && plan.kind !== "off" && (
        <div
          className={`my-1.5 flex items-start gap-2 text-sm leading-snug ${plan.kind === "deload" ? "text-warning" : "text-primary"}`}
        >
          <Icon
            name={
              plan.kind === "up" ? "arrowUp" : plan.kind === "deload" ? "arrowDown" : "lightbulb"
            }
          />
          <span>{translatedReason(t, plan.why)}</span>
        </div>
      )}
      <div className="mt-2.5 rounded-lg bg-card p-4">
        {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
        <div
          className={`hidden items-center gap-2 pb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase sm:flex ${col3 ? "gap-1.5" : ""}`}
        >
          <span className="w-6 flex-none" />
          <span className={`${col3 ? "flex-1" : "flex-1"} text-center`}>{col1.hd}</span>
          {col2 && <span className="flex-1 text-center">{col2.hd}</span>}
          {col3 && <span className="flex-1 text-center">{col3.hd}</span>}
          {timed && <span className="w-7.5 flex-none" />}
          <span className="w-7.5 flex-none" />
        </div>
        {entry.sets.map((s, index) => (
          <div
            // Sets are only appended or removed from the end, so the position is a stable
            // identity. Do not derive keys from values: typing or checking a set must not
            // remount its NumberField and discard its local input draft.
            key={setKeyFor(index)}
            className={`relative grid grid-cols-2 gap-2 py-3 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-border/60 first:before:hidden sm:flex sm:items-center sm:py-2 sm:before:left-8 ${col3 ? "sm:gap-1.5" : ""}`}
          >
            <div
              className={`col-span-2 flex size-6 flex-none items-center justify-center rounded-full text-xs font-medium text-foreground/60 transition-colors duration-140 sm:col-span-1 ${
                s.done
                  ? "bg-primary text-primary-foreground"
                  : isWarmup(s)
                    ? "border border-dashed border-foreground/40"
                    : "bg-muted"
              }`}
              title={isWarmup(s) ? t("workout.warmupSet", "Warm-up set") : undefined}
            >
              {index + 1}
            </div>
            {cell(s, index, col1, "w")}
            {col2 && cell(s, index, col2, "r")}
            {col3 && cell(s, index, col3, "eff")}
            {/* A timed set is started, not typed: the timer counts the hold down and checks the
            set off itself. The checkbox stays for anyone who timed it on their own watch. */}
            {timed && (
              <Button
                variant="circle"
                className="absolute top-2.5 right-10 flex size-11 flex-none items-center justify-center sm:static sm:size-7.5"
                aria-label={t("progression.startSet", "Start set")}
                disabled={s.done || !!working}
                onClick={() => onStartTimed(index)}
              >
                <Icon name="play" className="text-sm text-primary" />
              </Button>
            )}
            <Checkbox
              aria-label={`${ex.n}, ${t("exercise.sets", "Sets")} ${index + 1}, ${t("common.done", "Done")}`}
              checked={s.done}
              className="absolute top-3 right-0 size-6 sm:relative sm:top-auto sm:right-auto sm:size-4"
              onCheckedChange={() => onToggle(index)}
            />
          </div>
        ))}
        <div className="h-2" />
        {plateWeight > 0 && <PlateRow weight={plateWeight} />}
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>
            <Icon name="minus" />
            {t("workout.removeSet", "Remove set")}
          </Button>
          <Button size="sm" onClick={onAddSet}>
            <Icon name="plus" />
            {t("workout.addSet", "Add set")}
          </Button>
          {mode === "reps" && (
            <Button
              size="sm"
              variant={hasWarmup ? "default" : "ghost"}
              onClick={onToggleWarmup}
              title={t(
                "workout.warmupRampDescription",
                "Insert a percentage ramp (40% × 8 · 60% × 5 · 80% × 3) before your work sets",
              )}
            >
              <Icon name="flame" />
              {t("workout.warmup", "Warm-up")}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
