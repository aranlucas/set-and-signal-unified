import * as z from "zod";
import { calendarDate, isBoundedDateRange } from "../tool-input";

export const trainingId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// Provisional Training API subset; reconcile with the approved portal reference before enabling.
export const workoutStep = z
  .strictObject({
    type: z.literal("WorkoutStep"),
    stepOrder: z.number().int().min(1).max(200),
    intensity: z.enum(["WARMUP", "ACTIVE", "RECOVERY", "REST", "COOLDOWN", "INTERVAL"]),
    description: z.string().max(1024).optional(),
    durationType: z.enum(["TIME", "DISTANCE", "OPEN", "REPS"]),
    durationValue: z
      .number()
      .positive()
      .optional()
      .describe(
        "Seconds for TIME; meters for DISTANCE; count for REPS. Omit for OPEN (lap button).",
      ),
    targetType: z.enum(["OPEN", "PACE", "SPEED", "HEART_RATE", "POWER", "CADENCE"]),
    targetValue: z
      .number()
      .positive()
      .optional()
      .describe(
        "Previously configured Garmin heart-rate or power zone; use a range instead for absolute values.",
      ),
    targetValueLow: z.number().nonnegative().optional(),
    targetValueHigh: z.number().positive().optional(),
    targetValueType: z.literal("PERCENT").optional(),
    strokeType: z
      .enum(["BACKSTROKE", "BREASTSTROKE", "DRILL", "BUTTERFLY", "FREESTYLE", "MIXED", "IM"])
      .optional(),
    equipmentType: z
      .enum([
        "NONE",
        "SWIM_FINS",
        "SWIM_KICKBOARD",
        "SWIM_PADDLES",
        "SWIM_PULL_BUOY",
        "SWIM_SNORKEL",
      ])
      .optional(),
    exerciseCategory: z.string().min(1).max(100).optional(),
    exerciseName: z.string().min(1).max(100).optional(),
    weightValue: z
      .number()
      .nonnegative()
      .optional()
      .describe("Weight in kilograms, regardless of display unit."),
    weightDisplayUnit: z.enum(["KILOGRAM", "POUND"]).optional(),
  })
  .superRefine((step, ctx) => {
    if (
      step.durationType === "OPEN"
        ? step.durationValue !== undefined
        : step.durationValue === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["durationValue"],
        message: "Provide durationValue for timed, distance, or reps steps; omit it for OPEN.",
      });
    }

    if (
      step.durationType === "REPS" &&
      step.durationValue !== undefined &&
      !Number.isInteger(step.durationValue)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["durationValue"],
        message: "Repetitions must be a whole number.",
      });
    }

    const low = step.targetValueLow;
    const high = step.targetValueHigh;
    const hasRange = low !== undefined || high !== undefined;

    if (
      (hasRange && (low === undefined || high === undefined || low > high)) ||
      (hasRange && step.targetValue !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targetValueLow"],
        message: "Supply an ordered low/high range or one zone, not both.",
      });
    }

    if (
      step.targetType === "OPEN" &&
      (hasRange || step.targetValue !== undefined || step.targetValueType !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targetType"],
        message: "OPEN targets cannot have target values.",
      });
    }

    if (step.targetType !== "OPEN" && !hasRange && step.targetValue === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["targetType"],
        message: "Provide a target zone or a low/high range.",
      });
    }

    if (
      step.targetValue !== undefined &&
      (!["HEART_RATE", "POWER"].includes(step.targetType) || !Number.isInteger(step.targetValue))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targetValue"],
        message: "Zones are whole numbers for HEART_RATE or POWER.",
      });
    }

    if (step.targetValueType !== undefined && !["HEART_RATE", "POWER"].includes(step.targetType)) {
      ctx.addIssue({
        code: "custom",
        path: ["targetValueType"],
        message: "Percentage targets apply to HEART_RATE or POWER.",
      });
    }
  });

export const workoutRepeatStep = z.strictObject({
  type: z.literal("WorkoutRepeatStep"),
  stepOrder: z.number().int().min(1).max(200),
  repeatType: z.literal("REPEAT_UNTIL_STEPS_CMPLT"),
  repeatValue: z.number().int().min(2).max(100),
  steps: z.array(workoutStep).min(1).max(50),
});

export const workoutInput = z
  .strictObject({
    workoutName: z.string().trim().min(1).max(100),
    description: z.string().max(1024).optional(),
    sport: z.enum([
      "RUNNING",
      "CYCLING",
      "LAP_SWIMMING",
      "STRENGTH_TRAINING",
      "CARDIO_TRAINING",
      "GENERIC",
      "YOGA",
      "PILATES",
    ]),
    poolLength: z.number().positive().optional(),
    poolLengthUnit: z.enum(["METER", "YARD"]).optional(),
    steps: z
      .array(z.discriminatedUnion("type", [workoutStep, workoutRepeatStep]))
      .min(1)
      .max(100),
  })
  .superRefine((workout, ctx) => {
    if (
      workout.sport === "LAP_SWIMMING"
        ? workout.poolLength === undefined || workout.poolLengthUnit === undefined
        : workout.poolLength !== undefined || workout.poolLengthUnit !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["poolLength"],
        message:
          "Pool swimming requires poolLength and poolLengthUnit; omit them for other sports.",
      });
    }

    const orders = workout.steps.flatMap((step) =>
      step.type === "WorkoutRepeatStep"
        ? [step.stepOrder, ...step.steps.map((child) => child.stepOrder)]
        : [step.stepOrder],
    );

    if (
      orders.length > 200 ||
      new Set(orders).size !== orders.length ||
      orders.some((order, index) => index > 0 && order <= (orders[index - 1] ?? 0))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message:
          "Use at most 200 steps with unique, increasing stepOrder values, including steps inside repeats.",
      });
    }
  });

export const createWorkoutInput = z.strictObject({ workout: workoutInput });

export const getWorkoutInput = z.strictObject({ workoutId: trainingId });

export const scheduleWorkoutInput = z.strictObject({ workoutId: trainingId, date: calendarDate });

export const getScheduleInput = z.strictObject({ scheduleId: trainingId });

export const listSchedulesInput = z
  .strictObject({ startDate: calendarDate, endDate: calendarDate })
  .refine(
    ({ startDate, endDate }) => isBoundedDateRange(startDate, endDate),
    "Use an ordered date range of at most 31 calendar days.",
  );

// Preserve additional Garmin fields; IDs are validated before being used in subsequent calls.
export const workoutResponse = z.looseObject({
  workoutId: trainingId,
  workoutName: z.string(),
  sport: z.string(),
  steps: z.array(z.looseObject({ type: z.string(), stepOrder: z.number().int() })),
});

export const scheduleResponse = z.looseObject({
  scheduleId: trainingId,
  workoutId: trainingId,
  date: calendarDate,
});

export const schedulesResponse = z.array(scheduleResponse);

export type WorkoutInput = z.infer<typeof workoutInput>;

export type ScheduleInput = z.infer<typeof scheduleWorkoutInput>;

export type TrainingData =
  | z.infer<typeof workoutResponse>
  | z.infer<typeof scheduleResponse>
  | z.infer<typeof schedulesResponse>;
