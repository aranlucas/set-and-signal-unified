import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { env } from "cloudflare:workers";
import { expect, it, onTestFinished, vi } from "vitest";
import { createServer } from "../src/mcp";
import { userStore } from "../src/push/store";
import { requestUrl } from "./support";

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

  return { client, store };
}

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
