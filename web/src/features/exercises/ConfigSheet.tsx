import { useTranslation } from "react-i18next";
import { useForm, useWatch } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { useExerciseMetadataLabels } from "@/shared/hooks/use-exercise-metadata-labels";
import { useProgressionLabels } from "@/shared/hooks/use-progression-labels";
import { useStore } from "@/app/store/useStore";
import { isBarbellEq, isCardio, isBodyweightEq } from "@/domain/exercises/exercises";
import { fmtNum } from "@/shared/lib/format";
import { defaultConfig, modeOf, isBw, isPerSide, sideReps } from "@/domain/training/history";
import { barWeightFor } from "@/domain/training/plates";
import { Button } from "@/shared/ui/button";
import { Field } from "@/shared/ui/field";
import { Switch } from "@/shared/ui/switch";
import { Segmented } from "@/shared/ui/segmented";
import { SelectRow } from "@/shared/components/SelectRow";
import { Row } from "@/shared/components/layout";
import { Stepper } from "@/shared/components/Stepper";
import Media from "@/shared/components/Media";
import Icon from "@/shared/components/Icon";
import { PlateRow } from "@/shared/components/PlateRow";
import {
  policyFor as progressionPolicyFor,
  defaultIncrement,
  POLICIES_FOR,
  MAX_BW_SETS,
} from "@/domain/training/progression";
import type {
  CustomEx,
  ExConfig,
  Mode,
  PolicyId,
  Routine,
  SheetClose,
  Unit,
} from "@/shared/lib/types";
import { toCatalogExercise, type SheetEx } from "@/features/exercises/sheet-shared";
import { createExerciseConfigFormSchema } from "@/shared/lib/form-schemas";

type ProgressionFieldsProps = {
  exercise: SheetEx;
  mode: Mode;
  config: ExConfig;
  setConfig: (updateConfig: (previous: ExConfig) => ExConfig) => void;
  routine: Routine | null;
  unit: Unit;
};

type ConfigExerciseIntroProps = { exercise: SheetEx; cardio: boolean };

type ConfigModeFieldsProps = {
  mode: Mode;
  cardio: boolean;
  config: ExConfig;
  setConfig: (updateConfig: (previous: ExConfig) => ExConfig) => void;
  bodyweight: boolean;
  barbell: boolean;
  unit: Unit;
};

type ConfigOptionsProps = {
  mode: Mode;
  bodyweight: boolean;
  perSide: boolean;
  barbell: boolean;
  barWeight: number;
  config: ExConfig;
  setConfig: (updateConfig: (previous: ExConfig) => ExConfig) => void;
  unit: Unit;
};

type ConfigRangeHelpProps = { config: ExConfig };

type ExConfigSheetProps = {
  exercise: SheetEx;
  existing: ExConfig | null;
  onSave: (config: ExConfig) => void;
  onDelete?: (() => void) | null;
  close: SheetClose;
  routine: Routine | null;
  openCustom: (exercise: CustomEx) => void;
};

function useAppState() {
  return useStore((state) => state.appState);
}

type ProgressionOption = PolicyId | "";

const isCustomExercise = (exercise: SheetEx): exercise is CustomEx => exercise.custom === true;

function ProgressionFields({
  exercise,
  mode,
  config,
  setConfig,
  routine,
  unit,
}: ProgressionFieldsProps) {
  const { t } = useTranslation();
  const progressionLabels = useProgressionLabels();
  const policyOptions: PolicyId[] = POLICIES_FOR[mode] || ["off"];

  if (policyOptions.length < 2) {
    return null;
  }

  const inheritedPolicy = progressionPolicyFor({ id: exercise.id }, routine, mode);
  const activePolicy = progressionPolicyFor({ ...config, id: exercise.id }, routine, mode);

  const increment =
    config.inc && config.inc > 0
      ? config.inc
      : mode === "time"
        ? 5
        : defaultIncrement(exercise.id, unit);

  return (
    <>
      <h4 className="my-5.5 mb-2 px-1 text-sm font-normal tracking-tight text-foreground/60">
        {t("progression.progression", "Progression")}
      </h4>
      <div className="mb-2 overflow-hidden rounded-lg bg-card">
        <SelectRow<ProgressionOption>
          title={t("progression.rule", "Rule")}
          sheetTitle={t("progression.progression", "Progression")}
          value={config.prog || ""}
          onChange={(value) => setConfig((previous) => ({ ...previous, prog: value || undefined }))}
          options={[
            {
              value: "",
              label: t("progression.followRoutine", "Follow the routine ({{policy}})", {
                policy: progressionLabels[inheritedPolicy].name,
              }),
            },
            ...policyOptions.map((policy) => ({
              value: policy,
              label: progressionLabels[policy].name,
            })),
          ]}
        />
      </div>
      <div
        className={
          activePolicy === "off"
            ? "mb-4.5 text-sm leading-snug text-muted-foreground"
            : "mb-2.5 text-sm leading-snug text-muted-foreground"
        }
      >
        {progressionLabels[activePolicy].description}
      </div>
      {activePolicy !== "off" && (
        <div className="mb-4.5 flex gap-2 [&>div]:min-w-0 [&>div]:flex-1">
          <Stepper
            label={
              mode === "time"
                ? t("progression.stepSeconds", "Step (seconds)")
                : t("progression.step", "Step ({{weight}})", { weight: unit })
            }
            value={increment}
            step={mode === "time" ? 5 : 1.25}
            decimal={mode !== "time"}
            onChange={(value) =>
              setConfig((previous) => ({
                ...previous,
                inc: value ?? undefined,
              }))
            }
          />
          {activePolicy === "double" && (
            <Stepper
              label={t("progression.repsFrom", "Reps from")}
              value={config.repsMin || Math.max(1, (config.reps || 10) - 2)}
              step={1}
              decimal={false}
              onChange={(value) =>
                setConfig((previous) => ({
                  ...previous,
                  repsMin: value ?? undefined,
                }))
              }
            />
          )}
        </div>
      )}
    </>
  );
}

function ConfigExerciseIntro({ exercise, cardio }: ConfigExerciseIntroProps) {
  const { t } = useTranslation();
  const metadata = useExerciseMetadataLabels();
  const catalogExercise = toCatalogExercise(exercise);

  return (
    <>
      <h3 className="capitalize">{catalogExercise.n}</h3>
      <Media exercise={catalogExercise} />
      <div className="my-2.5 mb-3.5 flex flex-wrap gap-1.5">
        {cardio && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            <Icon name="figureRun" />
            {t("workout.type.cardio", "Cardio")}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/60">
          {metadata.muscle(catalogExercise.tg || catalogExercise.bp)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground/60">
          {metadata.equipment(catalogExercise.eq)}
        </span>
      </div>
      {exercise.desc && (
        <div className="mb-2.5 rounded-lg bg-card px-4 py-3 text-base leading-normal whitespace-pre-wrap text-foreground/60">
          {exercise.desc}
        </div>
      )}
    </>
  );
}

function ConfigModeFields({
  mode,
  cardio,
  config,
  setConfig,
  bodyweight,
  barbell,
  unit,
}: ConfigModeFieldsProps) {
  const { t } = useTranslation();

  const weightLabel = barbell
    ? t("exercise.totalWeight", "Total weight ({{unit}})", { unit })
    : t("exercise.weight", "Weight ({{unit}})", { unit });

  const weightStep = barbell && unit === "lb" ? 5 : 2.5;

  return (
    <div
      className={
        mode === "time"
          ? "mb-2 flex gap-2 [&>div]:min-w-0 [&>div]:flex-1"
          : "mb-4.5 flex gap-2 [&>div]:min-w-0 [&>div]:flex-1"
      }
    >
      {cardio ? (
        <>
          <Stepper
            label={t("exercise.intervals", "Intervals")}
            value={config.sets}
            step={1}
            decimal={false}
            onChange={(value) => setConfig((previous) => ({ ...previous, sets: value ?? 0 }))}
          />
          <Stepper
            label={t("exercise.minutes", "Minutes")}
            value={config.min}
            step={1}
            decimal={false}
            onChange={(value) =>
              setConfig((previous) => ({ ...previous, min: value ?? undefined }))
            }
          />
          <Stepper
            label={t("exercise.speedKmH", "Speed (km/h)")}
            value={config.speed}
            step={0.5}
            onChange={(value) =>
              setConfig((previous) => ({ ...previous, speed: value ?? undefined }))
            }
          />
        </>
      ) : mode === "time" ? (
        <>
          <Stepper
            label={t("exercise.sets", "Sets")}
            value={config.sets}
            step={1}
            decimal={false}
            onChange={(value) => setConfig((previous) => ({ ...previous, sets: value ?? 0 }))}
          />
          <Stepper
            label={t("progression.seconds", "Seconds")}
            value={config.sec}
            step={5}
            decimal={false}
            onChange={(value) =>
              setConfig((previous) => ({ ...previous, sec: value ?? undefined }))
            }
          />
          <Stepper
            label={weightLabel}
            value={config.weight}
            step={weightStep}
            onChange={(value) =>
              setConfig((previous) => ({ ...previous, weight: value ?? undefined }))
            }
          />
        </>
      ) : (
        <>
          <Stepper
            label={t("exercise.sets", "Sets")}
            value={config.sets}
            step={1}
            decimal={false}
            onChange={(value) => setConfig((previous) => ({ ...previous, sets: value ?? 0 }))}
          />
          <Stepper
            label={t("exercise.reps", "Reps")}
            value={config.reps}
            step={config.side ? 2 : 1}
            decimal={false}
            onChange={(value) =>
              setConfig((previous) => ({ ...previous, reps: value ?? undefined }))
            }
          />
          {!bodyweight && (
            <Stepper
              label={weightLabel}
              value={config.weight}
              step={weightStep}
              onChange={(value) =>
                setConfig((previous) => ({ ...previous, weight: value ?? undefined }))
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function ConfigOptions({
  mode,
  bodyweight,
  perSide,
  barbell,
  barWeight,
  config,
  setConfig,
  unit,
}: ConfigOptionsProps) {
  const { t } = useTranslation();

  return (
    <>
      {mode === "time" && !bodyweight && (
        <div className="mb-4.5 text-sm leading-snug text-muted-foreground">
          {t(
            "progression.timerRunsWhileHoldSet",
            "A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.",
          )}
        </div>
      )}
      {mode !== "cardio" && (
        <div className="mb-2 overflow-hidden rounded-lg bg-card">
          <Row
            icon="figureStrength"
            iconTint="var(--primary)"
            title={t("exercise.measurement.bodyweight", "Bodyweight")}
            subtitle={
              bodyweight
                ? t(
                    "exercise.measurement.noWeightEnterJustLog",
                    "No weight to enter — just log the reps.",
                  )
                : t("exercise.measurement.askWeightEverySet", "Ask for a weight on every set.")
            }
          >
            <Switch
              aria-label={t("exercise.measurement.bodyweight", "Bodyweight")}
              checked={bodyweight}
              onCheckedChange={(checked) =>
                setConfig((previous) => ({
                  ...previous,
                  bodyweight: checked,
                  weight: checked ? 0 : barbell ? barWeight : previous.weight,
                }))
              }
            />
          </Row>
          {mode === "reps" && (
            <Row
              icon="shuffle"
              iconTint="var(--system-blue)"
              title={t("exercise.measurement.repsPerSide", "Reps per side")}
              subtitle={
                perSide
                  ? t(
                      "exercise.measurement.stillLogTotalPerSide",
                      "You still log the total: {{total}} is {{perSide}} per side.",
                      {
                        total: config.reps || 0,
                        perSide: fmtNum(sideReps(config.reps)),
                      },
                    )
                  : t(
                      "exercise.measurement.lungesSingleArmRowsLike",
                      "For lunges, single-arm rows and the like.",
                    )
              }
            >
              <Switch
                aria-label={t("exercise.measurement.repsPerSide", "Reps per side")}
                checked={perSide}
                onCheckedChange={(checked) =>
                  setConfig((previous) => ({
                    ...previous,
                    side: checked || undefined,
                    reps: checked ? Math.ceil((previous.reps || 0) / 2) * 2 : previous.reps,
                  }))
                }
              />
            </Row>
          )}
        </div>
      )}
      {bodyweight && (
        <div className="mb-2 flex gap-2 [&>div]:min-w-0 [&>div]:flex-1">
          <Stepper
            label={t("exercise.measurement.added", "Added ({{unit}})", { unit })}
            value={config.weight || 0}
            step={2.5}
            onChange={(value) =>
              setConfig((previous) => ({ ...previous, weight: value ?? undefined }))
            }
          />
        </div>
      )}
      {mode === "reps" && bodyweight && !(config.weight && config.weight > 0) && (
        <div className="mb-4.5 flex gap-2 [&>div]:min-w-0 [&>div]:flex-1">
          <Stepper
            label={t("exercise.measurement.topRange", "Top of the range")}
            value={config.repsMax || 0}
            step={1}
            decimal={false}
            onChange={(value) =>
              setConfig((previous) => ({ ...previous, repsMax: value ?? undefined }))
            }
          />
        </div>
      )}
    </>
  );
}

function ConfigRangeHelp({ config }: ConfigRangeHelpProps) {
  const { t } = useTranslation();

  if (!(config.repsMax && config.repsMax > 0)) {
    return null;
  }

  return (
    <div className="-mt-2.5 mb-4.5 text-sm leading-snug text-muted-foreground">
      {t(
        "exercise.measurement.repsClimbSetAddedReps",
        "Reps climb to {{maxReps}}, then a set is added and the reps start over. At {{maxSets}} sets it asks you to add weight instead.",
        { maxReps: config.repsMax, maxSets: MAX_BW_SETS },
      )}
    </div>
  );
}

export function ExConfigSheet({
  exercise,
  existing,
  onSave,
  onDelete,
  close,
  routine,
  openCustom,
}: ExConfigSheetProps) {
  const { t } = useTranslation();
  const appState = useAppState();
  const cardio = isCardio(exercise.id);
  const barbell = isBarbellEq(exercise);
  const barWeight = barWeightFor(appState.unit, appState.plates);

  const initialConfig = existing
    ? {
        ...existing,
        weight:
          barbell &&
          !isBw({ ...existing, id: exercise.id }) &&
          !(existing.weight && existing.weight > 0)
            ? barWeight
            : existing.weight,
      }
    : defaultConfig(exercise.id, undefined, barWeight);

  const { control, getValues, handleSubmit, reset } = useForm<ExConfig>({
    defaultValues: {
      ...initialConfig,
      id: exercise.id,
    },
    resolver: valibotResolver(createExerciseConfigFormSchema(t)),
  });

  useWatch({ control });
  const config = getValues();

  const setConfig = (updateConfig: (previous: ExConfig) => ExConfig) =>
    reset(updateConfig(getValues()));

  const mode: Mode = cardio ? "cardio" : modeOf({ ...config, id: exercise.id });
  const bodyweight = !cardio && isBw({ ...config, id: exercise.id });
  const perSide = isPerSide(config);

  const setMode = (nextMode: "reps" | "time") =>
    setConfig((previous) => {
      const nextDefaults = defaultConfig(exercise.id, nextMode, barWeight);

      return {
        ...nextDefaults,
        ...previous,
        weight:
          !isBw({ ...previous, id: exercise.id }) && !(previous.weight && previous.weight > 0)
            ? nextDefaults.weight
            : previous.weight,
        mode: nextMode,
      };
    });

  const saveConfig = async (submittedConfig: ExConfig) => {
    await close();
    const sets = Math.max(1, Math.round(submittedConfig.sets) || (cardio ? 1 : 3));
    const progression: Partial<ExConfig> = {};

    if (submittedConfig.prog) {
      progression.prog = submittedConfig.prog;
    }

    if (submittedConfig.inc && submittedConfig.inc > 0) {
      progression.inc = submittedConfig.inc;
    }

    const flags: Partial<ExConfig> = {};

    if (bodyweight !== isBodyweightEq(exercise.id)) {
      flags.bodyweight = bodyweight;
    }

    if (cardio) {
      onSave({
        id: exercise.id,
        sets,
        min: Math.max(1, Math.round(submittedConfig.min ?? 0) || 20),
        speed: Math.max(0, submittedConfig.speed || 8),
      });
    } else if (mode === "time") {
      onSave({
        id: exercise.id,
        sets,
        mode: "time",
        sec: Math.max(1, Math.round(submittedConfig.sec ?? 0) || 45),
        weight: Math.max(0, submittedConfig.weight || 0),
        ...flags,
        ...progression,
      });
    } else {
      const typedReps = Math.max(1, Math.round(submittedConfig.reps ?? 0) || 10);
      const reps = perSide ? Math.ceil(typedReps / 2) * 2 : typedReps;

      const savedConfig: ExConfig = {
        id: exercise.id,
        sets,
        mode: "reps",
        reps,
        weight: Math.max(0, submittedConfig.weight || 0),
        ...flags,
        ...progression,
      };

      if (perSide) {
        savedConfig.side = true;
      }

      if (
        progressionPolicyFor({ ...submittedConfig, id: exercise.id }, routine, "reps") === "double"
      ) {
        savedConfig.repsMin = Math.min(
          reps,
          Math.max(1, Math.round(submittedConfig.repsMin ?? 0) || Math.max(1, reps - 2)),
        );
      }

      if (
        bodyweight &&
        !(savedConfig.weight && savedConfig.weight > 0) &&
        submittedConfig.repsMax &&
        submittedConfig.repsMax > 0
      ) {
        savedConfig.repsMax = Math.max(reps, Math.round(submittedConfig.repsMax));
      }

      onSave(savedConfig);
    }
  };

  const customExercise = isCustomExercise(exercise) ? exercise : null;

  return (
    <form onSubmit={(event) => void handleSubmit(saveConfig)(event)}>
      <ConfigExerciseIntro exercise={exercise} cardio={cardio} />
      {!cardio && (
        <div className="mb-3.5">
          <Segmented<"reps" | "time">
            className="mb-2.5"
            value={mode === "time" ? "time" : "reps"}
            onChange={setMode}
            options={[
              { value: "reps", label: t("exercise.reps", "Reps") },
              { value: "time", label: t("progression.time", "Time") },
            ]}
          />
        </div>
      )}
      <ConfigModeFields
        mode={mode}
        cardio={cardio}
        config={config}
        setConfig={setConfig}
        bodyweight={bodyweight}
        barbell={barbell}
        unit={appState.unit}
      />
      {barbell && !bodyweight && (config.weight ?? 0) > 0 && (
        <div className="-mt-2 mb-4.5">
          <PlateRow weight={config.weight ?? barWeight} />
        </div>
      )}
      <ConfigOptions
        mode={mode}
        bodyweight={bodyweight}
        perSide={perSide}
        barbell={barbell}
        barWeight={barWeight}
        config={config}
        setConfig={setConfig}
        unit={appState.unit}
      />
      {mode === "reps" && bodyweight && !(config.weight && config.weight > 0) && (
        <ConfigRangeHelp config={config} />
      )}
      <ProgressionFields
        exercise={exercise}
        mode={mode}
        config={config}
        setConfig={setConfig}
        routine={routine}
        unit={appState.unit}
      />
      <Field>
        <Button type="submit" variant="default">
          {existing
            ? t("workout.completion.save", "Save")
            : t("exercise.addRoutine", "Add to routine")}
        </Button>
        {customExercise && (
          <Button
            type="button"
            onClick={() =>
              void close().then((): undefined => {
                openCustom(customExercise);
              })
            }
          >
            <Icon name="pencil" />
            {t("customExercise.editDeleteExercise", "Edit or delete this exercise")}
          </Button>
        )}
        {onDelete && (
          <Button
            type="button"
            variant="destructive"
            onClick={() =>
              void close().then((): undefined => {
                onDelete();
              })
            }
          >
            {t("customExercise.removeRoutine", "Remove from routine")}
          </Button>
        )}
      </Field>
    </form>
  );
}
