type CountRow = { n: number };

/* oxlint-disable no-await-in-loop -- Each delivery in these scenarios depends on the previous state transition. */
import type { z } from "zod";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm, evictDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { receivePush } from "../src/push/handler";
import { userStore } from "../src/push/store";
import { summaryDate, summary } from "../src/push/schemas";

function push(body: z.infer<ReturnType<typeof z.json>>, credential = env.GARMIN_PUSH_TOKEN) {
  return receivePush(
    new Request("https://delivery.example/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    credential,
  );
}

const record = (userId: string, summaryId = "daily-1", steps = 123) => ({
  userId,
  summaryId,
  calendarDate: "2026-10-23",
  startTimeInSeconds: 1792713600,
  steps,
});

it("authenticates delivery, rejects invalid payloads and does not accept ping/file URLs", async () => {
  expect((await push({ dailies: [record("a")] }, "public-client-id")).status).toBe(404);

  for (const body of [
    { dailies: [{ userId: "a", callbackURL: "https://evil.example/token" }] },
    { activityFiles: [] },
    { dailies: [{ ...record("a"), calendarDate: "invalid" }] },
    { unknown: [] },
  ]) {
    expect((await push(body)).status).toBe(400);
  }
});

it("persists idempotent updates and separates Garmin accounts across eviction", async () => {
  const id = crypto.randomUUID();
  const other = crypto.randomUUID();

  const store = userStore(env, id);
  expect((await push({ dailies: [record(id), record(other)] })).status).toBe(200);
  await push({ dailies: [record(id, "daily-1", 456)] });
  await evictDurableObject(store);
  const rows = await store.list("dailies", "2026-10-23", "2026-10-23", 50, 0);
  expect(rows.records).toHaveLength(1);
  expect(rows.records[0]?.summaryJSON).toContain('"steps":456');
  expect(await userStore(env, other).get("dailies", "daily-1")).toContain('"steps":123');
  expect(rows.records[0]?.summaryJSON).not.toContain("userId");
});

it("drops all credentials and callback URLs even in nested summaries", async () => {
  const id = crypto.randomUUID();
  await push({
    activityDetails: [
      {
        ...record(id),
        accessToken: "private",
        samples: [
          { callbackURL: "https://x/?token=private", refreshToken: "private", heartRate: 120 },
        ],
      },
    ],
  });
  const row = await userStore(env, id).get("activityDetails", "daily-1");
  expect(row).not.toContain("private");
  expect(row).toContain("heartRate");
});

it("supports pagination, durable deletion and subsequent collection", async () => {
  const id = crypto.randomUUID();
  const store = userStore(env, id);

  await push({ activities: [record(id, "1"), record(id, "2"), record(id, "3")] });
  expect((await store.list("activities", "2026-10-23", "2026-10-23", 2, 0)).hasMore).toBe(true);
  expect((await store.list("activities", "2026-10-23", "2026-10-23", 2, 2)).records).toHaveLength(
    1,
  );
  await store.clear();
  expect(await store.get("activities", "1")).toBeNull();
  await push({ activities: [record(id)] });
  expect(await store.get("activities", "daily-1")).not.toBeNull();
});

it("deletes on deregistration and permission withdrawal and blocks late retries", async () => {
  for (const payload of ["deregistrations", "userPermissionsChange"]) {
    const id = crypto.randomUUID();
    const store = userStore(env, id);

    await push({ dailies: [record(id)] });
    expect(
      (
        await push({
          [payload]: [
            {
              userId: id,
              summaryId: "notification-id",
              permissions: ["WORKOUT_IMPORT"],
              changeTimeInSeconds: 1,
            },
          ],
        })
      ).status,
    ).toBe(200);
    await push({ dailies: [record(id)] });
    expect(await store.get("dailies", "daily-1")).toBeNull();
    await store.activate();
    await push({ dailies: [record(id)] });
    expect(await store.get("dailies", "daily-1")).not.toBeNull();
  }
});

it("never reads expired records and deletes them on a real Durable Object alarm", async () => {
  const store = userStore(env, crypto.randomUUID());
  await store.ingest([
    {
      type: "dailies",
      summaryId: "old",
      date: "2026-10-23",
      receivedAt: Date.now() - 91 * 86400000,
      data: '{"steps":1}',
    },
  ]);
  expect(await store.get("dailies", "old")).toBeNull();
  expect((await store.list("dailies", "2026-10-23", "2026-10-23", 50, 0)).records).toEqual([]);
  expect(await runDurableObjectAlarm(store)).toBe(true);

  const count = await runInDurableObject(
    store,
    (_instance, state) =>
      state.storage.sql.exec<CountRow>("SELECT count(*) AS n FROM summaries").one().n,
  );

  expect(count).toBe(0);
});

it("uses the provider calendar date or device offset, including nested activity details", () => {
  expect(
    summaryDate(
      summary.parse({
        ...record("a"),
        calendarDate: undefined,
        startTimeInSeconds: 86400,
        startTimeOffsetInSeconds: -3600,
      }),
    ),
  ).toBe("1970-01-01");
  expect(
    summaryDate(
      summary.parse({
        userId: "a",
        summaryId: "a",
        summary: { startTimeInSeconds: 86400, startTimeOffsetInSeconds: 3600 },
      }),
    ),
  ).toBe("1970-01-02");
});

it("keeps the latest complete health summary when Garmin changes its summary ID", async () => {
  const id = crypto.randomUUID();
  const store = userStore(env, id);

  await push({ epochs: [{ ...record(id, "short"), durationInSeconds: 720 }] });
  await push({ epochs: [{ ...record(id, "complete", 456), durationInSeconds: 900 }] });
  await push({ epochs: [{ ...record(id, "late-short"), durationInSeconds: 720 }] });
  const rows = await store.list("epochs", "2026-10-23", "2026-10-23", 50, 0);
  expect(rows.records).toHaveLength(1);
  expect(rows.records[0]?.summaryJSON).toContain("complete");
});

it("withdraws only the affected data category and ignores stale permission events", async () => {
  const id = crypto.randomUUID();
  const store = userStore(env, id);

  await push({ dailies: [record(id)], activities: [record(id)] });
  await push({
    userPermissionsChange: [{ userId: id, permissions: ["HEALTH_EXPORT"], changeTimeInSeconds: 2 }],
  });
  await push({
    userPermissionsChange: [
      { userId: id, permissions: ["HEALTH_EXPORT", "ACTIVITY_EXPORT"], changeTimeInSeconds: 1 },
    ],
  });
  await push({ activities: [record(id)] });
  expect(await store.get("activities", "daily-1")).toBeNull();
  expect(await store.get("dailies", "daily-1")).not.toBeNull();
});
