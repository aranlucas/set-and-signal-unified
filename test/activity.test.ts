import { z } from "zod";
import { Encoder, type FileIdMesg, type SetMesg } from "@garmin/fitsdk";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect, it, onTestFinished, vi } from "vitest";
import { createServer } from "../src/mcp";
import { receivePush } from "../src/push/handler";
import { userStore } from "../src/push/store";
import { requestUrl, recordedFitFixture } from "./support";
import { MAX_FIT_BYTES } from "../src/activity/fit";

function fit(
  sets: SetMesg[] = [
    { setType: "active", repetitions: 8, weight: 22.5 },
    { setType: "rest", duration: 60 },
  ],
) {
  const encoder = new Encoder();
  const file: FileIdMesg = { type: "activity" };
  encoder.onMesg(0, file);

  for (const set of sets) {
    encoder.onMesg(225, set);
  }

  return new Uint8Array(encoder.close());
}

const fileNotification = (userId: string) => ({
  userId,
  activityId: 123,
  summaryId: "123-file",
  fileType: "FIT",
  startTimeInSeconds: 1792807200,
  callbackURL:
    "https://apis.garmin.com/wellness-api/rest/activityFile?id=opaque-file-id&token=private-file-token",
});

function pushFiles(userId: string, override = {}) {
  return receivePush(
    new Request("https://delivery.example/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityFiles: [{ ...fileNotification(userId), ...override }] }),
    }),
    env,
    env.GARMIN_PUSH_TOKEN,
  );
}

type ConnectOptions = { permissions?: string[]; fileResponse?: () => Response | Promise<Response> };

type CallbackRow = { callback: string | null };

async function connect(options: ConnectOptions = {}) {
  const id = crypto.randomUUID();
  const store = userStore(env, id);
  await store.ingest([
    {
      type: "activities",
      summaryId: "123",
      date: "2026-10-24",
      receivedAt: Date.now(),
      data: '{"activityId":123,"activityName":"Strength"}',
    },
    {
      type: "activityDetails",
      summaryId: "123-detail",
      date: "2026-10-24",
      receivedAt: Date.now(),
      data: '{"activityId":123,"samples":[{"heartRate":120}]}',
    },
  ]);

  const fetcher = vi.fn<typeof fetch>().mockImplementation((input, init) => {
    if (requestUrl(input).endsWith("/user/permissions")) {
      return Promise.resolve(
        Response.json({ permissions: options.permissions ?? ["ACTIVITY_EXPORT"] }),
      );
    }

    expect(requestUrl(input)).toBe(fileNotification(id).callbackURL);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-access");
    expect(init?.redirect).toBe("error");

    return Promise.resolve(options.fileResponse?.() ?? new Response(fit()));
  });

  const server = createServer("private-access", store, fetcher);
  const client = new Client({ name: "activity-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(b);
  await client.connect(a);

  return { client, store, fetcher, id };
}

it("automatically enriches activity and summary reads from delivered FIT metadata and caches across eviction", async () => {
  const { client, store, fetcher, id } = await connect();
  expect((await pushFiles(id)).status).toBe(200);
  expect(fetcher).not.toHaveBeenCalled();
  const tools = await client.listTools();
  expect(
    tools.tools.find((tool) => tool.name === "get_garmin_activity")?.annotations,
  ).toMatchObject({ readOnlyHint: true, openWorldHint: true });
  expect(tools.tools.some((tool) => tool.name === "decode_strength_activity_file")).toBe(false);

  const result = await client.callTool({
    name: "get_garmin_activity",
    arguments: { activityId: 123 },
  });

  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({
    data: {
      activityId: "123",
      summary: { activityName: "Strength" },
      details: { samples: [{ heartRate: 120 }] },
      fit: {
        availability: "available",
        activityId: "123",
        fileSummaryId: "123-file",
        sets: [
          { repetitions: 8, weightKg: 22.5 },
          { setType: "rest", durationSeconds: 60 },
        ],
      },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/private-access|private-file-token|callbackURL/);
  await pushFiles(id);
  await evictDurableObject(store);

  const summary = await client.callTool({
    name: "get_garmin_summary",
    arguments: { type: "activityDetails", summaryId: "123-detail" },
  });

  expect(summary.structuredContent).toMatchObject({
    data: { fit: { sets: [{ repetitions: 8 }, { setType: "rest" }] } },
  });
  expect(
    fetcher.mock.calls.filter(([input]) => requestUrl(input).includes("activityFile?")),
  ).toHaveLength(1);
  expect(
    (await client.callTool({ name: "get_garmin_activity", arguments: { activityId: "999" } }))
      .structuredContent,
  ).toMatchObject({ data: null });
});

it("downloads and decodes automatically in the account alarm before any activity read", async () => {
  const { client, store, id, fetcher } = await connect();
  await store.bindActivityOwner(id, id);
  await pushFiles(id);

  const backgroundFetch = vi.fn<typeof fetch>().mockImplementation((input, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer fixture-${id}`);

    return Promise.resolve(
      requestUrl(input).endsWith("/user/permissions")
        ? Response.json({ permissions: ["ACTIVITY_EXPORT"] })
        : new Response(fit()),
    );
  });

  vi.stubGlobal("fetch", backgroundFetch);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  await evictDurableObject(store);
  expect(await runDurableObjectAlarm(store)).toBe(true);

  const result = await client.callTool({
    name: "get_garmin_activity",
    arguments: { activityId: 123 },
  });

  expect(result.structuredContent).toMatchObject({
    data: {
      fit: { availability: "available", sets: [{ repetitions: 8 }, { setType: "rest" }] },
    },
  });
  expect(
    fetcher.mock.calls.every(([input]) => requestUrl(input).endsWith("/user/permissions")),
  ).toBe(true);
});

it("fetches FIT sets directly through the existing get_garmin_summary activity read", async () => {
  const { client, id } = await connect();
  await pushFiles(id);

  const result = await client.callTool({
    name: "get_garmin_summary",
    arguments: { type: "activities", summaryId: "123" },
  });

  expect(result.structuredContent).toMatchObject({
    data: {
      activityName: "Strength",
      fit: { availability: "available", sets: [{ repetitions: 8 }, { setType: "rest" }] },
    },
  });
});

// This large roundtrip encodes 12,000 samples and persists/reloads more than 2 MiB.
it("returns all FIT data from get_garmin_summary and retains decoded files larger than a SQLite value across eviction", async () => {
  const { client, store, id, fetcher } = await connect({
    fileResponse: () => new Response(recordedFitFixture(12000)),
  });

  await pushFiles(id);
  const summaryInput = { type: "activities", summaryId: "123" };
  const first = await client.callTool({ name: "get_garmin_summary", arguments: summaryInput });
  expect(first.isError).not.toBe(true);
  expect(first.structuredContent).toMatchObject({
    data: {
      fit: {
        availability: "available",
        messages: {
          sessionMesgs: [{ totalDistance: 1234.5 }],
          deviceInfoMesgs: [{ productName: "Synthetic GPS device 🏃" }],
          fieldDescriptionMesgs: [{ fieldName: "exactCounter" }],
        },
      },
    },
  });

  const parsed = z
    .object({
      data: z.object({
        fit: z.object({
          messages: z.object({ recordMesgs: z.array(z.object({ timestamp: z.number() })) }),
        }),
      }),
    })
    .parse(first.structuredContent);

  expect(parsed.data.fit.messages.recordMesgs).toHaveLength(12000);
  expect(parsed.data.fit.messages.recordMesgs.at(-1)?.timestamp).toBe(1_000_011_999);
  expect(Buffer.byteLength(JSON.stringify(first.structuredContent), "utf8")).toBeGreaterThan(
    2 * 1024 * 1024,
  );
  await evictDurableObject(store);
  const cached = await client.callTool({ name: "get_garmin_summary", arguments: summaryInput });
  expect(cached.structuredContent).toEqual(first.structuredContent);
  expect(
    fetcher.mock.calls.filter(([input]) => requestUrl(input).includes("activityFile?")),
  ).toHaveLength(1);
}, 15_000);

it("rejects a background Auth account mismatch before downloading", async () => {
  const { store, id, fetcher } = await connect();
  await store.bindActivityOwner("a-different-garmin-account", id);
  await pushFiles(id);
  vi.stubGlobal("fetch", fetcher);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  await runDurableObjectAlarm(store);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await store.getActivity("123")).toBeNull();
});

it("purges decoded sets on permission withdrawal and rejects late file delivery", async () => {
  const { client, store, id } = await connect();
  await pushFiles(id);
  await client.callTool({ name: "get_garmin_activity", arguments: { activityId: 123 } });
  await store.permissions(["HEALTH_EXPORT"], 1);
  await pushFiles(id);
  expect(await store.getActivity("123")).toBeNull();
  expect(await store.claimActivityFile("123")).toMatchObject({ state: "permission_denied" });
});

it("withholds decoded sets if Garmin withdraws activity permission during download", async () => {
  const { client, store, id } = await connect({
    fileResponse: async () => {
      await store.permissions(["HEALTH_EXPORT"], 1);

      return new Response(fit());
    },
  });

  await pushFiles(id);

  const result = await client.callTool({
    name: "get_garmin_activity",
    arguments: { activityId: 123 },
  });

  expect(result.structuredContent).toMatchObject({ data: null });
  expect(JSON.stringify(result)).not.toContain("weightKg");
});

it("can read a file that arrives before its JSON summary, and distinguishes files with no recorded sets", async () => {
  const { client, store, id } = await connect({ fileResponse: () => new Response(fit([])) });
  await store.clear();
  await pushFiles(id);

  const result = await client.callTool({
    name: "get_garmin_activity",
    arguments: { activityId: 123 },
  });

  expect(result.structuredContent).toMatchObject({
    data: {
      summary: null,
      details: null,
      fit: { availability: "available", strengthAvailability: "no_recorded_sets", sets: [] },
    },
  });
});

it.each([
  "http://apis.garmin.com/wellness-api/rest/activityFile?id=x&token=y",
  "https://evil.example/wellness-api/rest/activityFile?id=x&token=y",
  "https://apis.garmin.com/partner-gateway/rest/user/id?id=x&token=y",
  "https://secret@apis.garmin.com/wellness-api/rest/activityFile?id=x&token=y",
  "https://apis.garmin.com/wellness-api/rest/activityFile?id=x&token=y&token=z",
  "https://apis.garmin.com/wellness-api/rest/activityFile?id=x&token=y#fragment",
])("rejects unsafe file callback %s without storing a job", async (callbackURL) => {
  const id = crypto.randomUUID();
  expect((await pushFiles(id, { callbackURL })).status).toBe(400);
  expect(await userStore(env, id).getActivity("123")).toBeNull();
});

it.each([
  () => new Response("private-malformed-fit"),
  () => new Response(null, { status: 410 }),
  () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } }),
  () => new Response(new Uint8Array(MAX_FIT_BYTES + 1)),
])(
  "keeps the activity available when a file cannot be decoded and never retries its one-use URL",
  async (fileResponse) => {
    const { client, fetcher, id } = await connect({ fileResponse });
    await pushFiles(id);

    const result = await client.callTool({
      name: "get_garmin_activity",
      arguments: { activityId: 123 },
    });

    expect(result.structuredContent).toMatchObject({
      data: {
        summary: { activityName: "Strength" },
        fit: { availability: "unavailable", sets: [] },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-malformed-fit|private-file-token|private-access/,
    );
    await client.callTool({ name: "get_garmin_activity", arguments: { activityId: 123 } });
    expect(
      fetcher.mock.calls.filter(([input]) => requestUrl(input).includes("activityFile?")),
    ).toHaveLength(1);
  },
);

it("does not download without current activity permission or expose another account's file", async () => {
  const { client, fetcher, id } = await connect({ permissions: ["HEALTH_EXPORT"] });
  await pushFiles(id);
  expect(
    (await client.callTool({ name: "get_garmin_activity", arguments: { activityId: 123 } }))
      .isError,
  ).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const other = await connect();
  expect(
    (await other.client.callTool({ name: "get_garmin_activity", arguments: { activityId: 123 } }))
      .structuredContent,
  ).toMatchObject({ data: { fit: { availability: "not_received" } } });
});

it("expires private callback URLs with the shared alarm without deleting summaries", async () => {
  const { client, store, id, fetcher } = await connect();
  await pushFiles(id);
  await runInDurableObject(store, (_instance, state) =>
    state.storage.sql.exec("UPDATE activity_files SET expires_at=0"),
  );
  await runDurableObjectAlarm(store);

  const result = await client.callTool({
    name: "get_garmin_activity",
    arguments: { activityId: 123 },
  });

  expect(result.structuredContent).toMatchObject({
    data: { fit: { availability: "expired" } },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    await runInDurableObject(
      store,
      (_instance, state) =>
        state.storage.sql.exec<CallbackRow>("SELECT callback FROM activity_files").one().callback,
    ),
  ).toBeNull();
});

it("does not restore data when deleted during a file download", async () => {
  const download = new TransformStream<Uint8Array, Uint8Array>();

  const { client, store, id, fetcher } = await connect({
    fileResponse: () => new Response(download.readable),
  });

  await pushFiles(id);
  const pending = client.callTool({ name: "get_garmin_activity", arguments: { activityId: 123 } });
  await vi.waitFor(() =>
    expect(fetcher.mock.calls.some(([input]) => requestUrl(input).includes("activityFile?"))).toBe(
      true,
    ),
  );
  await store.clear();
  const writer = download.writable.getWriter();
  await writer.write(fit());
  await writer.close();
  expect((await pending).structuredContent).toMatchObject({ data: null });
  expect(await store.getActivity("123")).toBeNull();
});

it("does not consume a file twice during concurrent reads", async () => {
  const download = new TransformStream<Uint8Array, Uint8Array>();

  const { client, id, fetcher } = await connect({
    fileResponse: () => new Response(download.readable),
  });

  await pushFiles(id);
  const first = client.callTool({ name: "get_garmin_activity", arguments: { activityId: 123 } });
  await vi.waitFor(() =>
    expect(fetcher.mock.calls.some(([input]) => requestUrl(input).includes("activityFile?"))).toBe(
      true,
    ),
  );

  const second = await client.callTool({
    name: "get_garmin_summary",
    arguments: { type: "activities", summaryId: "123" },
  });

  expect(second.structuredContent).toMatchObject({
    data: { fit: { availability: "downloading" } },
  });
  const writer = download.writable.getWriter();
  await writer.write(fit());
  await writer.close();
  expect((await first).structuredContent).toMatchObject({
    data: { fit: { availability: "available" } },
  });
  expect(
    fetcher.mock.calls.filter(([input]) => requestUrl(input).includes("activityFile?")),
  ).toHaveLength(1);
});
