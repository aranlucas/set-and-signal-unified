import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  backfillSettings,
  prepareActivityBackfill,
  deliverActivityBackfill,
} from "../src/personal-backfill";
import { required } from "./support";

// Explicit project only: Personal API reads first, then an opt-in import into the linked account.
it("prepares and optionally delivers verified Personal API activity history", async () => {
  const path = required(process.env.GARMIN_BACKFILL_SETTINGS_FILE, "GARMIN_BACKFILL_SETTINGS_FILE");

  let input: unknown;

  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Cannot read private Garmin import settings as JSON.");
  }

  const parsed = backfillSettings.safeParse(input);

  if (!parsed.success) {
    throw new Error("Invalid private Garmin import settings file.");
  }

  const settings = parsed.data;
  const activities = await prepareActivityBackfill(settings);
  expect(activities.some((activity) => activity.activityId === settings.expectedActivityId)).toBe(
    true,
  );

  const result =
    process.env.GARMIN_BACKFILL_COMMIT === "1"
      ? await deliverActivityBackfill(settings, activities)
      : { delivered: 0 };

  expect(result.delivered).toBe(process.env.GARMIN_BACKFILL_COMMIT === "1" ? activities.length : 0);

  await writeFile(
    `${path}.records.json`,
    JSON.stringify({
      startDate: settings.startDate,
      endDate: settings.endDate,
      prepared: activities.length,
      delivered: result.delivered,
      activities: activities.map((activity) => ({
        activityId: activity.activityId,
        date: activity.calendarDate,
      })),
    }),
    { mode: 0o600 },
  );
});
