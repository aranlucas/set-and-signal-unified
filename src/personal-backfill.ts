import { z } from "zod";
import { zSummarizedActivityDto } from "./garmin-api/zod.gen";
import { readBounded } from "./garmin";
import { calendarDate } from "./tool-input";
import { summary, userId } from "./push/schemas";

const PERSONAL_BASE = "https://personal.connectapi.garmin.com";

const DELIVERY_BASE = "https://garmin-mcp.aranlucas.workers.dev";

const PAGE_SIZE = 99;

const MAX_PAGES = 100;

const localTimestamp = z.string().transform((value, ctx) => {
  const parsed = z.iso.datetime({ local: true }).safeParse(value.replace(" ", "T"));

  if (!parsed.success) {
    ctx.addIssue({ code: "custom", message: "Invalid Garmin activity timestamp." });

    return z.NEVER;
  }

  return Date.parse(`${parsed.data}Z`) / 1000;
});

const personalActivity = zSummarizedActivityDto
  .pick({
    activityId: true,
    activityName: true,
    activityType: true,
    startTimeLocal: true,
    startTimeGMT: true,
    duration: true,
    distance: true,
    calories: true,
    averageHR: true,
    maxHR: true,
    averageSpeed: true,
    maxSpeed: true,
    steps: true,
  })
  .extend({
    activityId: z.number().int().positive().safe(),
    startTimeLocal: localTimestamp,
    startTimeGMT: localTimestamp,
    activityType: z.object({ typeKey: z.string().min(1) }),
    duration: z.number().nonnegative(),
    distance: z.number().nonnegative().optional(),
  })
  .strip();

export const backfillSettings = z
  .object({
    personalApiKey: z.string().min(1).optional(),
    personalAccessToken: z.string().min(1).optional(),
    garminUserId: userId,
    pushToken: z.string().regex(/^[a-f0-9]{64}$/),
    expectedActivityId: z.number().int().positive().safe(),
    startDate: calendarDate,
    endDate: calendarDate,
  })
  .refine((value) => Boolean(value.personalApiKey) !== Boolean(value.personalAccessToken), {
    message: "Provide exactly one Personal API key or access token.",
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "Import dates must be in order.",
  });

export type BackfillSettings = z.infer<typeof backfillSettings>;

async function discard(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Discard errors can contain private request URLs; they must not replace the safe result.
  }
}

async function request(url: string, init: RequestInit, fetcher: typeof fetch) {
  let response: Response;

  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // Fetch errors can include the private delivery URL. Never propagate them.
    throw new Error("Garmin import request failed. No credentials were logged.");
  }

  if (!response.ok) {
    await discard(response);
    throw new Error(`Garmin import request returned HTTP ${response.status}.`);
  }

  return response;
}

async function json(response: Response) {
  try {
    return z
      .json()
      .parse(JSON.parse(new TextDecoder().decode(await readBounded(response, 8_388_608))));
  } catch {
    throw new Error("Garmin returned an invalid or oversized import response.");
  }
}

/** Operator-only Personal API import. No new public endpoint or persistent Personal credential. */
export async function prepareActivityBackfill(settings: BackfillSettings, fetcher = fetch) {
  const checked = backfillSettings.safeParse(settings);

  if (!checked.success) {
    throw new Error("Invalid private Garmin import settings.");
  }

  const input = checked.data;
  let accessToken = input.personalAccessToken;

  if (input.personalApiKey) {
    const response = await request(
      `${PERSONAL_BASE}/personalapitoken-service/personal-api/personal-api-key/token`,
      { method: "POST", headers: { Authorization: `ApiKey ${input.personalApiKey}` } },
      fetcher,
    );

    let tokenValue: unknown;

    if (response.headers.get("Content-Type")?.startsWith("text/plain")) {
      tokenValue = new TextDecoder().decode(await readBounded(response, 16_384)).trim();
    } else {
      tokenValue = await json(response);
    }

    const token = z
      .union([
        z.string().regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
        z.object({ access_token: z.string().min(1) }).transform((value) => value.access_token),
        z.object({ accessToken: z.string().min(1) }).transform((value) => value.accessToken),
      ])
      .safeParse(tokenValue);

    if (!token.success) {
      throw new Error("Garmin returned an invalid Personal API token response.");
    }

    accessToken = token.data;
  }

  if (!accessToken) {
    throw new Error("A Personal API credential is required.");
  }

  const activities = new Map<number, z.infer<typeof personalActivity>>();
  let complete = false;

  // Each page depends on the preceding offset; validate the entire import before any delivery.
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      start: String(page * PAGE_SIZE),
      limit: String(PAGE_SIZE),
      startDate: input.startDate,
      endDate: input.endDate,
      sortOrder: "asc",
      excludeChildren: "true",
    });

    // oxlint-disable-next-line no-await-in-loop -- Garmin uses offset pagination.
    const response = await request(
      `${PERSONAL_BASE}/activitylist-service/activities/search/activities?${query.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      fetcher,
    );

    // oxlint-disable-next-line no-await-in-loop -- Validate each fetched page before requesting the next.
    const body = await json(response);

    const parsed = z.array(personalActivity).max(PAGE_SIZE).safeParse(body);

    if (!parsed.success) {
      throw new Error("Garmin returned invalid Personal API activities. Nothing was imported.");
    }

    for (const activity of parsed.data) {
      const date = new Date(activity.startTimeLocal * 1000).toISOString().slice(0, 10);

      if (date < input.startDate || date > input.endDate) {
        throw new Error(
          "Garmin returned an activity outside the requested dates. Nothing was imported.",
        );
      }

      activities.set(activity.activityId, activity);
    }

    if (parsed.data.length < PAGE_SIZE) {
      complete = true;
      break;
    }
  }

  if (!complete) {
    throw new Error(
      "Garmin import exceeded its page limit. Narrow the dates. Nothing was imported.",
    );
  }

  // The operator supplies an activity verified in the signed-in account's Garmin Connect UI.
  if (!activities.has(input.expectedActivityId)) {
    throw new Error("The expected account activity is missing. Nothing was imported.");
  }

  return [...activities.values()].map((activity) =>
    summary.parse({
      userId: input.garminUserId,
      summaryId: String(activity.activityId),
      activityId: activity.activityId,
      activityName: activity.activityName,
      activityType: activity.activityType.typeKey.toUpperCase(),
      calendarDate: new Date(activity.startTimeLocal * 1000).toISOString().slice(0, 10),
      startTimeInSeconds: activity.startTimeGMT,
      startTimeOffsetInSeconds: activity.startTimeLocal - activity.startTimeGMT,
      durationInSeconds: activity.duration,
      distanceInMeters: activity.distance,
      activeKilocalories: activity.calories,
      averageHeartRateInBeatsPerMinute: activity.averageHR,
      maxHeartRateInBeatsPerMinute: activity.maxHR,
      averageSpeedInMetersPerSecond: activity.averageSpeed,
      maxSpeedInMetersPerSecond: activity.maxSpeed,
      steps: activity.steps,
      importSource: "garmin-personal-api",
    }),
  );
}

export async function deliverActivityBackfill(
  settings: BackfillSettings,
  activities: z.infer<typeof summary>[],
  fetcher = fetch,
) {
  const checked = backfillSettings.safeParse(settings);

  if (
    !checked.success ||
    activities.some((activity) => activity.userId !== checked.data.garminUserId)
  ) {
    throw new Error("Invalid Garmin import delivery account.");
  }

  let delivered = 0;

  for (let offset = 0; offset < activities.length; offset += 100) {
    // oxlint-disable-next-line no-await-in-loop -- Stop on a failed batch; stable summary IDs allow safe replay.
    const response = await request(
      `${DELIVERY_BASE}/garmin/push/${checked.data.pushToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activities: activities.slice(offset, offset + 100) }),
      },
      fetcher,
    );

    // oxlint-disable-next-line no-await-in-loop -- Discard the response before sending the next batch.
    await discard(response);
    delivered += Math.min(100, activities.length - offset);
  }

  return { delivered };
}
