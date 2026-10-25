import * as v from "valibot";

type Translate = (key: string, defaultValue: string) => string;

const finiteNumber = (message: string) =>
  v.pipe(
    v.number(message),
    v.check((value) => Number.isFinite(value), message),
  );

const nonNegativeNumber = (message: string) =>
  v.pipe(finiteNumber(message), v.minValue(0, message));

const positiveNumber = (message: string) =>
  v.pipe(finiteNumber(message), v.minValue(Number.MIN_VALUE, message));

const nonEmptyString = (message: string) => v.pipe(v.string(), v.trim(), v.minLength(1, message));

export const createRegistrationFormSchema = (t: Translate, inviteOnly: boolean) =>
  v.object({
    name: nonEmptyString(t("account.enterName", "Enter a name")),
    inviteCode: inviteOnly
      ? nonEmptyString(t("customExercise.inviteCodeRequired", "An invite code is required"))
      : v.pipe(v.string(), v.trim()),
  });

export const createWeightFormSchema = (t: Translate) => {
  const message = t("weight.enterValidWeight", "Enter a valid weight");

  return v.object({ weight: positiveNumber(message) });
};

export const createTopWeightFormSchema = (t: Translate) => {
  const message = t("weight.enterValidWeight", "Enter a valid weight");

  return v.object({ weight: nonNegativeNumber(message) });
};

export const createCustomExerciseFormSchema = (t: Translate) =>
  v.object({
    name: nonEmptyString(t("customExercise.giveName", "Give it a name")),
    bodyPart: nonEmptyString(t("customExercise.pickBodyPart", "Pick a body part")),
    description: v.pipe(v.string(), v.trim(), v.maxLength(1000)),
  });

const optionalMeasurement = (message: string) => v.optional(positiveNumber(message));

export const createMeasurementsFormSchema = (t: Translate) => {
  const message = t("measurements.enterAtLeastOne", "Enter at least one measurement");

  return v.pipe(
    v.object({
      chest: optionalMeasurement(message),
      waist: optionalMeasurement(message),
      hips: optionalMeasurement(message),
      arm: optionalMeasurement(message),
      thigh: optionalMeasurement(message),
    }),
    v.check((values) => Object.values(values).some((value) => value != null), message),
  );
};

export const createStartingStrengthFormSchema = (t: Translate) => {
  const message = t("startingSetup.validWeights", "Enter a starting weight for every lift");

  return v.object({
    experience: v.picklist(["new", "some", "confident"]),
    unit: v.picklist(["lb", "kg"]),
    weights: v.object({
      "0043": positiveNumber(message),
      "0025": positiveNumber(message),
      "0027": positiveNumber(message),
      "1456": positiveNumber(message),
      "0032": positiveNumber(message),
    }),
  });
};

export const createExerciseConfigFormSchema = (t: Translate) => {
  const message = t("weight.enterValidWeight", "Enter a valid weight");

  return v.object({
    fivefold: v.optional(
      v.object({
        unit: v.optional(v.picklist(["kg", "lb"])),
        failures: nonNegativeNumber(message),
        bar: positiveNumber(message),
        autoProgress: v.boolean(),
        autoDeload: v.boolean(),
        lastWorkoutId: v.optional(v.string()),
      }),
    ),
    id: nonEmptyString(message),
    sets: nonNegativeNumber(message),
    mode: v.optional(v.picklist(["reps", "time", "cardio"])),
    reps: v.optional(nonNegativeNumber(message)),
    weight: v.optional(nonNegativeNumber(message)),
    sec: v.optional(nonNegativeNumber(message)),
    min: v.optional(nonNegativeNumber(message)),
    speed: v.optional(nonNegativeNumber(message)),
    bodyweight: v.optional(v.boolean()),
    side: v.optional(v.boolean()),
    prog: v.optional(v.picklist(["off", "linear", "greyskull", "double", "time", "fivefold"])),
    inc: v.optional(nonNegativeNumber(message)),
    repsMin: v.optional(nonNegativeNumber(message)),
    repsMax: v.optional(nonNegativeNumber(message)),
    sg: v.optional(v.string()),
  });
};

export const planImportFormSchema = v.object({ schedule: v.boolean() });

export const noteFormSchema = v.object({ note: v.string() });

export const routineNameFormSchema = v.object({ name: v.string() });
