import { z } from "zod";
import { calendarDate, isBoundedDateRange, DATE_RANGE_MESSAGE } from "../tool-input";

export const healthTypes = [
  "dailies",
  "epochs",
  "sleeps",
  "bodyComps",
  "stressDetails",
  "userMetrics",
  "pulseox",
  "allDayRespiration",
  "healthSnapshot",
  "hrv",
  "bloodPressures",
  "skinTemp",
  "nutrition",
  "hydration",
  "breathingVariations",
] as const;

export const activityTypes = [
  "activities",
  "activityDetails",
  "manuallyUpdatedActivities",
  "moveIQActivities",
] as const;

export const summaryType = z.enum([...healthTypes, ...activityTypes]);

const activityTypeSet: ReadonlySet<string> = new Set(activityTypes);

export function isActivityType(type: string) {
  return activityTypeSet.has(type);
}

export type SummaryType = z.infer<typeof summaryType>;

export const userId = z.string().min(1).max(255);

const timing = z.object({
  startTimeInSeconds: z.number().int().nonnegative(),
  startTimeOffsetInSeconds: z.number().int().min(-86400).max(86400).default(0),
});

export const summary = z
  .looseObject({
    userId,
    summaryId: z.string().min(1).max(255),
    calendarDate: calendarDate.optional(),
    durationInSeconds: z.number().nonnegative().optional(),
    startTimeInSeconds: z.number().int().nonnegative().optional(),
    startTimeOffsetInSeconds: z.number().int().min(-86400).max(86400).optional(),
    summary: z.looseObject(timing.shape).optional(),
  })
  .refine(
    (value) =>
      value.calendarDate !== undefined || value.startTimeInSeconds !== undefined || value.summary,
    { message: "Summary requires a calendar date or start time." },
  );

export const notification = z.object({
  userId,
  permissions: z.array(z.string()).max(32).optional(),
  changeTimeInSeconds: z.number().int().nonnegative().optional(),
});

export const pushPayload = z.partialRecord(
  z.enum([
    ...healthTypes,
    ...activityTypes,
    "activityFiles",
    "deregistrations",
    "userPermissionsChange",
  ]),
  z.array(z.unknown()).max(1000),
);

export type Summary = z.infer<typeof summary>;

export function summaryDate(value: Summary): string {
  if (value.calendarDate) {
    return value.calendarDate;
  }

  const seconds = value.startTimeInSeconds ?? value.summary?.startTimeInSeconds ?? 0;
  const offset = value.startTimeOffsetInSeconds ?? value.summary?.startTimeOffsetInSeconds ?? 0;

  return new Date((seconds + offset) * 1000).toISOString().slice(0, 10);
}

export const listSummariesInput = z
  .strictObject({
    type: summaryType,
    startDate: calendarDate,
    endDate: calendarDate,
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .refine(({ startDate, endDate }) => isBoundedDateRange(startDate, endDate), {
    message: DATE_RANGE_MESSAGE,
  });

/** Never return webhook routing credentials or callback URLs carried in provider payloads. */
export function publicSummary(value: Summary): string {
  return JSON.stringify(
    value, // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON.stringify calls this boundary with arbitrary payload values; the summary envelope was validated above.
    (key, item: unknown) =>
      /^(userId|userAccessToken|callbackURL|accessToken|refreshToken|token)$/i.test(key)
        ? undefined
        : item,
  );
}
