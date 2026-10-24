import { z } from "zod";
import { calendarDate } from "./tool-input";
import { summaryType, isActivityType } from "./push/schemas";
import type { GarminUserData } from "./push/store";
import { garminActivityId } from "./activity/files";

export const dayInput = z.strictObject({
  date: calendarDate,
  limitPerType: z.number().int().min(1).max(100).default(50),
});

const storedSummary = z.looseObject({ summaryId: z.string().min(1).max(255) });

const summaryRecord = z.object({
  summaryId: z.string(),
  receivedAt: z.iso.datetime(),
  summary: z.record(z.string(), z.json()),
});

const activityReference = summaryRecord.omit({ summary: true }).extend({
  activityId: garminActivityId.nullable(),
});

const dayData = z.object({
  date: calendarDate,
  sections: z.record(
    summaryType,
    z.object({
      availability: z.enum(["available", "not_received", "permission_denied"]),
      records: z.array(z.union([summaryRecord, activityReference])),
      hasMore: z.boolean(),
      nextOffset: z.number().int().nonnegative().nullable(),
    }),
  ),
});

export async function getGarminDay(
  store: DurableObjectStub<GarminUserData>,
  input: z.infer<typeof dayInput>,
  permissions: string[],
) {
  const revoked = await store.isRevoked();

  const sections = await Promise.all(
    summaryType.options.map(async (type) => {
      const activity = isActivityType(type);
      const permission = activity ? "ACTIVITY_EXPORT" : "HEALTH_EXPORT";

      if (revoked || !permissions.includes(permission)) {
        return [
          type,
          { availability: "permission_denied", records: [], hasMore: false, nextOffset: null },
        ] as const;
      }

      const page = await store.list(type, input.date, input.date, input.limitPerType, 0);

      const records = page.records.map(({ receivedAt, summaryJSON }) => {
        const summary = storedSummary.parse(JSON.parse(summaryJSON));
        const reference = { summaryId: summary.summaryId, receivedAt };

        return activity
          ? {
              ...reference,
              activityId: garminActivityId.safeParse(summary.activityId).data ?? null,
            }
          : { ...reference, summary };
      });

      return [
        type,
        {
          availability: records.length ? "available" : "not_received",
          records,
          hasMore: page.hasMore,
          nextOffset: page.hasMore ? records.length : null,
        },
      ] as const;
    }),
  );

  const sectionData: unknown = Object.fromEntries(sections);

  return dayData.parse({ date: input.date, sections: sectionData });
}
