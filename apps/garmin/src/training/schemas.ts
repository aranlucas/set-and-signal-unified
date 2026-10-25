import * as z from "zod";
import { calendarDate, isBoundedDateRange } from "../tool-input";

export const trainingId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// Training API V2 2.0 (2026-10-15), sections 3–4. Bounds below are local limits.
export const workoutStep = z
  .strictObject({
    type: z.literal("WorkoutStep"),
    stepOrder: z.number().int().min(1).max(250),
    intensity: z.enum(["WARMUP", "ACTIVE", "RECOVERY", "REST", "COOLDOWN", "INTERVAL", "MAIN"]),
    description: z.string().max(512).optional(),
    durationType: z.enum(["TIME", "DISTANCE", "OPEN", "REPS"]),
    durationValue: z
      .number()
      .positive()
      .optional()
      .describe(
        "Seconds for TIME; meters for DISTANCE; count for REPS. Omit for OPEN (lap button).",
      ),
    targetType: z.enum(["OPEN", "PACE", "SPEED", "HEART_RATE", "POWER", "CADENCE", "SWIM_STROKE"]),
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
      .enum([
        "BACKSTROKE",
        "BREASTSTROKE",
        "BUTTERFLY",
        "FREESTYLE",
        "MIXED",
        "IM",
        "RIMO",
        "CHOICE",
      ])
      .optional(),
    drillType: z.enum(["KICK", "PULL", "BUTTERFLY"]).optional(),
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

    if (
      !["OPEN", "SWIM_STROKE"].includes(step.targetType) &&
      !hasRange &&
      step.targetValue === undefined
    ) {
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

    if (
      step.targetValue !== undefined &&
      step.targetValue > (step.targetType === "HEART_RATE" ? 5 : 7)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targetValue"],
        message: "Heart-rate zones are 1–5; power zones are 1–7.",
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
  stepOrder: z.number().int().min(1).max(250),
  repeatType: z.literal("REPEAT_UNTIL_STEPS_CMPLT"),
  repeatValue: z.number().int().min(2).max(100),
  steps: z.array(workoutStep).min(1).max(50),
});

const sport = z.enum([
  "RUNNING",
  "CYCLING",
  "LAP_SWIMMING",
  "STRENGTH_TRAINING",
  "CARDIO_TRAINING",
  "GENERIC",
  "YOGA",
  "PILATES",
]);

const segment = z.strictObject({
  segmentOrder: z.number().int().min(1).max(25),
  sport,
  poolLength: z.number().positive().nullable().optional(),
  poolLengthUnit: z.enum(["METER", "YARD"]).nullable().optional(),
  steps: z
    .array(z.discriminatedUnion("type", [workoutStep, workoutRepeatStep]))
    .min(1)
    .max(100),
});

export const workoutInput = z
  .strictObject({
    workoutName: z.string().trim().min(1).max(100),
    description: z.string().max(1024).optional(),
    sport: z.enum([...sport.options, "MULTI_SPORT"]),
    workoutProvider: z.string().trim().min(1).max(20).default("Garmin MCP"),
    workoutSourceId: z.string().trim().min(1).max(20).default("Garmin MCP"),
    isSessionTransitionEnabled: z.boolean().optional(),
    poolLength: z.number().positive().nullable().optional(),
    poolLengthUnit: z.enum(["METER", "YARD"]).nullable().optional(),
    segments: z.array(segment).min(1).max(25),
  })
  .superRefine((workout, ctx) => {
    const multi = workout.sport === "MULTI_SPORT";

    if (!multi && (workout.segments.length !== 1 || workout.segments[0]?.sport !== workout.sport)) {
      ctx.addIssue({
        code: "custom",
        path: ["segments"],
        message: "Single-sport workouts require one matching segment.",
      });
    }

    const segmentOrders = workout.segments.map((item) => item.segmentOrder);

    const orders = workout.segments.flatMap((item) =>
      item.steps.flatMap((step) =>
        step.type === "WorkoutRepeatStep"
          ? [step.stepOrder, ...step.steps.map((child) => child.stepOrder)]
          : [step.stepOrder],
      ),
    );

    for (const values of [segmentOrders, orders]) {
      if (values.some((order, index) => index > 0 && order <= (values[index - 1] ?? 0))) {
        ctx.addIssue({
          code: "custom",
          path: ["segments"],
          message: "Segment and step orders must be unique and globally increasing.",
        });
      }
    }

    if (orders.length > (multi ? 250 : 100)) {
      ctx.addIssue({
        code: "custom",
        path: ["segments"],
        message:
          "Use at most 100 steps for single sport or 250 for multisport, including repeat children.",
      });
    }

    for (const [index, item] of workout.segments.entries()) {
      if (
        multi &&
        item.sport === "LAP_SWIMMING" &&
        ((item.poolLength ?? null) !== (workout.poolLength ?? null) ||
          (item.poolLengthUnit ?? null) !== (workout.poolLengthUnit ?? null))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index],
          message: "Multisport swim pool settings must match the workout pool settings.",
        });
      }

      const steps = item.steps.flatMap((step) =>
        step.type === "WorkoutRepeatStep" ? step.steps : [step],
      );

      for (const step of steps) {
        if (item.sport === "LAP_SWIMMING" && step.targetType !== "SWIM_STROKE") {
          ctx.addIssue({
            code: "custom",
            path: ["segments", index, "steps"],
            message: "Swim steps use SWIM_STROKE as their primary target.",
          });
        }

        if (
          step.durationType === "REPS" &&
          !["STRENGTH_TRAINING", "CARDIO_TRAINING"].includes(item.sport)
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["segments", index, "steps"],
            message: "REPS requires strength or cardio training.",
          });
        }
      }
    }
  });

export const createWorkoutInput = z.strictObject({ workout: workoutInput });

export const updateWorkoutInput = z.strictObject({
  workoutId: trainingId,
  ownerId: trainingId,
  workout: workoutInput,
});

export const getWorkoutInput = z.strictObject({ workoutId: trainingId });

export const scheduleWorkoutInput = z.strictObject({ workoutId: trainingId, date: calendarDate });

export const updateScheduleInput = z.strictObject({
  scheduleId: trainingId,
  workoutId: trainingId,
  date: calendarDate,
});

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
  ownerId: trainingId.optional(),
  segments: z.array(
    z.looseObject({
      segmentOrder: z.number().int(),
      sport: z.string(),
      steps: z.array(z.looseObject({ type: z.string(), stepOrder: z.number().int() })),
    }),
  ),
});

export const scheduleResponse = z.looseObject({
  scheduleId: trainingId,
  workoutId: trainingId,
  date: calendarDate,
});

export const schedulesResponse = z.array(scheduleResponse);

export type WorkoutInput = z.input<typeof workoutInput>;

export type ScheduleInput = z.infer<typeof scheduleWorkoutInput>;

export const mutationAccepted = z.object({ accepted: z.literal(true) });

export const workoutWriteResponse = z.union([workoutResponse, mutationAccepted]);

// Live Garmin create responses return the numeric schedule ID, not a full schedule object.
export const scheduleWriteResponse = z.union([
  scheduleResponse,
  trainingId.transform((scheduleId) => ({ scheduleId })),
  mutationAccepted,
]);

export type TrainingData =
  | z.infer<typeof workoutWriteResponse>
  | z.infer<typeof scheduleWriteResponse>
  | z.infer<typeof schedulesResponse>;
