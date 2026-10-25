import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { env } from "cloudflare:workers";
import { expect, it, onTestFinished, vi } from "vitest";
import { createServer } from "../src/mcp";
import { userStore } from "../src/push/store";
import { requestUrl } from "./support";
import { receivePush } from "../src/push/handler";
import { summaryType, isActivityType } from "../src/push/schemas";

async function connect(garminId: string, permissions: string[]) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
    expect(requestUrl(input)).toBe("https://apis.garmin.com/partner-gateway/rest/user/permissions");

    return Promise.resolve(Response.json({ permissions }));
  });

  const store = userStore(env, garminId);
  const server = createServer("private-access", store, fetcher);
  const client = new Client({ name: "summary-protocol-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, store, fetcher };
}

it("gathers every day category with health measurements and lightweight activity references", async () => {
  const id = crypto.randomUUID();
  const { client, store, fetcher } = await connect(id, ["HEALTH_EXPORT", "ACTIVITY_EXPORT"]);
  const date = "2026-10-23";

  const delivered = await receivePush(
    new Request("https://delivery.example/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Object.fromEntries(
          summaryType.options.map((type) => [
            type,
            [
              {
                userId: id,
                summaryId: `${type}-1`,
                calendarDate: date,
                activityId: 123,
                value: 0,
                measurements: [{ value: 12, unit: "provider-unit", accessToken: "private-field" }],
                samples: [{ value: 34 }],
              },
            ],
          ]),
        ),
      ),
    }),
    env,
    env.GARMIN_PUSH_TOKEN,
  );

  expect(delivered.status).toBe(200);
  await store.ingest([
    {
      type: "hrv",
      summaryId: "another-day",
      date: "2026-10-22",
      receivedAt: Date.now(),
      data: '{"summaryId":"another-day","value":999}',
    },
  ]);
  await userStore(env, crypto.randomUUID()).ingest([
    {
      type: "hrv",
      summaryId: "another-account",
      date,
      receivedAt: Date.now(),
      data: '{"summaryId":"another-account","value":999}',
    },
  ]);
  fetcher.mockClear();

  const day = await client.callTool({ name: "get_garmin_day", arguments: { date } });

  expect(day.isError).not.toBe(true);

  for (const type of summaryType.options) {
    const reference = { summaryId: `${type}-1` };

    expect(day.structuredContent).toMatchObject({
      source: "Garmin Connect",
      data: {
        date,
        sections: {
          [type]: {
            availability: "available",
            records: [
              isActivityType(type)
                ? { ...reference, activityId: "123" }
                : {
                    ...reference,
                    summary: {
                      summaryId: `${type}-1`,
                      value: 0,
                      measurements: [{ value: 12, unit: "provider-unit" }],
                    },
                  },
            ],
            hasMore: false,
            nextOffset: null,
          },
        },
      },
    });
  }

  expect(day.structuredContent).not.toHaveProperty(
    "data.sections.activityDetails.records.0.summary",
  );
  expect(day.structuredContent).not.toHaveProperty(
    "data.sections.activityDetails.records.0.samples",
  );

  const serialized = JSON.stringify(day);
  expect(serialized).not.toContain("another-day");
  expect(serialized).not.toContain("another-account");
  expect(serialized).not.toContain("private-field");
  expect(serialized).not.toContain("private-access");
  expect(serialized).not.toContain(id);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  { permissions: ["HEALTH_EXPORT"], health: "not_received", activity: "permission_denied" },
  { permissions: ["ACTIVITY_EXPORT"], health: "permission_denied", activity: "not_received" },
  { permissions: [], health: "permission_denied", activity: "permission_denied" },
])("distinguishes missing day data from denied permissions: $permissions", async (testCase) => {
  const { client, store } = await connect(crypto.randomUUID(), testCase.permissions);
  // Stored data must remain inaccessible even if upstream permissions change without a push.
  await store.ingest(
    ["hrv", "activities"].map((type) => ({
      type: summaryType.parse(type),
      summaryId: "protected-record",
      date: "2026-10-22",
      receivedAt: Date.now(),
      data: '{"summaryId":"protected-record","value":999}',
    })),
  );

  const day = await client.callTool({
    name: "get_garmin_day",
    arguments: { date: "2026-10-22" },
  });

  const deniedType = testCase.health === "permission_denied" ? "hrv" : "activities";
  expect(day.structuredContent).toMatchObject({
    data: {
      sections: {
        [deniedType]: {
          availability: "permission_denied",
          records: [],
          hasMore: false,
          nextOffset: null,
        },
        bloodPressures: { availability: testCase.health, records: [] },
        moveIQActivities: { availability: testCase.activity, records: [] },
      },
    },
  });
});

it("keeps multiple measurements and exposes pagination back to the summary tools", async () => {
  const { client, store } = await connect(crypto.randomUUID(), ["HEALTH_EXPORT"]);
  const date = "2026-10-23";
  const receivedAt = Date.parse("2026-10-24T01:02:03.000Z");
  await store.ingest(
    ["bp-1", "bp-2", "bp-3"].map((summaryId) => ({
      type: "bloodPressures" as const,
      summaryId,
      date,
      receivedAt,
      data: JSON.stringify({ summaryId, systolic: 120 }),
    })),
  );

  const day = await client.callTool({
    name: "get_garmin_day",
    arguments: { date, limitPerType: 2 },
  });

  expect(day.structuredContent).toMatchObject({
    data: {
      sections: {
        bloodPressures: {
          availability: "available",
          records: [
            { summaryId: "bp-1", receivedAt: "2026-10-24T01:02:03.000Z" },
            { summaryId: "bp-2", receivedAt: "2026-10-24T01:02:03.000Z" },
          ],
          hasMore: true,
          nextOffset: 2,
        },
        hrv: { availability: "not_received", records: [], hasMore: false, nextOffset: null },
      },
    },
  });

  const remaining = await client.callTool({
    name: "list_garmin_summaries",
    arguments: { type: "bloodPressures", startDate: date, endDate: date, offset: 2 },
  });

  expect(remaining.structuredContent).toMatchObject({
    data: { records: [{ summary: { summaryId: "bp-3" } }], hasMore: false },
  });
});

it("uses the stored device-local date and tolerates activity references without activity IDs", async () => {
  const id = crypto.randomUUID();
  const { client } = await connect(id, ["HEALTH_EXPORT", "ACTIVITY_EXPORT"]);
  await receivePush(
    new Request("https://delivery.example/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hrv: [
          {
            userId: id,
            summaryId: "device-local",
            startTimeInSeconds: Date.parse("2026-10-24T01:00:00Z") / 1000,
            startTimeOffsetInSeconds: -7 * 3600,
          },
        ],
        moveIQActivities: [{ userId: id, summaryId: "move-iq", calendarDate: "2026-10-23" }],
      }),
    }),
    env,
    env.GARMIN_PUSH_TOKEN,
  );

  const day = await client.callTool({
    name: "get_garmin_day",
    arguments: { date: "2026-10-23" },
  });

  expect(day.structuredContent).toMatchObject({
    data: {
      sections: {
        hrv: { records: [{ summaryId: "device-local" }] },
        moveIQActivities: { records: [{ summaryId: "move-iq", activityId: null }] },
      },
    },
  });
});

it("blocks day reads after revocation and fails safely when current permissions are unavailable", async () => {
  const { client, store, fetcher } = await connect(crypto.randomUUID(), ["HEALTH_EXPORT"]);
  await store.revoke();

  const day = await client.callTool({
    name: "get_garmin_day",
    arguments: { date: "2026-10-23" },
  });

  expect(day.structuredContent).toMatchObject({
    data: {
      sections: { hrv: { availability: "permission_denied", records: [] } },
    },
  });

  fetcher.mockRejectedValueOnce(new Error("private-upstream-error"));

  const failed = await client.callTool({
    name: "get_garmin_day",
    arguments: { date: "2026-10-23" },
  });

  expect(failed.isError).toBe(true);
  expect(failed.structuredContent).toBeUndefined();
  expect(JSON.stringify(failed)).not.toContain("private-upstream-error");
});

it.each([
  { date: "2026-02-30" },
  { date: "today" },
  { date: "2026-10-23", userId: "another-account" },
  { date: "2026-10-23", limitPerType: 0 },
  { date: "2026-10-23", limitPerType: 101 },
])("rejects invalid day inputs: $date / $limitPerType", async (args) => {
  const { client, fetcher } = await connect(crypto.randomUUID(), ["HEALTH_EXPORT"]);
  expect((await client.callTool({ name: "get_garmin_day", arguments: args })).isError).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

it("returns only the signed-in account's stored summaries through the MCP protocol", async () => {
  const id = crypto.randomUUID();
  const { client, store } = await connect(id, ["HEALTH_EXPORT", "ACTIVITY_EXPORT"]);
  await store.ingest([
    {
      type: "dailies",
      summaryId: "own",
      date: "2026-10-23",
      receivedAt: Date.now(),
      data: '{"summaryId":"own","steps":123}',
    },
  ]);
  await userStore(env, crypto.randomUUID()).ingest([
    {
      type: "dailies",
      summaryId: "other",
      date: "2026-10-23",
      receivedAt: Date.now(),
      data: '{"summaryId":"other","steps":999}',
    },
  ]);

  const listed = await client.callTool({
    name: "list_garmin_summaries",
    arguments: { type: "dailies", startDate: "2026-10-23", endDate: "2026-10-23" },
  });

  expect(listed.isError).not.toBe(true);
  expect(listed.structuredContent).toMatchObject({
    source: "Garmin Connect",
    data: { records: [{ summary: { summaryId: "own", steps: 123 } }], hasMore: false },
  });
  expect(JSON.stringify(listed)).not.toContain("private-access");
  expect(JSON.stringify(listed)).not.toContain('"other"');

  const detail = await client.callTool({
    name: "get_garmin_summary",
    arguments: { type: "dailies", summaryId: "own" },
  });

  expect(detail.structuredContent).toMatchObject({ data: { steps: 123 } });

  const missing = await client.callTool({
    name: "get_garmin_summary",
    arguments: { type: "dailies", summaryId: "other" },
  });

  expect(missing.structuredContent).toMatchObject({ data: null });

  const invalid = await client.callTool({
    name: "list_garmin_summaries",
    arguments: {
      type: "dailies",
      startDate: "2026-10-23",
      endDate: "2026-12-23",
      userId: "someone-else",
    },
  });

  expect(invalid.isError).toBe(true);
});

it("rechecks Garmin permissions even when data remains stored", async () => {
  const { client, store } = await connect(crypto.randomUUID(), ["WORKOUT_IMPORT"]);
  await store.ingest([
    {
      type: "dailies",
      summaryId: "blocked",
      date: "2026-10-23",
      receivedAt: Date.now(),
      data: '{"steps":123}',
    },
  ]);

  const denied = await client.callTool({
    name: "get_garmin_summary",
    arguments: { type: "dailies", summaryId: "blocked" },
  });

  expect(denied.isError).toBe(true);
  expect(JSON.stringify(denied)).not.toContain("123");
});

it("requires explicit confirmation before deleting stored data and can collect afterward", async () => {
  const { client, store } = await connect(crypto.randomUUID(), ["HEALTH_EXPORT"]);

  const row = {
    type: "dailies" as const,
    summaryId: "delete",
    date: "2026-10-23",
    receivedAt: Date.now(),
    data: '{"steps":123}',
  };

  await store.ingest([row]);
  expect(
    (await client.callTool({ name: "delete_stored_garmin_data", arguments: { confirm: false } }))
      .isError,
  ).toBe(true);
  expect(await store.get("dailies", "delete")).not.toBeNull();
  expect(
    (await client.callTool({ name: "delete_stored_garmin_data", arguments: { confirm: true } }))
      .structuredContent,
  ).toMatchObject({ data: { deleted: true } });
  expect(await store.get("dailies", "delete")).toBeNull();
  await store.ingest([row]);
  expect(await store.get("dailies", "delete")).not.toBeNull();
});
