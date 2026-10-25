import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { prepareActivityBackfill, deliverActivityBackfill } from "../src/personal-backfill";
import { receivePush } from "../src/push/handler";
import { userStore } from "../src/push/store";
import { requestUrl } from "./support";

const settings = () => ({
  personalApiKey: "private-personal-key",
  pushToken: "a".repeat(64),
  garminUserId: crypto.randomUUID(),
  expectedActivityId: 123456789,
  startDate: "2026-07-25",
  endDate: "2026-10-22",
});

const walking = {
  activityId: 123456789,
  activityName: "Example Walking",
  activityType: { typeKey: "walking" },
  startTimeLocal: "2026-10-22 09:00:00",
  startTimeGMT: "2026-10-22 16:00:00",
  duration: 3779,
  distance: 5021.23,
  averageHR: 102,
  calories: 291,
};

function personalFetch(pages: unknown[] = [[walking]]) {
  return vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = new URL(requestUrl(input));
    expect(url.origin).toBe("https://personal.connectapi.garmin.com");
    expect(init?.redirect).toBe("error");

    if (url.pathname.endsWith("/token")) {
      return Promise.resolve(Response.json({ access_token: "private-access-token" }));
    }

    return Promise.resolve(Response.json(pages[Number(url.searchParams.get("start")) / 99]));
  });
}

it("imports the verified walk through the real receiver with local dates, units and stable IDs", async () => {
  const input = settings();
  const activities = await prepareActivityBackfill(input, personalFetch());
  expect(activities).toMatchObject([
    {
      activityId: walking.activityId,
      summaryId: String(walking.activityId),
      activityType: "WALKING",
      calendarDate: "2026-10-22",
      startTimeInSeconds: Date.parse("2026-10-22T16:00:00Z") / 1000,
      startTimeOffsetInSeconds: -25200,
      durationInSeconds: 3779,
      distanceInMeters: 5021.23,
      averageHeartRateInBeatsPerMinute: 102,
      importSource: "garmin-personal-api",
    },
  ]);

  const delivery = vi.fn<typeof fetch>().mockImplementation((url, init) => {
    expect(requestUrl(url)).toBe(
      `https://garmin-mcp.aranlucas.workers.dev/garmin/push/${input.pushToken}`,
    );

    return receivePush(
      new Request(requestUrl(url), {
        method: "POST",
        headers: init?.headers ?? {},
        body: init?.body ?? null,
      }),
      { ...env, GARMIN_PUSH_TOKEN: input.pushToken },
      new URL(requestUrl(url)).pathname.split("/").at(-1) ?? "",
    );
  });

  expect(await deliverActivityBackfill(input, activities, delivery)).toEqual({ delivered: 1 });
  await deliverActivityBackfill(input, activities, delivery);

  const records = await userStore(env, input.garminUserId).list(
    "activities",
    "2026-10-22",
    "2026-10-22",
    50,
    0,
  );

  expect(records.records).toHaveLength(1);
  expect(records.records[0]?.summaryJSON).toContain('"activityName":"Example Walking"');
  expect(records.records[0]?.summaryJSON).not.toContain("private-");
  expect(records.records[0]?.summaryJSON).not.toContain("userId");
  expect(
    (
      await userStore(env, crypto.randomUUID()).list(
        "activities",
        "2026-10-22",
        "2026-10-22",
        50,
        0,
      )
    ).records,
  ).toEqual([]);

  const native = {
    userId: input.garminUserId,
    summaryId: String(walking.activityId),
    activityId: walking.activityId,
    calendarDate: "2026-10-22",
    deviceName: "Garmin watch",
  };

  expect(
    (
      await receivePush(
        new Request("https://delivery.example/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activities: [native] }),
        }),
        env,
        env.GARMIN_PUSH_TOKEN,
      )
    ).status,
  ).toBe(200);
  await deliverActivityBackfill(input, activities, delivery);

  const stored = await userStore(env, input.garminUserId).get(
    "activities",
    String(walking.activityId),
  );

  expect(stored).toContain('"deviceName":"Garmin watch"');
  expect(stored).not.toContain("importSource");
  // Hosted two-CPU builds can spend over five seconds starting the first SQLite object.
}, 15_000);

it("accepts Garmin's plain-text token response", async () => {
  const fetcher = personalFetch();
  fetcher.mockResolvedValueOnce(
    new Response("header.payload.signature", { headers: { "Content-Type": "text/plain" } }),
  );
  expect(await prepareActivityBackfill(settings(), fetcher)).toHaveLength(1);
  expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
    Authorization: "Bearer header.payload.signature",
  });
});

it("paginates before delivery and removes repeated activity IDs across pages", async () => {
  const page = Array.from({ length: 99 }, (_, index) => ({
    ...walking,
    activityId: walking.activityId + index,
  }));

  const fetcher = personalFetch([page, [walking]]);
  const activities = await prepareActivityBackfill(settings(), fetcher);
  expect(activities).toHaveLength(99);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("rejects the wrong account, malformed timestamps and out-of-range activities before writing", async () => {
  await expect(
    prepareActivityBackfill({ ...settings(), expectedActivityId: 1 }, personalFetch()),
  ).rejects.toThrow("expected account activity");
  await expect(
    prepareActivityBackfill(
      settings(),
      personalFetch([[{ ...walking, startTimeGMT: "2026-02-30 12:00:00" }]]),
    ),
  ).rejects.toThrow("invalid Personal API activities");
  await expect(
    prepareActivityBackfill(
      settings(),
      personalFetch([[{ ...walking, startTimeLocal: "2026-10-23 09:00:00" }]]),
    ),
  ).rejects.toThrow("outside the requested dates");
});

it("accepts a supplied access token without exchanging it and strips unknown provider fields", async () => {
  const { personalApiKey: _key, ...input } = settings();

  const fetcher = personalFetch([
    [
      {
        ...walking,
        accessToken: "provider-secret",
        callbackURL: "https://example.com/secret",
        ownerFullName: "Private name",
      },
    ],
  ]);

  const activities = await prepareActivityBackfill(
    { ...input, personalAccessToken: "private-access-token" },
    fetcher,
  );

  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(activities)).not.toMatch(/provider-secret|callbackURL|ownerFullName/);
});

it("never reveals private request URLs or provider error bodies", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("https://delivery.example/private-secret"));

  await expect(prepareActivityBackfill(settings(), fetcher)).rejects.toThrow(
    "No credentials were logged",
  );

  const failure = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("private-provider-error", { status: 401 }));

  await expect(prepareActivityBackfill(settings(), failure)).rejects.toThrow("HTTP 401");
});

function failingDiscardResponse(status: number) {
  return new Response(
    new ReadableStream({
      cancel() {
        throw new Error("https://delivery.example/private-secret");
      },
    }),
    { status },
  );
}

it("keeps response-discard failures from leaking private URLs", async () => {
  const failure = vi.fn<typeof fetch>().mockResolvedValue(failingDiscardResponse(401));
  await expect(prepareActivityBackfill(settings(), failure)).rejects.toThrow(
    "Garmin import request returned HTTP 401.",
  );

  const input = settings();
  const activities = await prepareActivityBackfill(input, personalFetch());
  const delivery = vi.fn<typeof fetch>().mockResolvedValue(failingDiscardResponse(200));
  expect(await deliverActivityBackfill(input, activities, delivery)).toEqual({ delivered: 1 });
});
