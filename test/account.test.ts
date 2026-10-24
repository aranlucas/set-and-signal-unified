import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { createServer } from "../src/mcp";
import type { EventOwner } from "../src/events/protocol";
import { userStore } from "../src/push/store";

const accountUri = "garmin://account";

const unavailableMessage =
  "Linked Garmin account is unavailable. Reconnect Garmin in Auth and try again.";

const privateAccessToken = "private-account-access-token";

const owner = {
  subject: "private-auth-subject",
  garminUserId: "linked-garmin-user-id",
  email: "private-account@example.com",
  refreshToken: "private-account-refresh-token",
};

async function connect(eventOwner?: EventOwner) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("Account resources must not make upstream requests"));

  const storeAccess = vi.fn<(property: string | symbol) => void>();

  const store = new Proxy(userStore(env, crypto.randomUUID()), {
    get(_target, property) {
      storeAccess(property);

      throw new Error("Account resources must not access stored Garmin data");
    },
  });

  vi.stubGlobal("fetch", fetcher);
  const server = createServer(privateAccessToken, store, fetcher, eventOwner);
  const client = new Client({ name: "account-protocol-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, fetcher, storeAccess };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("discovers one static JSON account resource without adding an account tool", async () => {
  const { client, fetcher, storeAccess } = await connect(owner);
  const resources = await client.listResources();
  const templates = await client.listResourceTemplates();
  const tools = await client.listTools();

  expect(client.getServerCapabilities()).toHaveProperty("resources");
  expect(resources.resources).toEqual([
    expect.objectContaining({
      uri: accountUri,
      name: "garmin-account",
      mimeType: "application/json",
    }),
  ]);
  expect(templates.resourceTemplates).toEqual([]);
  expect(tools.tools.map((tool) => tool.name).toSorted()).toEqual([
    "create_workout",
    "delete_stored_garmin_data",
    "delete_workout",
    "delete_workout_schedule",
    "get_garmin_activity",
    "get_garmin_summary",
    "get_workout",
    "get_workout_schedule",
    "list_garmin_summaries",
    "list_workout_schedules",
    "schedule_workout",
    "update_workout",
    "update_workout_schedule",
  ]);
  expect(JSON.stringify(resources)).not.toContain(owner.garminUserId);
  expect(JSON.stringify(resources)).not.toContain(owner.subject);
  expect(JSON.stringify(resources)).not.toContain(owner.email);
  expect(JSON.stringify(resources)).not.toContain(owner.refreshToken);
  expect(JSON.stringify(resources)).not.toContain(privateAccessToken);
  expect(fetcher).not.toHaveBeenCalled();
  expect(storeAccess).not.toHaveBeenCalled();
});

it("reads only the validated linked Garmin ID without credentials or Auth identity", async () => {
  const { client, fetcher, storeAccess } = await connect(owner);
  const resource = await client.readResource({ uri: accountUri });

  expect(resource.contents).toEqual([
    {
      uri: accountUri,
      mimeType: "application/json",
      text: JSON.stringify({ userId: owner.garminUserId }),
    },
  ]);
  expect(JSON.stringify(resource)).not.toContain(privateAccessToken);
  expect(JSON.stringify(resource)).not.toContain(owner.refreshToken);
  expect(JSON.stringify(resource)).not.toContain(owner.subject);
  expect(JSON.stringify(resource)).not.toContain(owner.email);
  expect(fetcher).not.toHaveBeenCalled();
  expect(storeAccess).not.toHaveBeenCalled();
});

it("keeps the same account URI isolated between concurrent authenticated clients", async () => {
  const first = await connect(owner);

  const secondOwner = {
    subject: "other-private-auth-subject",
    garminUserId: "other-linked-garmin-user-id",
  };

  const second = await connect(secondOwner);

  const [firstRead, secondRead, firstReadAgain] = await Promise.all([
    first.client.readResource({ uri: accountUri }),
    second.client.readResource({ uri: accountUri }),
    first.client.readResource({ uri: accountUri }),
  ]);

  expect(firstRead.contents).toEqual([
    {
      uri: accountUri,
      mimeType: "application/json",
      text: JSON.stringify({ userId: owner.garminUserId }),
    },
  ]);
  expect(secondRead.contents).toEqual([
    {
      uri: accountUri,
      mimeType: "application/json",
      text: JSON.stringify({ userId: secondOwner.garminUserId }),
    },
  ]);
  expect(firstReadAgain).toEqual(firstRead);
  expect(first.fetcher).not.toHaveBeenCalled();
  expect(second.fetcher).not.toHaveBeenCalled();
  expect(first.storeAccess).not.toHaveBeenCalled();
  expect(second.storeAccess).not.toHaveBeenCalled();
});

it.each([
  "garmin://account?userId=other-linked-garmin-user-id",
  "garmin://account?garminUserId=other-linked-garmin-user-id",
  "garmin://account?subject=other-private-auth-subject",
  "garmin://account/other-linked-garmin-user-id",
  "garmin://account#other-linked-garmin-user-id",
  "garmin://account/",
  "garmin://other-linked-garmin-user-id",
])("rejects caller-selected account URI %s", async (uri) => {
  const { client, fetcher, storeAccess } = await connect(owner);

  await expect(client.readResource({ uri })).rejects.toMatchObject({ code: -32602 });
  expect(fetcher).not.toHaveBeenCalled();
  expect(storeAccess).not.toHaveBeenCalled();
});

it.each(["no request owner", "missing Garmin ID", "empty Garmin ID"])(
  "returns a safe MCP error for %s without falling back to Auth or Garmin",
  async (scenario) => {
    const incompleteOwner = { ...owner, garminUserId: "" };

    if (scenario === "missing Garmin ID") {
      Reflect.deleteProperty(incompleteOwner, "garminUserId");
    }

    const { client, fetcher, storeAccess } = await connect(
      scenario === "no request owner" ? undefined : incompleteOwner,
    );

    const resources = await client.listResources();

    expect(resources.resources).toContainEqual(
      expect.objectContaining({ uri: accountUri, name: "garmin-account" }),
    );
    await expect(client.readResource({ uri: accountUri })).rejects.toMatchObject({
      name: "ProtocolError",
      message: unavailableMessage,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(storeAccess).not.toHaveBeenCalled();
  },
);
