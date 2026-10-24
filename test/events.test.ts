/* oxlint-disable no-await-in-loop -- Each lifecycle step depends on the preceding durable state. */
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { z } from "zod";
import { createServer } from "../src/mcp";
import { receivePush } from "../src/push/handler";
import { userStore } from "../src/push/store";
import { eventData, type SubscribeParams } from "../src/events/protocol";
import { callbackUrl } from "../src/events/webhook";
import { required, requestUrl } from "./support";

const secret = `whsec_${Buffer.alloc(32, 2).toString("base64")}`;

const rotatedSecret = `whsec_${Buffer.alloc(32, 3).toString("base64")}`;

const subscribed = z.object({
  id: z.string(),
  refreshBefore: z.string(),
  cursor: z.null(),
  truncated: z.literal(false),
});

const occurrence = z.object({
  eventId: z.string(),
  name: z.string(),
  timestamp: z.string(),
  data: eventData,
  cursor: z.null(),
});

type Delivery = { url: string; body: string; headers: Record<string, string> };

type CountRow = { count: number };

type FixtureState = {
  permissions: string[];
  unavailable: boolean;
  callbackStatus: number;
  invalidChallenge: boolean;
  beforeVerification?: () => Promise<void>;
  beforePermission?: () => Promise<void>;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const subscriptionParams = (
  url = "https://callback.example.com/one",
  args: SubscribeParams["arguments"] = {},
): SubscribeParams => ({
  name: "garmin.activity.completed",
  arguments: args,
  delivery: { mode: "webhook", url, secret },
});

const push = (body: z.infer<ReturnType<typeof z.json>>) =>
  receivePush(
    new Request("https://receiver.example.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    env.GARMIN_PUSH_TOKEN,
  );

async function fixture() {
  const id = crypto.randomUUID();
  const owner = { subject: id, garminUserId: id };
  const store = userStore(env, id);
  const deliveries: Delivery[] = [];

  const state: FixtureState = {
    permissions: ["ACTIVITY_EXPORT", "HEALTH_EXPORT"],
    unavailable: false,
    callbackStatus: 200,
    invalidChallenge: false,
  };

  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = requestUrl(input);

    if (url === "https://apis.garmin.com/partner-gateway/rest/user/permissions") {
      await state.beforePermission?.();

      return state.unavailable
        ? new Response(null, { status: 503 })
        : Response.json({ permissions: state.permissions });
    }

    if (init?.redirect !== "error") {
      throw new Error("Unsafe callback redirect policy");
    }

    const body = z.string().parse(init?.body);
    const headers = Object.fromEntries(new Headers(init?.headers));

    const verification = z
      .object({ type: z.literal("verification"), challenge: z.string() })
      .safeParse(JSON.parse(body));

    if (verification.success) {
      await state.beforeVerification?.();

      return Response.json({
        challenge: state.invalidChallenge ? "wrong" : verification.data.challenge,
      });
    }

    deliveries.push({ url, body, headers });

    return new Response(null, { status: state.callbackStatus });
  });

  vi.stubGlobal("fetch", fetcher);
  const server = createServer("private-test-access", store, fetcher, owner);
  const client = new Client({ name: "events-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await store.clear();
  });

  const subscribe = (value = subscriptionParams()) =>
    client.request({ method: "events/subscribe", params: value }, subscribed);

  const activity = (summaryId = "run-1") => ({
    userId: id,
    summaryId,
    calendarDate: "2026-10-24",
    startTimeInSeconds: 1792860000,
    durationInSeconds: 1800,
    activityType: "RUNNING",
    distanceInMeters: 5000,
    userAccessToken: "provider-secret",
    samples: [{ latitude: 1, longitude: 2 }],
  });

  async function flush() {
    await runInDurableObject(store, (_instance, context) =>
      context.storage.sql.exec("UPDATE event_deliveries SET next_at=0").toArray(),
    );
    await runDurableObjectAlarm(store);
  }

  function count(table: "event_subscriptions" | "event_occurrences" | "event_deliveries") {
    return runInDurableObject(
      store,
      (_instance, context) =>
        context.storage.sql.exec<CountRow>(`SELECT count(*) AS count FROM ${table}`).one().count,
    );
  }

  return {
    id,
    owner,
    store,
    server,
    client,
    state,
    deliveries,
    fetcher,
    params: subscriptionParams,
    subscribe,
    push,
    activity,
    flush,
    count,
  };
}

it("discovers permission-filtered event schemas through the MCP SDK", async () => {
  const f = await fixture();

  const schema = z.object({
    events: z.array(
      z.object({
        name: z.string(),
        delivery: z.array(z.string()),
        inputSchema: z.object({ type: z.literal("object") }),
        payloadSchema: z.object({ type: z.literal("object") }),
      }),
    ),
  });

  expect(f.server.server.getCapabilities()).toMatchObject({ events: {} });
  expect(
    (await f.client.request({ method: "events/list", params: {} }, schema)).events.map(
      (event) => event.name,
    ),
  ).toEqual([
    "garmin.activity.completed",
    "garmin.sleep.available",
    "garmin.body_composition.recorded",
  ]);
  f.state.permissions = ["HEALTH_EXPORT"];
  expect(
    (await f.client.request({ method: "events/list", params: {} }, schema)).events.map(
      (event) => event.name,
    ),
  ).toEqual(["garmin.sleep.available", "garmin.body_composition.recorded"]);
  await expect(
    f.client.request({ method: "events/list", params: { cursor: "invalid" } }, schema),
  ).rejects.toMatchObject({ code: -32602 });
});

it("delivers one logical workout to each matching subscription, with verified signatures after eviction", async () => {
  const f = await fixture();
  const a = await f.subscribe();

  const b = await f.subscribe(
    f.params("https://another.example.com/two", {
      activityTypes: ["running"],
      minDurationSeconds: 600,
    }),
  );

  await f.subscribe(
    f.params("https://callback.example.com/cycling", { activityTypes: ["CYCLING"] }),
  );
  await f.subscribe(f.params("https://callback.example.com/long", { minDurationSeconds: 7200 }));
  expect(a.id).not.toBe(b.id);
  expect(await f.push({ activities: [f.activity()] })).toHaveProperty("status", 200);
  await f.push({
    activities: [f.activity()],
    activityDetails: [f.activity()],
    manuallyUpdatedActivities: [f.activity()],
    moveIQActivities: [f.activity()],
  });
  expect(await f.count("event_deliveries")).toBe(2);
  await evictDurableObject(f.store);
  await f.flush();
  expect(f.deliveries).toHaveLength(2);

  const events = f.deliveries.map((delivery) =>
    occurrence.parse(new Webhook(secret).verify(delivery.body, delivery.headers)),
  );

  expect(events[0]?.eventId).toBe(events[1]?.eventId);
  expect(
    new Set(f.deliveries.map((delivery) => delivery.headers["x-mcp-subscription-id"])),
  ).toEqual(new Set([a.id, b.id]));
  expect(events[0]?.data).toMatchObject({
    type: "activities",
    summaryId: "run-1",
    activityType: "RUNNING",
    distanceInMeters: 5000,
  });
  expect(JSON.stringify(events)).not.toMatch(
    /provider-secret|private-test-access|latitude|longitude|userId/,
  );
  expect(await f.count("event_occurrences")).toBe(0);
  expect(await f.count("event_deliveries")).toBe(0);
  expect(await f.store.get("activities", "run-1")).not.toBeNull();
  await f.push({ activities: [f.activity()] });
  expect(await f.count("event_deliveries")).toBe(0);
}, 40000);

it("suppresses pre-subscription history and explicit imports", async () => {
  const f = await fixture();
  await f.push({ activities: [f.activity("old")] });
  await f.subscribe();
  await f.push({
    activities: [
      f.activity("old"),
      { ...f.activity("import"), importSource: "garmin-personal-api" },
      { ...f.activity("manual"), isManual: true },
    ],
  });
  expect(await f.count("event_deliveries")).toBe(0);
  await f.push({ activities: [f.activity("new")] });
  await f.flush();
  expect(f.deliveries).toHaveLength(1);
  expect(
    occurrence.parse(JSON.parse(required(f.deliveries[0], "delivery").body)).data.summaryId,
  ).toBe("new");
});

it("emits sleep and body-composition references and suppresses later sleep revisions", async () => {
  const f = await fixture();
  await f.subscribe({ ...f.params(), name: "garmin.sleep.available" });
  await f.subscribe({ ...f.params(), name: "garmin.body_composition.recorded" });

  const sleep = {
    userId: f.id,
    summaryId: "sleep-1",
    calendarDate: "2026-10-24",
    startTimeInSeconds: 1792820000,
    durationInSeconds: 20000,
  };

  await f.push({ sleeps: [sleep], bodyComps: [{ ...sleep, summaryId: "weight-1" }] });
  await f.push({ sleeps: [{ ...sleep, summaryId: "sleep-complete", durationInSeconds: 25000 }] });
  await f.flush();
  expect(
    f.deliveries.map((delivery) => occurrence.parse(JSON.parse(delivery.body)).name).toSorted(),
  ).toEqual(["garmin.body_composition.recorded", "garmin.sleep.available"]);
  expect(
    f.deliveries.map(
      (delivery) => occurrence.parse(JSON.parse(delivery.body)).data.startTimeInSeconds,
    ),
  ).toEqual([sleep.startTimeInSeconds, sleep.startTimeInSeconds]);
  expect(await f.store.get("sleeps", "sleep-complete")).not.toBeNull();
});

it("normalizes subscription identity, clamps TTL, encrypts secrets, and rotates signing keys", async () => {
  const f = await fixture();

  const first = await f.subscribe({
    ...f.params(),
    arguments: { activityTypes: ["running", "RUNNING"], minDurationSeconds: 0 },
    ttlMs: 1,
  });

  const secondParams = {
    ...f.params(),
    arguments: { minDurationSeconds: 0, activityTypes: ["RUNNING"] },
  };

  expect((await f.subscribe(secondParams)).id).toBe(first.id);
  expect(Date.parse(first.refreshBefore) - Date.now()).toBeGreaterThan(299000);
  await f.push({ activities: [f.activity()] });

  const rotated = {
    ...secondParams,
    delivery: { ...secondParams.delivery, secret: rotatedSecret },
  };

  expect((await f.subscribe(rotated)).id).toBe(first.id);
  expect(await f.count("event_subscriptions")).toBe(1);

  const stored = await runInDurableObject(f.store, (_instance, context) =>
    context.storage.sql.exec("SELECT secret,previous_secret FROM event_subscriptions").toArray(),
  );

  expect(JSON.stringify(stored)).not.toContain("whsec_");
  expect(JSON.stringify(stored)).not.toContain(env.GARMIN_PUSH_TOKEN);
  await f.flush();
  const delivery = required(f.deliveries[0], "rotated delivery");
  expect(new Webhook(rotatedSecret).verify(delivery.body, delivery.headers)).toMatchObject({
    name: "garmin.activity.completed",
  });
  expect(new Webhook(secret).verify(delivery.body, delivery.headers)).toMatchObject({
    name: "garmin.activity.completed",
  });
  const maximum = await f.subscribe({ ...rotated, ttlMs: null });
  expect(Date.parse(maximum.refreshBefore) - Date.now()).toBeLessThanOrEqual(7 * 86400000);
  expect(Date.parse(maximum.refreshBefore) - Date.now()).toBeGreaterThan(7 * 86400000 - 1000);
});

it("retains a stable event id over transient retries and clears permanent or exhausted deliveries", async () => {
  const f = await fixture();
  await f.subscribe();
  await f.push({ activities: [f.activity()] });
  f.state.callbackStatus = 503;
  await f.flush();
  expect(await f.count("event_deliveries")).toBe(1);
  f.state.callbackStatus = 200;
  await f.flush();
  expect(
    f.deliveries.map((delivery) => occurrence.parse(JSON.parse(delivery.body)).eventId)[0],
  ).toBe(occurrence.parse(JSON.parse(required(f.deliveries[1], "retry").body)).eventId);
  expect(await f.count("event_occurrences")).toBe(0);
  await f.push({ activities: [f.activity("permanent")] });
  f.state.callbackStatus = 410;
  await f.flush();
  expect(await f.count("event_deliveries")).toBe(0);
  await f.push({ activities: [f.activity("exhausted")] });
  f.state.callbackStatus = 503;

  for (let attempt = 0; attempt < 5; attempt++) {
    await f.flush();
  }

  expect(await f.count("event_deliveries")).toBe(0);
  expect(await f.count("event_occurrences")).toBe(0);
}, 40000);

it("retries authorization outages without sending and stops on permission withdrawal", async () => {
  const f = await fixture();
  await f.subscribe();
  await f.push({ activities: [f.activity()] });
  f.state.unavailable = true;
  await f.flush();
  expect(f.deliveries).toHaveLength(0);
  expect(await f.count("event_deliveries")).toBe(1);
  f.state.unavailable = false;
  f.state.permissions = ["HEALTH_EXPORT"];
  await f.flush();
  expect(f.deliveries).toHaveLength(0);
  expect(await f.count("event_deliveries")).toBe(0);
  expect(await f.count("event_subscriptions")).toBe(0);
});

it("scopes unsubscribe to the owner and removes pending payloads on unsubscribe, deletion, and disconnect", async () => {
  const f = await fixture();
  const params = f.params();
  await f.subscribe(params);
  await f.push({ activities: [f.activity()] });
  await f.store.unsubscribeEvent({ ...f.owner, subject: "someone-else" }, params);
  expect(await f.count("event_deliveries")).toBe(1);
  await f.client.request(
    {
      method: "events/unsubscribe",
      params: {
        name: params.name,
        arguments: params.arguments,
        delivery: { url: params.delivery.url },
      },
    },
    z.object({}),
  );
  expect(await f.count("event_deliveries")).toBe(0);
  expect(await f.count("event_occurrences")).toBe(0);
  await f.subscribe();
  await f.push({ activities: [f.activity("delete")] });
  await f.store.clear();
  expect(await f.count("event_subscriptions")).toBe(0);
  expect(await f.count("event_occurrences")).toBe(0);
  await f.subscribe();
  await f.push({ activities: [f.activity("disconnect")] });
  await f.store.revoke();
  await f.push({ activities: [f.activity("late")] });
  expect(await f.count("event_deliveries")).toBe(0);
  expect(await f.store.get("activities", "late")).toBeNull();
  expect(f.deliveries).toHaveLength(0);
});

it("purges only withdrawn event categories and rejects account mismatches", async () => {
  const f = await fixture();
  await f.subscribe();
  await f.subscribe({ ...f.params(), name: "garmin.sleep.available" });
  await f.store.permissions(["HEALTH_EXPORT"], 1);
  expect(await f.count("event_subscriptions")).toBe(1);
  await expect(f.subscribe()).rejects.toMatchObject({ code: -32012 });

  const wrongAccount = await f.store.subscribeEvent(
    { subject: "different-account", garminUserId: f.id },
    { ...f.params(), name: "garmin.sleep.available" },
  );

  expect(wrongAccount).toMatchObject({ ok: false, code: -32012 });

  const unlinked = await f.store.subscribeEvent(
    { subject: "unlinked-account", garminUserId: f.id },
    { ...f.params(), name: "garmin.sleep.available" },
  );

  expect(unlinked).toMatchObject({ ok: false, code: -32012 });
});

it("cannot resurrect a subscription cancelled or deleted during callback verification", async () => {
  const f = await fixture();
  let resume!: () => void;

  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });

  const verification = vi.fn(() => gate);
  f.state.beforeVerification = verification;
  const pending = f.subscribe();
  await vi.waitFor(() => expect(verification).toHaveBeenCalled());
  await f.store.unsubscribeEvent(f.owner, f.params());
  await f.store.clear();
  resume();
  await expect(pending).rejects.toMatchObject({ code: -32012 });
  expect(await f.count("event_subscriptions")).toBe(0);
});

it("rechecks local revocation after awaiting upstream authorization", async () => {
  const f = await fixture();
  await f.subscribe();
  await f.push({ activities: [f.activity()] });
  let resume!: () => void;

  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });

  const authorization = vi.fn(() => gate);
  f.state.beforePermission = authorization;
  const pending = f.flush();
  await vi.waitFor(() => expect(authorization).toHaveBeenCalled());
  await f.store.revoke();
  resume();
  await pending;
  expect(f.deliveries).toHaveLength(0);
  expect(await f.count("event_occurrences")).toBe(0);
});

it("cleans expired subscriptions and pending bodies without requiring incoming requests", async () => {
  const f = await fixture();
  await f.subscribe();
  await f.push({ activities: [f.activity()] });
  await runInDurableObject(f.store, (_instance, context) =>
    context.storage.sql.exec("UPDATE event_subscriptions SET expires_at=0").toArray(),
  );
  await f.flush();
  expect(await f.count("event_subscriptions")).toBe(0);
  expect(await f.count("event_occurrences")).toBe(0);
  expect(f.deliveries).toHaveLength(0);
  expect(
    await runInDurableObject(f.store, (_instance, context) => context.storage.getAlarm()),
  ).toBeNull();
});

it("rejects unsupported modes, cursors, invalid filters and secrets, and failed callback verification", async () => {
  const f = await fixture();
  const params = f.params();

  for (const value of [
    { ...params, delivery: { ...params.delivery, mode: "stream" } },
    { ...params, cursor: "old" },
  ]) {
    await expect(f.subscribe(value)).rejects.toMatchObject({ code: -32014 });
  }

  for (const value of [
    { ...params, arguments: { userId: "another-account" } },
    { ...params, delivery: { ...params.delivery, secret: "whsec_short" } },
  ]) {
    await expect(f.subscribe(value)).rejects.toMatchObject({ code: -32602 });
  }

  await expect(f.subscribe({ ...params, name: "unknown" })).rejects.toMatchObject({ code: -32011 });
  f.state.invalidChallenge = true;
  await expect(f.subscribe()).rejects.toMatchObject({
    code: -32015,
    data: { reason: "challenge_failed" },
  });
  expect(await f.count("event_subscriptions")).toBe(0);
});

it("rejects local, IP-literal, credential-bearing, fragment and non-HTTPS callbacks", () => {
  for (const url of [
    "http://callback.example.com",
    "https://localhost/",
    "https://127.1/",
    "https://[::1]/",
    "https://10.0.0.1/",
    "https://service.internal/",
    "https://user:password@callback.example.com",
    "https://callback.example.com/#fragment",
  ]) {
    expect(() => callbackUrl(url)).toThrow("public HTTPS");
  }

  expect(callbackUrl("https://callback.example.com/events?subscription=1")).toBe(
    "https://callback.example.com/events?subscription=1",
  );
});

it("bounds callback verification work per Garmin account", async () => {
  const f = await fixture();
  // Keep the quota window fixed even if this test starts at a minute boundary.
  vi.spyOn(Date, "now").mockReturnValue(Date.now());

  for (let attempt = 0; attempt < 10; attempt++) {
    await f.subscribe();
  }

  await expect(f.subscribe()).rejects.toMatchObject({ code: -32013 });
  expect(await f.count("event_subscriptions")).toBe(1);
});
