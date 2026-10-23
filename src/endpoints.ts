import * as z from "zod";
import * as models from "./garmin-api/zod.gen";
import { garminFileSchema } from "./garmin";
import { READ_SCOPE, WOMENS_SCOPE, type GarminScope } from "./scopes";
import {
  activityId,
  calendarDate,
  DATE_RANGE_MESSAGE,
  isBoundedDateRange,
  isOrderedDateRange,
  type ToolArguments,
} from "./tool-input";

type EndpointDefinition<Input extends z.ZodType<ToolArguments>, Output extends z.ZodType> = {
  name: string;
  description: string;
  path: string;
  inputSchema: Input;
  responseSchema: Output;
  pathParameters?: readonly (keyof z.output<Input> & string)[];
  responseType?: "json" | "file";
  requiredScope?: GarminScope;
};

function defineEndpoint<Input extends z.ZodType<ToolArguments>, Output extends z.ZodType>(
  definition: EndpointDefinition<Input, Output>,
) {
  return {
    ...definition,
    pathParameters: definition.pathParameters ?? [],
    responseType: definition.responseType ?? "json",
    requiredScope: definition.requiredScope ?? READ_SCOPE,
  };
}

// Tool contracts are native Zod schemas. Published response models are generated from Garmin's snapshot.
export const endpoints = [
  defineEndpoint({
    name: "get_activity",
    description: "Activity summary, metadata, measurements and splits.",
    path: "/activity-service/activity/{activityId}",
    pathParameters: ["activityId"],
    inputSchema: z.strictObject({
      activityId: activityId.describe("The ID of the activity to retrieve the summary"),
    }),
    responseSchema: models.zActivitySummaryDto,
  }),
  defineEndpoint({
    name: "get_activity_workouts",
    description: "Workouts associated with a recorded activity.",
    path: "/activity-service/activity/{activityId}/workouts",
    pathParameters: ["activityId"],
    inputSchema: z.strictObject({
      activityId: activityId.describe("The ID of the activity for which to retrieve workouts"),
    }),
    responseSchema: z.array(models.zActivityWorkoutDto),
  }),
  defineEndpoint({
    name: "list_activities",
    description: "Search recorded activities; paginate with start and limit.",
    path: "/activitylist-service/activities/search/activities",
    inputSchema: z
      .strictObject({
        start: z
          .number()
          .int()
          .nonnegative()
          .describe("Zero-based offset of the first activity to return. Defaults to 0.")
          .default(0),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .describe("Maximum number of activities to return. Defaults to 99.")
          .default(99),
        favorite: z
          .number()
          .int()
          .min(-1)
          .max(1)
          .describe(
            "Filter by favorite status: 1 returns favorites, 0 returns non-favorites, and -1 applies no favorite filter. Defaults to -1.",
          )
          .default(-1),
        sortOrder: z
          .string()
          .regex(/^(asc|desc)$/i)
          .describe(
            "Sort direction: asc for ascending or desc for descending, case-insensitive. Defaults to desc.",
          )
          .default("desc"),
        excludeChildren: z
          .boolean()
          .describe(
            "Whether to exclude child activities that have a parent activity, such as individual legs of a multisport activity. Defaults to true.",
          )
          .default(true),
        sortBy: z
          .string()
          .max(500)
          .describe(
            "Activity field to sort by, such as name, distance, or duration. Defaults to startLocal, the activity's local start date and time.",
          )
          .optional(),
        search: z
          .string()
          .max(500)
          .describe("Text to search for in activity names and descriptions.")
          .optional(),
        activityType: z
          .string()
          .max(500)
          .describe(
            "Parent activity type key to include, such as running or cycling. Must identify a parent type, not a subtype.",
          )
          .optional(),
        activitySubType: z
          .string()
          .max(500)
          .describe(
            "Activity subtype key to include. Must identify a child type and, if activityType is also provided, belong to that parent type. For example, use activitySubType=trail_running with activityType=running, or activitySubType=road_cycling with activityType=cycling.",
          )
          .optional(),
        eventType: z
          .string()
          .max(500)
          .describe(
            "Event classification key to include, such as race, training, recreation, fitness, specialEvent, or uncategorized.",
          )
          .optional(),
        minDistance: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive minimum activity distance, in meters.")
          .optional(),
        maxDistance: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive maximum activity distance, in meters.")
          .optional(),
        minDuration: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive minimum activity timer duration, in seconds.")
          .optional(),
        maxDuration: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive maximum activity timer duration, in seconds.")
          .optional(),
        minElevation: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive minimum total elevation gain for the activity, in meters.")
          .optional(),
        maxElevation: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive maximum total elevation gain for the activity, in meters.")
          .optional(),
        startDate: calendarDate
          .describe(
            "Inclusive earliest activity start date, based on the activity's local start time, in YYYY-MM-DD format.",
          )
          .optional(),
        endDate: calendarDate
          .describe(
            "Inclusive latest activity start date, based on the activity's local start time, in YYYY-MM-DD format.",
          )
          .optional(),
        upperLatitude: z
          .number()
          .min(-90)
          .max(90)
          .describe(
            "Northern latitude boundary of the bounding box for activity start locations, in decimal degrees. Provide all four latitude and longitude boundaries to apply this filter.",
          )
          .optional(),
        rightLongitude: z
          .number()
          .min(-180)
          .max(180)
          .describe(
            "Eastern longitude boundary of the bounding box for activity start locations, in decimal degrees. Provide all four latitude and longitude boundaries to apply this filter.",
          )
          .optional(),
        lowerLatitude: z
          .number()
          .min(-90)
          .max(90)
          .describe(
            "Southern latitude boundary of the bounding box for activity start locations, in decimal degrees. Provide all four latitude and longitude boundaries to apply this filter.",
          )
          .optional(),
        leftLongitude: z
          .number()
          .min(-180)
          .max(180)
          .describe(
            "Western longitude boundary of the bounding box for activity start locations, in decimal degrees. Provide all four latitude and longitude boundaries to apply this filter.",
          )
          .optional(),
        lowerMaxDepth: z
          .number()
          .int()
          .describe("Inclusive lower bound on the dive activity's maximum depth, in centimeters.")
          .optional(),
        upperMaxDepth: z
          .number()
          .int()
          .describe("Inclusive upper bound on the dive activity's maximum depth, in centimeters.")
          .optional(),
        decoDive: z
          .boolean()
          .describe(
            "Filter by decompression dive status: true returns decompression dives and false returns activities marked as non-decompression dives. Omit to apply no decompression dive filter.",
          )
          .optional(),
        minElapsedDuration: z
          .number()
          .int()
          .nonnegative()
          .describe(
            "Inclusive minimum total elapsed activity duration, including paused time, in seconds.",
          )
          .optional(),
        maxElapsedDuration: z
          .number()
          .int()
          .nonnegative()
          .describe(
            "Inclusive maximum total elapsed activity duration, including paused time, in seconds.",
          )
          .optional(),
        minBottomTime: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive minimum dive bottom time, in seconds.")
          .optional(),
        maxBottomTime: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive maximum dive bottom time, in seconds.")
          .optional(),
        minAvgPower: z
          .number()
          .int()
          .nonnegative()
          .describe("Inclusive minimum average activity power, in watts.")
          .optional(),
        excludedActivitySubType: z
          .array(z.string().max(200))
          .max(50)
          .describe(
            "Activity subtype keys to exclude. Repeat this query parameter to exclude multiple subtypes.",
          )
          .optional(),
        requiredField: z
          .array(z.string().max(200))
          .max(50)
          .describe(
            "Activity fields that must have a non-null value for an activity to be included. Repeat this query parameter to require multiple fields; all specified fields must be present.",
          )
          .optional(),
      })
      .refine(({ startDate, endDate }) => isOrderedDateRange(startDate, endDate), {
        message: "The start date must be on or before the end date.",
      }),
    responseSchema: z.array(models.zSummarizedActivityDto),
  }),
  defineEndpoint({
    name: "get_heart_rate_zones",
    description: "Configured heart rate zones.",
    path: "/biometric-service/heartRateZones/v2",
    inputSchema: z.strictObject({
      generateDefaults: z
        .boolean()
        .describe("Whether to generate default zones when the user has no configured zones.")
        .default(true),
    }),
    responseSchema: z.array(models.zHeartRateZonesDto),
  }),
  defineEndpoint({
    name: "download_activity_file",
    description:
      "Download the original activity file (FIT or archive) as base64; limited to 2 MiB.",
    path: "/download-service/files/activity/{activityId}",
    pathParameters: ["activityId"],
    inputSchema: z.strictObject({
      activityId: activityId,
    }),
    responseSchema: garminFileSchema,
    responseType: "file",
  }),
  defineEndpoint({
    name: "get_fitness_age",
    description: "Fitness age for a calendar date.",
    path: "/fitnessage-service/fitnessage/v2/{calendarDate}",
    pathParameters: ["calendarDate"],
    inputSchema: z.strictObject({
      calendarDate: calendarDate.describe(
        "The target date; Fitness Age information returned will be the latest available as of this date.",
      ),
      fullHistoryScan: z
        .boolean()
        .describe(
          "Whether to scan the full history to find the latest Fitness Age information. If false, only the last 28 days relative to the target calendar date will be considered.",
        )
        .default(true),
    }),
    responseSchema: z.array(models.zFitnessAgeDto),
  }),
  defineEndpoint({
    name: "get_weight_goals",
    description:
      "Effective weight goals for a date range. Date ranges are limited to 31 calendar days.",
    path: "/goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}",
    pathParameters: ["startDate", "endDate"],
    inputSchema: z
      .strictObject({
        startDate: calendarDate.describe("Beginning of the requested date interval."),
        endDate: calendarDate.describe("End of the requested date interval."),
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: models.zUserGoalsRangeDto,
  }),
  defineEndpoint({
    name: "get_hrv",
    description: "Heart rate variability for a date.",
    path: "/hrv-service/hrv/{calendarDate}",
    pathParameters: ["calendarDate"],
    inputSchema: z.strictObject({
      calendarDate: calendarDate,
    }),
    responseSchema: models.zHrvChartDto,
  }),
  defineEndpoint({
    name: "get_hrv_range",
    description:
      "Daily heart rate variability across a date range. Date ranges are limited to 31 calendar days.",
    path: "/hrv-service/hrv/daily/{fromDate}/{toDate}",
    pathParameters: ["fromDate", "toDate"],
    inputSchema: z
      .strictObject({
        fromDate: calendarDate,
        toDate: calendarDate,
      })
      .refine(({ fromDate, toDate }) => isBoundedDateRange(fromDate, toDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: models.zHrvDailySummaryDto,
  }),
  defineEndpoint({
    name: "get_nutrition",
    description: "Food logs, nutrition and goals for a date.",
    path: "/nutrition-service/food/logs/{date}",
    pathParameters: ["date"],
    inputSchema: z.strictObject({
      includeGoals: z
        .boolean()
        .describe("Goals are included by default unless requested with includeGoals=false")
        .default(true),
      includeNutrition: z
        .boolean()
        .describe(
          "Nutrition information is included by default unless requested with includeNutrition=false",
        )
        .default(true),
      includeMedia: z
        .boolean()
        .describe("Images is included by default unless requested with includeMedia=false")
        .default(true),
      mealId: z
        .number()
        .int()
        .describe("Id of the meal like id for Breakfast, Lunch, Snacks or Dinner")
        .optional(),
      date: calendarDate.describe(
        "Date for which to retrieve the daily nutrition logs. Date must be in the YYYY-MM-DD format. The date is interpreted in the user's local timezone.",
      ),
    }),
    responseSchema: models.zDailyNutritionSummaryDto,
  }),
  defineEndpoint({
    name: "get_menstrual_summary",
    description: "Menstrual cycle summary for a date. Requires separate women’s health consent.",
    path: "/periodichealth-service/menstrualcycle/summary/{calendarDate}",
    pathParameters: ["calendarDate"],
    inputSchema: z.strictObject({
      calendarDate: calendarDate.describe("The calendar date (yyyy-MM-dd) to retrieve data for."),
    }),
    responseSchema: models.zMenstrualCycleSummaryDto,
    requiredScope: WOMENS_SCOPE,
  }),
  defineEndpoint({
    name: "get_menstrual_day",
    description: "Detailed menstrual cycle day view. Requires separate women’s health consent.",
    path: "/periodichealth-service/menstrualcycle/dayview/{calendarDate}",
    pathParameters: ["calendarDate"],
    inputSchema: z.strictObject({
      calendarDate: calendarDate.describe("The calendar date (yyyy-MM-dd) to retrieve data for."),
      todayDate: calendarDate
        .describe(
          "The current calendar date (yyyy-MM-dd) from the caller's perspective, used as a reference point for predictions and calculations.",
        )
        .optional(),
      reducedResponse: z
        .boolean()
        .describe("When true, returns a reduced/lightweight version of the response payload.")
        .default(false),
      skipbm: z
        .boolean()
        .describe("When true, excludes baby movement (kick count) data from the response.")
        .default(false),
      includeAnalysis: z
        .boolean()
        .describe("When true, includes menstrual cycle analysis data in the response.")
        .default(false),
    }),
    responseSchema: models.zDetailedMenstrualCycleDayDto,
    requiredScope: WOMENS_SCOPE,
  }),
  defineEndpoint({
    name: "get_sleep",
    description: "Sleep data for a date.",
    path: "/sleep-service/sleep/dailySleep",
    inputSchema: z.strictObject({
      date: calendarDate.optional(),
    }),
    responseSchema: models.zDailySleepDto,
  }),
  defineEndpoint({
    name: "get_sleep_range",
    description:
      "Sleep summaries across a date range. Date ranges are limited to 31 calendar days.",
    path: "/sleep-service/sleep/dailySleepSummariesByDate",
    inputSchema: z
      .strictObject({
        startDate: calendarDate.optional(),
        endDate: calendarDate.optional(),
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: z.array(models.zDailySleepDto),
  }),
  defineEndpoint({
    name: "get_profile",
    description: "Garmin profile settings.",
    path: "/userprofile-service/userprofile/settings",
    inputSchema: z.strictObject({}),
    responseSchema: models.zUserSettingsDto,
  }),
  defineEndpoint({
    name: "get_hydration",
    description:
      "Daily hydration across a date range. Date ranges are limited to 31 calendar days.",
    path: "/usersummary-service/stats/hydration/daily/{startDate}/{endDate}",
    pathParameters: ["startDate", "endDate"],
    inputSchema: z
      .strictObject({
        startDate: calendarDate,
        endDate: calendarDate,
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: z.array(models.zUserDailyHydrationDto),
  }),
  defineEndpoint({
    name: "get_steps",
    description: "Daily steps across a date range. Date ranges are limited to 31 calendar days.",
    path: "/usersummary-service/stats/steps/daily/{startDate}/{endDate}",
    pathParameters: ["startDate", "endDate"],
    inputSchema: z
      .strictObject({
        startDate: calendarDate,
        endDate: calendarDate,
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: z.array(models.zStepsDailyStatDto),
  }),
  defineEndpoint({
    name: "get_stress",
    description: "Daily stress across a date range. Date ranges are limited to 31 calendar days.",
    path: "/usersummary-service/stats/stress/daily/{startDate}/{endDate}",
    pathParameters: ["startDate", "endDate"],
    inputSchema: z
      .strictObject({
        startDate: calendarDate,
        endDate: calendarDate,
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: z.array(models.zMultiValueWellnessChartItemDto),
  }),
  defineEndpoint({
    name: "get_daily_summary",
    description: "Daily health summary for a date.",
    path: "/usersummary-service/usersummary/daily",
    inputSchema: z.strictObject({
      calendarDate: calendarDate.optional(),
    }),
    responseSchema: models.zUserDailySummaryDto,
  }),
  defineEndpoint({
    name: "get_daily_summaries",
    description:
      "Health summaries across a date range. Date ranges are limited to 31 calendar days.",
    path: "/usersummary-service/v2/dailysummaries",
    inputSchema: z
      .strictObject({
        startDate: calendarDate.optional(),
        endDate: calendarDate.optional(),
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: models.zApiDocumentListUserDailySummaryV2Dto,
  }),
  defineEndpoint({
    name: "get_weight_measurements",
    description:
      "All weight measurements across a date range. Date ranges are limited to 31 calendar days.",
    path: "/weight-service/weight/all/{startDate}/{endDate}",
    pathParameters: ["startDate", "endDate"],
    inputSchema: z
      .strictObject({
        startDate: calendarDate.describe(
          "The start date(user's local calendar) of the range, inclusive. Format yyyy-MM-dd.",
        ),
        endDate: calendarDate.describe(
          "The end date(user's local calendar) of the range, inclusive. Format yyyy-MM-dd.",
        ),
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: z.array(models.zDateWeightDto),
  }),
  defineEndpoint({
    name: "get_weight_range",
    description:
      "Weight and body composition across a date range. Date ranges are limited to 31 calendar days.",
    path: "/weight-service/weight/range/{startDate}/{endDate}",
    pathParameters: ["startDate", "endDate"],
    inputSchema: z
      .strictObject({
        startDate: calendarDate.describe(
          "The start date(user's local calendar) of the range, inclusive. Format yyyy-MM-dd.",
        ),
        endDate: calendarDate.describe(
          "The end date(user's local calendar) of the range, inclusive. Format yyyy-MM-dd.",
        ),
        includeAll: z
          .boolean()
          .describe(
            "If true, include all weight entries for each day in the range. If false, only include the latest weight entry for each day.",
          )
          .default(false),
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: models.zWeightRangeDto,
  }),
  defineEndpoint({
    name: "get_body_battery",
    description:
      "Body Battery reports across a date range. Date ranges are limited to 31 calendar days.",
    path: "/wellness-service/wellness/bodyBattery/reports/daily",
    inputSchema: z
      .strictObject({
        startDate: calendarDate.optional(),
        endDate: calendarDate.optional(),
        chunks: z
          .number()
          .int()
          .nonnegative()
          .describe(
            "Number of time intervals each day is divided into; the response includes the lowest and highest Body Battery readings from each interval.",
          )
          .optional(),
      })
      .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: z.array(models.zBodyBatteryDailyReportDto),
  }),
  defineEndpoint({
    name: "get_spo2_acclimation",
    description: "SpO2 acclimation for a date.",
    path: "/wellness-service/wellness/daily/spo2acclimation/{calendarDate}",
    pathParameters: ["calendarDate"],
    inputSchema: z.strictObject({
      calendarDate: calendarDate,
    }),
    responseSchema: models.zDailySpO2AndAcclimationDto,
  }),
  defineEndpoint({
    name: "get_heart_rate",
    description: "Heart rate readings for a date.",
    path: "/wellness-service/wellness/dailyHeartRate",
    inputSchema: z.strictObject({
      date: calendarDate.optional(),
    }),
    responseSchema: models.zDailyHeartRateDto,
  }),
  defineEndpoint({
    name: "get_wellness_activities",
    description:
      "Wellness activity summaries across a date range. Date ranges are limited to 31 calendar days.",
    path: "/wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}",
    pathParameters: ["fromDate", "untilDate"],
    inputSchema: z
      .strictObject({
        fromDate: calendarDate,
        untilDate: calendarDate,
      })
      .refine(({ fromDate, untilDate }) => isBoundedDateRange(fromDate, untilDate), {
        message: DATE_RANGE_MESSAGE,
      }),
    responseSchema: z.array(models.zWellnessActivitySummaryDto),
  }),
];
