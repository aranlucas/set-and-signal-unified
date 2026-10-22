// Derived from Garmin’s published Personal API OpenAPI snapshot. See docs/research.md.
export const endpoints = [
  {
    name: "get_activity",
    description: "Activity summary, metadata, measurements and splits.",
    path: "/activity-service/activity/{activityId}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "activityId",
        description: "The ID of the activity to retrieve the summary",
        in: "path",
        required: true,
        schema: {
          type: "integer",
          format: "int64",
        },
      },
    ],
  },
  {
    name: "get_activity_workouts",
    description: "Workouts associated with a recorded activity.",
    path: "/activity-service/activity/{activityId}/workouts",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "activityId",
        description: "The ID of the activity for which to retrieve workouts",
        in: "path",
        required: true,
        schema: {
          type: "integer",
          format: "int64",
        },
      },
    ],
  },
  {
    name: "list_activities",
    description: "Search recorded activities; paginate with start and limit.",
    path: "/activitylist-service/activities/search/activities",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "start",
        in: "query",
        description: "Zero-based offset of the first activity to return. Defaults to 0.",
        schema: {
          type: "integer",
          format: "int32",
          default: 0,
        },
      },
      {
        name: "limit",
        in: "query",
        description: "Maximum number of activities to return. Defaults to 99.",
        schema: {
          type: "integer",
          format: "int32",
          default: 99,
        },
      },
      {
        name: "favorite",
        in: "query",
        description:
          "Filter by favorite status: 1 returns favorites, 0 returns non-favorites, and -1 applies no favorite filter. Defaults to -1.",
        schema: {
          type: "integer",
          format: "int32",
          default: -1,
        },
      },
      {
        name: "sortOrder",
        in: "query",
        description:
          "Sort direction: asc for ascending or desc for descending, case-insensitive. Defaults to desc.",
        schema: {
          type: "string",
          default: "desc",
        },
      },
      {
        name: "excludeChildren",
        in: "query",
        description:
          "Whether to exclude child activities that have a parent activity, such as individual legs of a multisport activity. Defaults to true.",
        schema: {
          type: "boolean",
          default: true,
        },
      },
      {
        name: "sortBy",
        in: "query",
        description:
          "Activity field to sort by, such as name, distance, or duration. Defaults to startLocal, the activity's local start date and time.",
        schema: {
          type: "string",
        },
      },
      {
        name: "search",
        in: "query",
        description: "Text to search for in activity names and descriptions.",
        schema: {
          type: "string",
        },
      },
      {
        name: "activityType",
        in: "query",
        description:
          "Parent activity type key to include, such as running or cycling. Must identify a parent type, not a subtype.",
        schema: {
          type: "string",
        },
      },
      {
        name: "activitySubType",
        in: "query",
        description:
          "Activity subtype key to include. Must identify a child type and, if activityType is also provided, belong to that parent type. For example, use activitySubType=trail_running with activityType=running, or activitySubType=road_cycling with activityType=cycling.",
        schema: {
          type: "string",
        },
      },
      {
        name: "eventType",
        in: "query",
        description:
          "Event classification key to include, such as race, training, recreation, fitness, specialEvent, or uncategorized.",
        schema: {
          type: "string",
        },
      },
      {
        name: "minDistance",
        in: "query",
        description: "Inclusive minimum activity distance, in meters.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "maxDistance",
        in: "query",
        description: "Inclusive maximum activity distance, in meters.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "minDuration",
        in: "query",
        description: "Inclusive minimum activity timer duration, in seconds.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "maxDuration",
        in: "query",
        description: "Inclusive maximum activity timer duration, in seconds.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "minElevation",
        in: "query",
        description: "Inclusive minimum total elevation gain for the activity, in meters.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "maxElevation",
        in: "query",
        description: "Inclusive maximum total elevation gain for the activity, in meters.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "startDate",
        in: "query",
        description:
          "Inclusive earliest activity start date, based on the activity's local start time, in YYYY-MM-DD format.",
        schema: {
          type: "string",
          format: "date",
          example: "2026-08-31",
        },
      },
      {
        name: "endDate",
        in: "query",
        description:
          "Inclusive latest activity start date, based on the activity's local start time, in YYYY-MM-DD format.",
        schema: {
          type: "string",
          format: "date",
          example: "2026-08-31",
        },
      },
      {
        name: "upperLatitude",
        in: "query",
        description:
          "Northern latitude boundary of the bounding box for activity start locations, in decimal degrees. Provide all four latitude and longitude boundaries to apply this filter.",
        schema: {
          type: "number",
          format: "double",
        },
      },
      {
        name: "rightLongitude",
        in: "query",
        description:
          "Eastern longitude boundary of the bounding box for activity start locations, in decimal degrees. Provide all four latitude and longitude boundaries to apply this filter.",
        schema: {
          type: "number",
          format: "double",
        },
      },
      {
        name: "lowerLatitude",
        in: "query",
        description:
          "Southern latitude boundary of the bounding box for activity start locations, in decimal degrees. Provide all four latitude and longitude boundaries to apply this filter.",
        schema: {
          type: "number",
          format: "double",
        },
      },
      {
        name: "leftLongitude",
        in: "query",
        description:
          "Western longitude boundary of the bounding box for activity start locations, in decimal degrees. Provide all four latitude and longitude boundaries to apply this filter.",
        schema: {
          type: "number",
          format: "double",
        },
      },
      {
        name: "lowerMaxDepth",
        in: "query",
        description: "Inclusive lower bound on the dive activity's maximum depth, in centimeters.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "upperMaxDepth",
        in: "query",
        description: "Inclusive upper bound on the dive activity's maximum depth, in centimeters.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "decoDive",
        in: "query",
        description:
          "Filter by decompression dive status: true returns decompression dives and false returns activities marked as non-decompression dives. Omit to apply no decompression dive filter.",
        schema: {
          type: "boolean",
        },
      },
      {
        name: "minElapsedDuration",
        in: "query",
        description:
          "Inclusive minimum total elapsed activity duration, including paused time, in seconds.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "maxElapsedDuration",
        in: "query",
        description:
          "Inclusive maximum total elapsed activity duration, including paused time, in seconds.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "minBottomTime",
        in: "query",
        description: "Inclusive minimum dive bottom time, in seconds.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "maxBottomTime",
        in: "query",
        description: "Inclusive maximum dive bottom time, in seconds.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "minAvgPower",
        in: "query",
        description: "Inclusive minimum average activity power, in watts.",
        schema: {
          type: "integer",
          format: "int64",
        },
      },
      {
        name: "excludedActivitySubType",
        in: "query",
        description:
          "Activity subtype keys to exclude. Repeat this query parameter to exclude multiple subtypes.",
        schema: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      {
        name: "requiredField",
        in: "query",
        description:
          "Activity fields that must have a non-null value for an activity to be included. Repeat this query parameter to require multiple fields; all specified fields must be present.",
        schema: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    ],
  },
  {
    name: "get_heart_rate_zones",
    description: "Configured heart rate zones.",
    path: "/biometric-service/heartRateZones/v2",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "generateDefaults",
        description: "Whether to generate default zones when the user has no configured zones.",
        in: "query",
        schema: {
          type: "boolean",
          default: true,
        },
      },
    ],
  },
  {
    name: "download_activity_file",
    description:
      "Download the original activity file (FIT or archive) as base64; limited to 2 MiB.",
    path: "/download-service/files/activity/{activityId}",
    binary: true,
    sensitive: false,
    parameters: [
      {
        name: "activityId",
        in: "path",
        required: true,
        schema: {
          type: "integer",
          format: "int64",
        },
      },
    ],
  },
  {
    name: "get_fitness_age",
    description: "Fitness age for a calendar date.",
    path: "/fitnessage-service/fitnessage/v2/{calendarDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "calendarDate",
        description:
          "The target date; Fitness Age information returned will be the latest available as of this date.",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "fullHistoryScan",
        description:
          "Whether to scan the full history to find the latest Fitness Age information. If false, only the last 28 days relative to the target calendar date will be considered.",
        in: "query",
        schema: {
          type: "boolean",
          default: true,
        },
      },
    ],
  },
  {
    name: "get_weight_goals",
    description: "Effective weight goals for a date range.",
    path: "/goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
        description: "Beginning of the requested date interval.",
      },
      {
        name: "endDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
        description: "End of the requested date interval.",
      },
    ],
  },
  {
    name: "get_hrv",
    description: "Heart rate variability for a date.",
    path: "/hrv-service/hrv/{calendarDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "calendarDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_hrv_range",
    description: "Daily heart rate variability across a date range.",
    path: "/hrv-service/hrv/daily/{fromDate}/{toDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "fromDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "toDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_nutrition",
    description: "Food logs, nutrition and goals for a date.",
    path: "/nutrition-service/food/logs/{date}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "includeGoals",
        in: "query",
        description: "Goals are included by default unless requested with includeGoals=false",
        schema: {
          type: "boolean",
          default: true,
        },
      },
      {
        name: "includeNutrition",
        in: "query",
        description:
          "Nutrition information is included by default unless requested with includeNutrition=false",
        schema: {
          type: "boolean",
          default: true,
        },
      },
      {
        name: "includeMedia",
        in: "query",
        description: "Images is included by default unless requested with includeMedia=false",
        schema: {
          type: "boolean",
          default: true,
        },
      },
      {
        name: "mealId",
        in: "query",
        description: "Id of the meal like id for Breakfast, Lunch, Snacks or Dinner",
        schema: {
          type: "integer",
          format: "int64",
          example: "2",
        },
      },
      {
        name: "date",
        in: "path",
        description:
          "Date for which to retrieve the daily nutrition logs. Date must be in the YYYY-MM-DD format. The date is interpreted in the user's local timezone.",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_menstrual_summary",
    description: "Menstrual cycle summary for a date. Requires separate women’s health consent.",
    path: "/periodichealth-service/menstrualcycle/summary/{calendarDate}",
    binary: false,
    sensitive: true,
    parameters: [
      {
        name: "calendarDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
        description: "The calendar date (yyyy-MM-dd) to retrieve data for.",
      },
    ],
  },
  {
    name: "get_menstrual_day",
    description: "Detailed menstrual cycle day view. Requires separate women’s health consent.",
    path: "/periodichealth-service/menstrualcycle/dayview/{calendarDate}",
    binary: false,
    sensitive: true,
    parameters: [
      {
        name: "calendarDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
        description: "The calendar date (yyyy-MM-dd) to retrieve data for.",
      },
      {
        name: "todayDate",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
        description:
          "The current calendar date (yyyy-MM-dd) from the caller's perspective, used as a reference point for predictions and calculations.",
      },
      {
        name: "reducedResponse",
        in: "query",
        schema: {
          type: "boolean",
          default: false,
        },
        description: "When true, returns a reduced/lightweight version of the response payload.",
      },
      {
        name: "skipbm",
        in: "query",
        schema: {
          type: "boolean",
          default: false,
        },
        description: "When true, excludes baby movement (kick count) data from the response.",
      },
      {
        name: "includeAnalysis",
        in: "query",
        schema: {
          type: "boolean",
          default: false,
        },
        description: "When true, includes menstrual cycle analysis data in the response.",
      },
    ],
  },
  {
    name: "get_sleep",
    description: "Sleep data for a date.",
    path: "/sleep-service/sleep/dailySleep",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "date",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_sleep_range",
    description: "Sleep summaries across a date range.",
    path: "/sleep-service/sleep/dailySleepSummariesByDate",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "endDate",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_profile",
    description: "Garmin profile settings.",
    path: "/userprofile-service/userprofile/settings",
    binary: false,
    sensitive: false,
    parameters: [],
  },
  {
    name: "get_hydration",
    description: "Daily hydration across a date range.",
    path: "/usersummary-service/stats/hydration/daily/{startDate}/{endDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "endDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_steps",
    description: "Daily steps across a date range.",
    path: "/usersummary-service/stats/steps/daily/{startDate}/{endDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "endDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_stress",
    description: "Daily stress across a date range.",
    path: "/usersummary-service/stats/stress/daily/{startDate}/{endDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "endDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_daily_summary",
    description: "Daily health summary for a date.",
    path: "/usersummary-service/usersummary/daily",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "calendarDate",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_daily_summaries",
    description: "Health summaries across a date range.",
    path: "/usersummary-service/v2/dailysummaries",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "endDate",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_weight_measurements",
    description: "All weight measurements across a date range.",
    path: "/weight-service/weight/all/{startDate}/{endDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        in: "path",
        required: true,
        description:
          "The start date(user's local calendar) of the range, inclusive. Format yyyy-MM-dd.",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "endDate",
        in: "path",
        required: true,
        description:
          "The end date(user's local calendar) of the range, inclusive. Format yyyy-MM-dd.",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_weight_range",
    description: "Weight and body composition across a date range.",
    path: "/weight-service/weight/range/{startDate}/{endDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        description:
          "The start date(user's local calendar) of the range, inclusive. Format yyyy-MM-dd.",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "endDate",
        description:
          "The end date(user's local calendar) of the range, inclusive. Format yyyy-MM-dd.",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "includeAll",
        description:
          "If true, include all weight entries for each day in the range. If false, only include the latest weight entry for each day.",
        in: "query",
        schema: {
          type: "boolean",
          default: false,
        },
      },
    ],
  },
  {
    name: "get_body_battery",
    description: "Body Battery reports across a date range.",
    path: "/wellness-service/wellness/bodyBattery/reports/daily",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "startDate",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "endDate",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "chunks",
        description:
          "Number of time intervals each day is divided into; the response includes the lowest and highest Body Battery readings from each interval.",
        in: "query",
        schema: {
          type: "integer",
          format: "int32",
        },
      },
    ],
  },
  {
    name: "get_spo2_acclimation",
    description: "SpO2 acclimation for a date.",
    path: "/wellness-service/wellness/daily/spo2acclimation/{calendarDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "calendarDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_heart_rate",
    description: "Heart rate readings for a date.",
    path: "/wellness-service/wellness/dailyHeartRate",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "date",
        in: "query",
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
  {
    name: "get_wellness_activities",
    description: "Wellness activity summaries across a date range.",
    path: "/wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}",
    binary: false,
    sensitive: false,
    parameters: [
      {
        name: "fromDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
      {
        name: "untilDate",
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: "date",
          example: "1989-10-01",
        },
      },
    ],
  },
] as const;
