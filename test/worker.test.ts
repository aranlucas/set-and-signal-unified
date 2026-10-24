/* oxlint-disable no-await-in-loop -- Each invalid token is verified separately to identify the failing policy. */
import { z } from "zod";
import type { garminCredential } from "../src/auth";
import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { beforeAll, afterEach, expect, it, onTestFinished, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { userStore } from "../src/push/store";
import worker from "../src/index";
import { requestUrl } from "./support";
import { receivePush } from "../src/push/handler";

const base = env.PUBLIC_URL;

let privateKey: CryptoKey;

let jwk: object;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwk = await exportJWK(pair.publicKey);
});

afterEach(() => vi.unstubAllGlobals());

const jwt = () =>
  new SignJWT({ scope: "garmin:access" })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setSubject("auth-alice")
    .setIssuer(env.AUTH_ISSUER)
    .setAudience(`${base}/mcp`)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey);

function bindings(token: z.infer<typeof garminCredential> | null) {
  return {
    ...env,
    AUTH: {
      fetch: env.AUTH.fetch.bind(env.AUTH),
      connect: env.AUTH.connect.bind(env.AUTH),
      accessToken: vi.fn().mockResolvedValue(token),
    },
  };
}

async function send(path: string, init?: RequestInit, config = env) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(base + path, init), config, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

it("advertises shared Auth and rejects unauthenticated, legacy-key and retired issuer access", async () => {
  const metadata = await (await send("/.well-known/oauth-protected-resource/mcp")).json();
  expect(metadata).toMatchObject({
    authorization_servers: [env.AUTH_ISSUER],
    scopes_supported: ["garmin:access"],
  });

  for (const init of [{}, { headers: { Authorization: "Bearer old-personal-key" } }]) {
    const r = await send("/mcp", init);
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
  }

  for (const path of [
    "/authorize",
    "/oauth/token",
    "/oauth/register",
    "/training/mcp",
    "/training/oauth/token",
  ]) {
    expect((await send(path)).status).toBe(404);
  }
});

it("verifies signed Auth tokens and serves the merged catalog over actual MCP HTTP", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      if (requestUrl(input) === "https://apis.garmin.com/partner-gateway/rest/user/permissions") {
        return Promise.resolve(
          Response.json({ permissions: ["ACTIVITY_EXPORT", "HEALTH_EXPORT"] }),
        );
      }

      expect(requestUrl(input)).toBe(`${env.AUTH_ISSUER}/jwks`);

      return Promise.resolve(
        Response.json({ keys: [{ ...jwk, kid: "fixture", alg: "RS256", use: "sig" }] }),
      );
    }),
  );

  const config = bindings({
    accessToken: "private-garmin-token",
    expiresAt: Date.now() + 3600000,
    garminUserId: "garmin-alice",
  });

  const r = await send(
    "/mcp",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await jwt()}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    },
    config,
  );

  expect(r.status).toBe(200);
  const text = await r.text();
  expect(text).toContain('"create_workout"');
  expect(text).toContain('"list_garmin_summaries"');
  expect(text).not.toContain("private-garmin-token");
  expect(text).not.toContain('"get_profile"');

  const discovered = await send(
    "/mcp",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await jwt()}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "server/discover",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "server/discover",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "event-client", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    },
    config,
  );

  const discoveredText = await discovered.text();
  expect(discovered.status, discoveredText).toBe(200);
  expect(discoveredText).toContain('"events":{}');
  expect(JSON.parse(discoveredText)).toMatchObject({
    result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: { events: {} },
    },
  });

  const catalog = await send(
    "/mcp",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await jwt()}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "events/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "events/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "event-client", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    },
    config,
  );

  expect(catalog.status).toBe(200);
  const catalogText = await catalog.text();
  expect(catalogText).toContain("garmin.activity.completed");
  expect(catalogText).toContain("garmin.sleep.available");
  expect(catalogText).not.toContain("private-garmin-token");
});

it.each([
  { name: "Garmin audience and scope", fields: {}, status: 200 },
  {
    name: "another Auth resource's audience",
    fields: { aud: "https://auth.aranlucas.workers.dev" },
    status: 401,
  },
  { name: "missing Garmin scope", fields: { scope: "email" }, status: 401 },
  { name: "wrong issuer", fields: { iss: "https://other.example" }, status: 401 },
  { name: "expired subject lifetime", fields: { exp: 1 }, status: 401 },
])("checks Auth exchange-shaped tokens with $name", async ({ fields, status }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(Response.json({ keys: [{ ...jwk, kid: "fixture", alg: "RS256" }] })),
    ),
  );

  const config = bindings({
    accessToken: "private-garmin-token",
    expiresAt: Date.now() + 3600000,
    garminUserId: "garmin-alice",
  });

  // Match Auth's RFC 8693 output; the real exchange and its consent checks live in Auth.
  const token = await new SignJWT({
    sub: "auth-alice",
    iss: config.AUTH_ISSUER,
    aud: `${base}/mcp`,
    scope: "garmin:access",
    client_id: "exchange-service",
    sid: "subject-session",
    reference_id: "subject-reference",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    ...fields,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fixture", typ: "at+jwt" })
    .sign(privateKey);

  const response = await send(
    "/mcp",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    },
    config,
  );

  expect(response.status).toBe(status);
  expect(config.AUTH.accessToken.mock.calls).toEqual(status === 200 ? [["auth-alice"]] : []);
  expect((await response.text()).includes('"list_garmin_summaries"')).toBe(status === 200);
});

it("fails closed for wrong audience, issuer, scope, expiry and disconnected accounts", async () => {
  const config = bindings(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(Response.json({ keys: [{ ...jwk, kid: "fixture", alg: "RS256" }] })),
    ),
  );

  for (const fields of [
    { aud: "https://other.example/mcp" },
    { iss: "https://other.example" },
    { scope: "mcp:tools" },
    { exp: 1 },
    {},
  ]) {
    const token = await new SignJWT({
      sub: "auth-alice",
      scope: "garmin:access",
      iss: config.AUTH_ISSUER,
      aud: `${base}/mcp`,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
      ...fields,
    })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .sign(privateKey);

    expect(
      (await send("/mcp", { headers: { Authorization: `Bearer ${token}` } }, config)).status,
    ).toBe(401);
  }
});

it.each([
  "/webhook/garmin",
  "/webhook/garmin/wrong",
  `/webhook/garmin?${new URLSearchParams({ token: env.GARMIN_PUSH_TOKEN })}`,
])("rejects Garmin delivery without a valid path credential at %s", async (path) => {
  const id = crypto.randomUUID();

  const response = await send(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "garmin-client-id": "public-client-id",
    },
    body: JSON.stringify({
      dailies: [{ userId: id, summaryId: "rejected-push", calendarDate: "2026-10-23" }],
    }),
  });

  expect(response.status).toBe(404);
  expect(await userStore(env, id).get("dailies", "rejected-push")).toBeNull();
});

it("has one keyless setup with honest retention and AI consent details", async () => {
  const home = await (await send("/")).text();
  expect(home).toContain("Sign in with Auth");
  expect(home).not.toContain("Create your Garmin key");
  const privacy = await (await send("/privacy")).text();
  expect(privacy).toContain("retained until you delete them or disconnect Garmin");
  expect(privacy).not.toContain("90 days");
  expect(privacy).toContain("train, evaluate, or improve AI models");
  expect(privacy).toContain("Auth connected accounts");
});

it.each([`/webhook/garmin/${env.GARMIN_PUSH_TOKEN}`, `/garmin/push/${env.GARMIN_PUSH_TOKEN}`])(
  "accepts and durably stores Garmin delivery at %s",
  async (path) => {
    const id = crypto.randomUUID();

    const response = await send(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailies: [{ userId: id, summaryId: "http-push", calendarDate: "2026-10-23", steps: 321 }],
      }),
    });

    expect(response.status).toBe(200);
    expect(await userStore(env, id).get("dailies", "http-push")).toContain('"steps":321');
  },
);

it("verifies the OpenAI Events HTTP subscribe, signed delivery, refresh, and unsubscribe lifecycle", async () => {
  const signingSecret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
  const callback = "https://callback.example.com/http-events";
  const accountId = "auth-alice";
  const store = userStore(env, accountId);
  const delivered: object[] = [];
  let verifications = 0;

  const config = bindings({
    accessToken: "private-http-token",
    expiresAt: Date.now() + 60000,
    garminUserId: accountId,
  });

  const token = await jwt();
  onTestFinished(() => store.clear());

  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation((input, init) => {
      const url = requestUrl(input);

      if (url === `${env.AUTH_ISSUER}/jwks`) {
        return Promise.resolve(Response.json({ keys: [{ ...jwk, kid: "fixture", alg: "RS256" }] }));
      }

      if (url === "https://apis.garmin.com/partner-gateway/rest/user/permissions") {
        return Promise.resolve(
          Response.json({ permissions: ["ACTIVITY_EXPORT", "HEALTH_EXPORT"] }),
        );
      }

      if (url !== callback) {
        throw new Error("Unexpected HTTP destination");
      }

      const headers = Object.fromEntries(new Headers(init?.headers));
      const body = z.string().parse(init?.body);
      const data = new Webhook(signingSecret).verify(body, headers);

      const verification = z
        .object({ type: z.literal("verification"), challenge: z.string() })
        .safeParse(data);

      if (verification.success) {
        verifications++;

        return Promise.resolve(Response.json({ challenge: verification.data.challenge }));
      }

      const event = z
        .object({
          eventId: z.string(),
          name: z.literal("garmin.activity.completed"),
          timestamp: z.iso.datetime(),
          data: z.object({ summaryId: z.string(), activityType: z.literal("RUNNING") }),
          cursor: z.null(),
        })
        .parse(data);

      delivered.push(event);

      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );

  function eventRequest(
    method: string,
    params: Record<string, z.infer<ReturnType<typeof z.json>>>,
  ) {
    return send(
      "/mcp",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": method,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {
                name: "openai-profile-fixture",
                version: "1.0.0",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      },
      config,
    );
  }

  const params = {
    name: "garmin.activity.completed",
    arguments: { activityTypes: ["RUNNING"], minDurationSeconds: 600 },
    delivery: { mode: "webhook", url: callback, secret: signingSecret },
    cursor: null,
  };

  const subscription = await eventRequest("events/subscribe", params);

  const parsed = z
    .object({
      result: z.object({
        id: z.string(),
        refreshBefore: z.iso.datetime(),
        cursor: z.null(),
        truncated: z.literal(false),
      }),
    })
    .parse(await subscription.json());

  expect(subscription.status).toBe(200);
  expect(verifications).toBe(1);
  const refresh = await eventRequest("events/subscribe", params);
  expect(await refresh.json()).toMatchObject({
    result: { id: parsed.result.id, cursor: null, truncated: false },
  });
  expect(verifications).toBe(1);

  const push = (summaryId: string, activityType: string) =>
    receivePush(
      new Request("https://receiver.example.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activities: [
            {
              userId: accountId,
              summaryId,
              calendarDate: "2026-10-24",
              activityType,
              durationInSeconds: 1800,
            },
          ],
        }),
      }),
      env,
      env.GARMIN_PUSH_TOKEN,
    );

  await push("http-run", "RUNNING");
  await push("http-ride", "CYCLING");
  await runInDurableObject(store, (_instance, context) =>
    context.storage.sql.exec("UPDATE event_deliveries SET next_at=0").toArray(),
  );
  await runDurableObjectAlarm(store);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toMatchObject({ data: { summaryId: "http-run" } });

  const stopped = await eventRequest("events/unsubscribe", {
    name: params.name,
    arguments: params.arguments,
    delivery: { mode: "webhook", url: callback },
  });

  expect(await stopped.json()).toMatchObject({ result: {} });

  const repeated = await eventRequest("events/unsubscribe", {
    name: params.name,
    arguments: params.arguments,
    delivery: { url: callback },
  });

  expect(await repeated.json()).toMatchObject({ result: {} });
  await push("after-unsubscribe", "RUNNING");
  expect(await runDurableObjectAlarm(store)).toBe(false);
  expect(delivered).toHaveLength(1);
});
