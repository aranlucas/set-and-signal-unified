/* oxlint-disable no-await-in-loop -- Each invalid token is verified separately to identify the failing policy. */
import type { z } from "zod";
import type { garminCredential } from "../src/auth";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { userStore } from "../src/push/store";
import worker from "../src/index";
import { requestUrl } from "./support";

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

it("accepts and durably stores Garmin delivery through the HTTP router", async () => {
  const id = crypto.randomUUID();

  const response = await send(`/garmin/push/${env.GARMIN_PUSH_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dailies: [{ userId: id, summaryId: "http-push", calendarDate: "2026-10-23", steps: 321 }],
    }),
  });

  expect(response.status).toBe(200);
  expect(await userStore(env, id).get("dailies", "http-push")).toContain('"steps":321');
});
