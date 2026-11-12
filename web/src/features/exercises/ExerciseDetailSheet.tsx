import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/store/useStore";
import { isCardio } from "@/domain/exercises/exercises";
import { fmtDate, fmtNum } from "@/shared/lib/format";
import { lastEntryFor, bestWeightFor, setLabel } from "@/domain/training/history";
import { useExerciseMetadataLabels } from "@/shared/hooks/use-exercise-metadata-labels";
import { normalizeLanguage } from "@/i18n/languages";
import { useExerciseInstructions } from "@/domain/exercises/exercise-instructions";
import { Button } from "@/shared/ui/button";
import { Stepper } from "@/shared/components/Stepper";
import Media from "@/shared/components/Media";
import Icon from "@/shared/components/Icon";
import { estimate1RM, best1RM, REP_CAP } from "@/domain/training/onerm";
import type { CustomEx, SheetClose } from "@/shared/lib/types";
import { Skeleton } from "@/shared/ui/skeleton";
import { toCatalogExercise, type SheetEx } from "@/features/exercises/sheet-shared";

type OneRepMaxProps = { exercise: SheetEx };

type ExerciseDetailProps = {
  exercise: SheetEx;
  close: SheetClose;
  openAddToRoutine: (exercise: SheetEx) => void;
  openCustom: (exercise: CustomEx) => void;
  onDelete?: () => void;
};

function useAppState() {
  return useStore((state) => state.appState);
}

const isCustomExercise = (exercise: SheetEx): exercise is CustomEx => exercise.custom === true;

function OneRepMax({ exercise }: OneRepMaxProps) {
  const { t } = useTranslation();
  const appState = useAppState();
  const bestResult = best1RM(appState, exercise.id);

  const [weight, setWeight] = useState(
    bestResult ? bestResult.w : appState.exWeights[exercise.id]?.w || 20,
  );

  const [reps, setReps] = useState(bestResult ? bestResult.r : 5);
  const estimate = estimate1RM(weight, reps);

  return (
    <>
      <h4 className="my-5.5 mb-2 px-1 text-sm font-normal tracking-tight text-foreground/60">
        {t("progression.estimated1rm", "Estimated 1RM")}
      </h4>
      {bestResult && (
        <div className="mb-2 text-sm leading-snug">
          {t("progression.fromYourLog", "From your log:")}{" "}
          <b className="text-primary">
            {fmtNum(bestResult.est)} {appState.unit}
          </b>
          <span className="text-muted-foreground">
            {" "}
            ·{" "}
            {t("progression.on", "{{weight}} × {{reps}} on {{date}}", {
              weight: fmtNum(bestResult.w) + " " + appState.unit,
              reps: bestResult.r,
              date: fmtDate(t, bestResult.d, true),
            })}
          </span>
        </div>
      )}
      <div className="mb-2.5 flex gap-2 [&>div]:min-w-0 [&>div]:flex-1">
        <Stepper
          label={t("exercise.weight", "Weight ({{unit}})", { unit: appState.unit })}
          value={weight}
          step={2.5}
          onChange={(value) => setWeight(value ?? 0)}
        />
        <Stepper
          label={t("exercise.reps", "Reps")}
          value={reps}
          step={1}
          decimal={false}
          onChange={(value) => setReps(value ?? 0)}
        />
      </div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm leading-snug text-foreground/60">
          {t("progression.estimate", "Estimate")}
        </span>
        <b className="text-xl text-primary">
          {estimate === null ? "—" : fmtNum(estimate) + " " + appState.unit}
        </b>
      </div>
      <div className="text-sm leading-snug text-muted-foreground">
        {estimate === null
          ? t(
              "progression.enterWeight1RepsBeyond",
              "Enter a weight and 1–{{maxReps}} reps — beyond that an estimate is guesswork.",
              {
                maxReps: REP_CAP,
              },
            )
          : t(
              "progression.epleyFormulaCalculationOneSet",
              "Epley formula — a calculation from one set, not a tested max.",
            )}
      </div>
      {estimate !== null && (
        <>
          <h4 className="my-5.5 mb-2 px-1 text-sm font-normal tracking-tight text-foreground/60">
            {t("progression.oneRmPercentageGuide", "1RM percentage guide")}
          </h4>
          {/* JEFIT-style percentage ladder: what each rep max should weigh if the
             estimate is right — handy for picking training loads off a known max. */}
          <div className="grid grid-cols-2 gap-x-5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((repCount) => {
              const share = 100 / (1 + repCount / 30);
              const repMax = Math.round((estimate / (1 + repCount / 30)) * 10) / 10;

              return (
                <div
                  key={repCount}
                  className="flex items-baseline justify-between gap-2 border-b border-border/40 py-1.5 text-sm"
                >
                  <span className="leading-snug text-foreground/60 tabular-nums">
                    {repCount}× · {Math.round(share)}%
                  </span>
                  <b className="leading-snug tabular-nums">
                    {fmtNum(repMax)} {appState.unit}
                  </b>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

export function ExerciseDetail({
  exercise,
  close,
  openAddToRoutine,
  openCustom,
  onDelete,
}: ExerciseDetailProps) {
  const { t, i18n } = useTranslation();
  const metadata = useExerciseMetadataLabels();
  const appState = useAppState();
  const catalogExercise = toCatalogExercise(exercise);
  const customExercise = isCustomExercise(exercise) ? exercise : null;
  const lastEntry = lastEntryFor(appState, exercise.id);
  const bestWeight = bestWeightFor(appState, exercise.id);
  const instructionLanguage = normalizeLanguage(i18n.resolvedLanguage || i18n.language);
  const hasCatalogInstructions = "img" in exercise && !catalogExercise.missing;

  const loadedInstructions = useExerciseInstructions(
    instructionLanguage,
    catalogExercise.id,
    hasCatalogInstructions,
  );

  const instructions = loadedInstructions?.steps || [];

  return (
    <>
      <h3 className="capitalize">{catalogExercise.n}</h3>
      <Media exercise={catalogExercise} />
      <div className="my-2.5 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-sm bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
          {metadata.bodyPart(catalogExercise.bp)}
        </span>
        {catalogExercise.tg && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/60">
            <Icon name="target" />
            {metadata.muscle(catalogExercise.tg)}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/60">
          <Icon name="dumbbell" />
          {metadata.equipment(catalogExercise.eq)}
        </span>
        {catalogExercise.sm.slice(0, 3).map((secondaryMuscle) => (
          <span
            key={`${catalogExercise.id}-${secondaryMuscle}`}
            className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/60"
          >
            {metadata.muscle(secondaryMuscle)}
          </span>
        ))}
      </div>
      {exercise.desc && (
        <div className="mb-2.5 rounded-lg bg-card px-4 py-3 text-base leading-normal whitespace-pre-wrap text-foreground/60">
          {exercise.desc}
        </div>
      )}
      {bestWeight > 0 && (
        <div className="mb-1.5 flex items-center gap-1.5 text-sm leading-snug">
          <Icon name="trophy" className="text-sm text-warning" />
          {t("exercise.best", "Best:")}{" "}
          <b className="text-primary">
            {fmtNum(bestWeight)} {appState.unit}
          </b>
          {lastEntry
            ? ` · ${t("common.lastLowercase", "last")} ${fmtDate(t, lastEntry.d)}: ${lastEntry.sets.map((set) => setLabel(exercise.id, set, lastEntry.target)).join(", ")}`
            : ""}
        </div>
      )}
      <Button
        variant="default"
        className="my-2.5 mb-1 w-full"
        onClick={() =>
          void close().then((): undefined => {
            openAddToRoutine(exercise);
          })
        }
      >
        <Icon name="plus" />
        {t("exercise.addMyPlan", "Add to my plan")}
      </Button>
      {customExercise && (
        <div className="mt-2 flex gap-2">
          <Button
            className="min-w-0 flex-1"
            onClick={() =>
              void close().then((): undefined => {
                openCustom(customExercise);
              })
            }
          >
            <Icon name="pencil" />
            {t("customExercise.edit", "Edit")}
          </Button>
          <Button
            variant="destructive"
            className="min-w-0 flex-1"
            onClick={() =>
              void close().then((): undefined => {
                onDelete?.();
              })
            }
          >
            <Icon name="trash" />
            {t("common.delete", "Delete")}
          </Button>
        </div>
      )}
      {!isCardio(exercise.id) && <OneRepMax exercise={exercise} />}
      {(loadedInstructions === undefined || instructions.length > 0) && (
        <>
          <h4 className="my-5.5 mb-2 px-1 text-sm font-normal tracking-tight text-foreground/60">
            {t("exercise.howTo", "How to")}
            {loadedInstructions?.language !== instructionLanguage && (
              <span className="tracking-normal text-muted-foreground normal-case">
                {" "}
                · {t("exercise.instructionsEnglish", "instructions in English")}
              </span>
            )}
          </h4>
          {loadedInstructions === undefined ? (
            <div className="flex flex-col gap-2.5" aria-hidden="true">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-11/12" />
              <Skeleton className="h-5 w-4/5" />
            </div>
          ) : (
            <ol className="flex list-decimal flex-col gap-2.5 pl-4.5 text-base leading-normal text-foreground/60 marker:text-muted-foreground">
              {instructions.map((instruction) => (
                <li key={`${catalogExercise.id}-${instruction}`}>{instruction}</li>
              ))}
            </ol>
          )}
        </>
      )}
    </>
  );
}
