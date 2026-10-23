import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { isTrainingPath } from "../src/training/auth";
import { TRAINING_BASE, TRAINING_TOKEN_URL, type TokenSet } from "../src/training/client";
import type { GarminJson } from "../src/garmin";
import worker from "../src/index";
import { requestUrl, required } from "./support";

const base = new URL(env.PUBLIC_URL).origin;

const issuer = `${base}/training`;

const resource = `${issuer}/mcp`;

const scope = "garmin:workouts:write";

const redirectUri = "http://localhost:9876/callback";

const verifier = "v".repeat(64);

const trainingEnv = {
  ...env,
  GARMIN_TRAINING_ENABLED: "true",
  GARMIN_TRAINING_CLIENT_ID: "test-training-client",
  GARMIN_TRAINING_CLIENT_SECRET: "test-only-training-client-secret",
};

const outbound = vi.fn<typeof fetch>();

type TokenPair = { access_token: string; refresh_token: string; expires_in: number };

type RegisteredClient = { client_id: string };

type StoredGrant = { expiresAt: number };

type SeedOptions = { audience?: string; scopes?: string[] };

const accessSnapshot = z
  .object({
    kind: z.literal("garmin-training"),
    tokens: z.object({ accessToken: z.string(), accessTokenExpiresAt: z.number() }).strict(),
  })
  .strict();

async function dispatch(
  path: string,
  init?: RequestInit,
  bindings: Env = trainingEnv,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(new URL(path, base), init), bindings, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

function tokenBody(clientId: string, code: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    resource,
    code_verifier: verifier,
  });
}

function exchange(clientId: string, code: string): Promise<Response> {
  return dispatch("/training/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody(clientId, code),
  });
}

function refresh(clientId: string, token: string): Promise<Response> {
  return dispatch("/training/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: token,
      resource,
    }),
  });
}

async function challenge(value: string): Promise<string> {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("base64url");
}

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

function location(response: Response): URL {
  return new URL(required(response.headers.get("Location"), "redirect location"));
}

function upstreamState(url: URL): string {
  return required(url.searchParams.get("state"), "upstream state");
}

function submittedForm(index: number): URLSearchParams {
  const body = outbound.mock.calls[index]?.[1]?.body;

  if (!(body instanceof URLSearchParams)) {
    throw new TypeError("Expected an outbound form body");
  }

  return body;
}

async function startConsent(clientName = "Training assistant") {
  const registration = await dispatch("/training/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });

  expect(registration.status).toBe(201);
  const { client_id: clientId } = await registration.json<RegisteredClient>();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${scope} offline_access`,
    state: "assistant-state",
    resource,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  });

  const response = await dispatch(`/training/authorize?${params}`);
  expect(response.status).toBe(200);
  const body = await response.text();
  const handle = required(body.match(/name="handle" value="([^"]+)"/)?.[1], "consent handle");

  return { clientId, handle, cookie: cookies(response), response, body };
}

async function startUpstream() {
  const consent = await startConsent();

  const response = await dispatch("/training/authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: base,
      Cookie: consent.cookie,
    },
    body: new URLSearchParams({ handle: consent.handle, decision: "approve" }),
  });

  expect(response.status).toBe(302);

  return { ...consent, response, upstream: location(response), upstreamCookie: cookies(response) };
}

function upstreamTokens(
  access = "upstream-access",
  refreshToken = "upstream-refresh",
  expiresIn = 7200,
  refreshExpiresIn = 86_400,
) {
  return {
    access_token: access,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_token_expires_in: refreshExpiresIn,
  };
}

function mockCallback(permissions = ["WORKOUT_IMPORT"], expiresIn = 7200) {
  outbound.mockResolvedValueOnce(
    Response.json(upstreamTokens("upstream-access", "upstream-refresh", expiresIn)),
  );
  outbound.mockResolvedValueOnce(Response.json(permissions));

  if (permissions.includes("WORKOUT_IMPORT")) {
    outbound.mockResolvedValueOnce(Response.json({ userId: "user:with:separator" }));
  }
}

async function connect(expiresIn = 7200) {
  const started = await startUpstream();
  mockCallback(["WORKOUT_IMPORT"], expiresIn);

  const response = await dispatch(
    `/training/callback?${new URLSearchParams({
      code: "garmin-code",
      state: required(started.upstream.searchParams.get("state"), "upstream state"),
    })}`,
    { headers: { Cookie: started.upstreamCookie } },
  );

  expect(response.status).toBe(302);
  const code = required(location(response).searchParams.get("code"), "MCP authorization code");

  return { ...started, code, callback: response };
}

/** Use the installed library to create encrypted grants, including deliberately invalid app props. */
async function seedGrant(props: GarminJson, options: SeedOptions = {}) {
  const audience = options.audience ?? resource;
  const scopes = options.scopes ?? [scope, "offline_access"];

  const server = new OAuthAuthorizationServer<Env>({
    issuer,
    resources: [audience],
    clientRegistrationEndpoint: "/training/oauth/register",
    scopesSupported: [scope, "offline_access", "garmin:read"],
    accessTokenTTL: 3600,
    refreshTokenTTL: 86_400,
  });

  const oauth = server.getOAuthApi(trainingEnv);

  const client = await oauth.createClient({
    clientName: "Seed assistant",
    redirectUris: [redirectUri],
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
  });

  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    resource: audience,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  });

  const authRequest = await oauth.parseAuthRequest(new Request(`${issuer}/authorize?${params}`));

  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    userId: `test-${crypto.randomUUID()}`,
    metadata: {},
    scope: scopes,
    props,
  });

  const code = required(new URL(redirectTo).searchParams.get("code"), "seed code");

  return {
    clientId: client.clientId,
    code,
    async exchangeRaw() {
      const ctx = createExecutionContext();
      const body = tokenBody(client.clientId, code);
      body.set("resource", audience);

      const response = await server.fetch(
        new Request(`${issuer}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        }),
        trainingEnv,
        ctx,
      );

      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(200);

      return response.json<TokenPair>();
    },
  };
}

function grant(tokens: Partial<TokenSet> = {}) {
  return {
    kind: "garmin-training",
    tokens: {
      accessToken: "seed-access",
      refreshToken: "seed-refresh",
      accessTokenExpiresAt: Date.now() + 7200_000,
      refreshTokenExpiresAt: Date.now() + 86_400_000,
      ...tokens,
    },
  };
}

beforeEach(() => {
  outbound.mockReset();
  outbound.mockRejectedValue(new Error("Unexpected outbound fetch"));
  vi.stubGlobal("fetch", outbound);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Training routing and configuration", () => {
  it("matches only the training namespace and its exact discovery paths", () => {
    for (const path of [
      "/training",
      "/training/",
      "/training/mcp",
      "/training/callback",
      "/.well-known/oauth-authorization-server/training",
      "/.well-known/oauth-protected-resource/training/mcp",
    ]) {
      expect(isTrainingPath(path)).toBe(true);
    }

    for (const path of [
      "/mcp",
      "/trainings",
      "/training-other",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/training/",
      "/.well-known/oauth-protected-resource/training/mcp/extra",
    ]) {
      expect(isTrainingPath(path)).toBe(false);
    }
  });

  it("keeps every route disabled without a literal true flag and performs no I/O", async () => {
    const kvGet = vi.spyOn(env.OAUTH_KV, "get");
    const kvPut = vi.spyOn(env.OAUTH_KV, "put");

    await Promise.all(
      ["false", "TRUE", "1", " true", ""].map(async (flag) => {
        await Promise.all(
          [
            "/training",
            "/training/authorize",
            "/training/callback?state=bad",
            "/training/mcp",
            "/training/oauth/register",
            "/.well-known/oauth-authorization-server/training",
            "/.well-known/oauth-protected-resource/training/mcp",
          ].map(async (path) => {
            const response = await dispatch(path, undefined, {
              ...env,
              GARMIN_TRAINING_ENABLED: flag,
            });

            expect(response.status).toBe(404);
            expect(response.headers.has("Set-Cookie")).toBe(false);
          }),
        );
      }),
    );

    expect(kvGet).not.toHaveBeenCalled();
    expect(kvPut).not.toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  });

  it("returns a sanitized 503 when enabled credentials are missing", async () => {
    await Promise.all(
      [
        { ...env, GARMIN_TRAINING_ENABLED: "true" },
        { ...trainingEnv, GARMIN_TRAINING_CLIENT_ID: "" },
        { ...trainingEnv, GARMIN_TRAINING_CLIENT_SECRET: " " },
      ].map(async (bindings) => {
        const response = await dispatch(
          "/.well-known/oauth-authorization-server/training",
          undefined,
          bindings,
        );

        expect(response.status).toBe(503);
        expect(await response.text()).toBe('{"error":"Garmin training is unavailable"}');
      }),
    );

    expect(outbound).not.toHaveBeenCalled();
  });

  it("publishes a separate issuer, resource and required write scope", async () => {
    const metadata = await dispatch("/.well-known/oauth-authorization-server/training");
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      scopes_supported: [scope, "offline_access"],
      protected_resources: [resource],
    });
    const protectedMetadata = await dispatch("/.well-known/oauth-protected-resource/training/mcp");
    expect(await protectedMetadata.json()).toMatchObject({
      resource,
      authorization_servers: [issuer],
      scopes_supported: [scope],
    });
    const unauthenticated = await dispatch("/training/mcp", { method: "POST" });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("WWW-Authenticate")).toContain(
      "oauth-protected-resource/training/mcp",
    );
    expect(unauthenticated.headers.get("WWW-Authenticate")).toContain(scope);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("shows training setup and accurate storage and revocation guidance", async () => {
    const home = await (await dispatch("/training")).text();
    expect(home).toContain(resource);
    expect(home).toContain("create workouts");
    expect(home).toContain("Workout Import");
    expect(home).not.toContain("Read only");
    const privacy = await (await dispatch("/training/privacy")).text();
    expect(privacy).toContain("encrypted");
    expect(privacy).toContain("Connected Apps");
    expect(privacy).toContain("does not disconnect the app at Garmin");
    expect(outbound).not.toHaveBeenCalled();
  });
});

describe("Training JSX rendering", () => {
  it.each(["/training", "/training/privacy", "/training/authorize"])(
    "renders %s through the shared renderer and security policy",
    async (path) => {
      const response = await dispatch(path);
      const body = await response.text();

      expect(body).toMatch(/^<!doctype html>/i);
      expect(body.match(/<!doctype html>/gi)).toHaveLength(1);
      expect(body).toContain("· Garmin Training MCP</title>");
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Security-Policy")).toContain("form-action 'self';");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    },
  );

  it("keeps Training consent cookies and redirect permissions out of later page responses", async () => {
    await startConsent();

    await Promise.all(
      ["/training", "/training/privacy", "/"].map(async (path) => {
        const response = await dispatch(path);

        expect(response.headers.get("Set-Cookie")).toBeNull();
        expect(response.headers.get("Content-Security-Policy")).toContain("form-action 'self';");
        expect(response.headers.get("Content-Security-Policy")).not.toContain("connect.garmin.com");
        expect(response.headers.get("Content-Security-Policy")).not.toContain("localhost:9876");
      }),
    );
  });
});

describe("Training browser authorization", () => {
  it("escapes per-client consent and permits the browser redirect to Garmin", async () => {
    const consent = await startConsent("<script>untrusted</script>");
    expect(consent.body).not.toContain("<script>");
    expect(consent.body).toContain("&lt;script&gt;");
    expect(consent.body).toContain("localhost");
    expect(consent.body).toContain("app on your computer");
    expect(consent.body).toContain(scope);
    expect(consent.cookie).toMatch(/^__Host-garmin-training-/);
    expect(consent.response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(consent.response.headers.get("Content-Security-Policy")).toContain(
      "https://connect.garmin.com",
    );
    expect(consent.response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(outbound).not.toHaveBeenCalled();
  });

  it("rejects forged origins, media types, missing cookies and oversized forms before Garmin", async () => {
    const consent = await startConsent();
    const body = new URLSearchParams({ handle: consent.handle, decision: "approve" });

    await Promise.all(
      ["https://evil.example", "null", ""].map(async (origin) => {
        expect(
          (
            await dispatch("/training/authorize", {
              method: "POST",
              headers: {
                Origin: origin,
                Cookie: consent.cookie,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body,
            })
          ).status,
        ).toBe(403);
      }),
    );

    expect(
      (
        await dispatch("/training/authorize", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await dispatch("/training/authorize", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded" },
          body,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await dispatch("/training/authorize", {
          method: "POST",
          headers: {
            Origin: base,
            Cookie: consent.cookie,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `handle=${consent.handle}&padding=${"x".repeat(16 * 1024)}`,
        })
      ).status,
    ).toBe(413);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("denies a client without starting Garmin authorization", async () => {
    const consent = await startConsent();

    const response = await dispatch("/training/authorize", {
      method: "POST",
      headers: {
        Origin: base,
        Cookie: consent.cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ handle: consent.handle, decision: "deny" }),
    });

    expect(response.status).toBe(302);
    expect(location(response).searchParams.get("error")).toBe("access_denied");
    expect(location(response).searchParams.get("state")).toBe("assistant-state");
    expect(location(response).searchParams.get("iss")).toBe(issuer);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("uses browser-bound upstream state and PKCE, then exchanges without leaking credentials", async () => {
    const connection = await connect();
    expect(connection.upstream.origin + connection.upstream.pathname).toBe(
      "https://connect.garmin.com/oauth2Confirm",
    );
    expect(connection.upstream.searchParams.get("client_id")).toBe(
      trainingEnv.GARMIN_TRAINING_CLIENT_ID,
    );
    expect(connection.upstream.searchParams.get("redirect_uri")).toBe(`${issuer}/callback`);
    expect(connection.upstream.searchParams.get("code_challenge_method")).toBe("S256");
    expect(requestUrl(required(outbound.mock.calls[0], "token call")[0])).toBe(TRAINING_TOKEN_URL);
    const submitted = submittedForm(0);
    expect(await challenge(required(submitted.get("code_verifier"), "upstream verifier"))).toBe(
      connection.upstream.searchParams.get("code_challenge"),
    );
    expect(submitted.get("redirect_uri")).toBe(`${issuer}/callback`);
    expect(submitted.get("client_secret")).toBe(trainingEnv.GARMIN_TRAINING_CLIENT_SECRET);
    expect(requestUrl(required(outbound.mock.calls[1], "permissions call")[0])).toBe(
      `${TRAINING_BASE}/wellness-api/rest/user/permissions`,
    );
    expect(requestUrl(required(outbound.mock.calls[2], "identity call")[0])).toBe(
      `${TRAINING_BASE}/wellness-api/rest/user/id`,
    );
    const response = await exchange(connection.clientId, connection.code);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("upstream-access");
    expect(text).not.toContain("upstream-refresh");
    expect(text).not.toContain(trainingEnv.GARMIN_TRAINING_CLIENT_SECRET);
    expect(JSON.parse(text)).toMatchObject({ expires_in: 3600, scope: `${scope} offline_access` });
    expect(outbound).toHaveBeenCalledTimes(3);
  });

  it("rejects missing callback binding and replayed upstream state", async () => {
    const started = await startUpstream();
    const path = `/training/callback?code=garmin-code&state=${upstreamState(started.upstream)}`;
    expect((await dispatch(path)).status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
    mockCallback();
    expect((await dispatch(path, { headers: { Cookie: started.upstreamCookie } })).status).toBe(
      302,
    );
    expect((await dispatch(path, { headers: { Cookie: started.upstreamCookie } })).status).toBe(
      400,
    );
    expect(outbound).toHaveBeenCalledTimes(3);
  });

  it("redirects an upstream denial with the original client state and issuer", async () => {
    const started = await startUpstream();

    const response = await dispatch(
      `/training/callback?error=access_denied&state=${upstreamState(started.upstream)}`,
      { headers: { Cookie: started.upstreamCookie } },
    );

    expect(response.status).toBe(302);
    expect(location(response).searchParams.get("error")).toBe("access_denied");
    expect(location(response).searchParams.get("state")).toBe("assistant-state");
    expect(location(response).searchParams.get("iss")).toBe(issuer);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("refuses to grant access without Garmin Workout Import permission", async () => {
    const started = await startUpstream();
    mockCallback(["HEALTH_EXPORT"]);

    const response = await dispatch(
      `/training/callback?code=garmin-code&state=${upstreamState(started.upstream)}`,
      { headers: { Cookie: started.upstreamCookie } },
    );

    expect(response.status).toBe(302);
    expect(location(response).searchParams.get("error")).toBe("access_denied");
    expect(location(response).searchParams.has("code")).toBe(false);
    expect(outbound).toHaveBeenCalledTimes(2);
  });
});

describe("Training token lifecycle and isolation", () => {
  it("bounds MCP lifetime by Garmin expiry minus ten minutes and upstream refresh expiry", async () => {
    const connection = await connect(1800);
    const response = await exchange(connection.clientId, connection.code);
    expect(response.status).toBe(200);
    const tokens = await response.json<TokenPair>();
    expect(tokens.expires_in).toBeGreaterThanOrEqual(1198);
    expect(tokens.expires_in).toBeLessThanOrEqual(1200);
    const [userId, grantId] = tokens.refresh_token.split(":");

    const stored = await env.OAUTH_KV.get<StoredGrant>(
      `grant:${required(userId, "token user")}:${required(grantId, "token grant")}`,
      "json",
    );

    expect(required(stored, "stored grant").expiresAt).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 86_400,
    );
    expect(outbound).toHaveBeenCalledTimes(3);
  });

  it("refreshes MCP tokens without calling Garmin while the upstream access token is healthy", async () => {
    const seeded = await seedGrant(grant());
    const original = await seeded.exchangeRaw();
    const response = await refresh(seeded.clientId, original.refresh_token);
    expect(response.status).toBe(200);
    const renewed = await response.json<TokenPair>();
    expect(renewed.access_token).not.toBe(original.access_token);
    const validator = new OAuthAuthorizationServer<Env>({ issuer, resources: [resource] });

    const validated = await validator.validateToken<unknown>(
      resource,
      renewed.access_token,
      trainingEnv,
    );

    const snapshot = accessSnapshot.parse(required(validated, "validated access token").props);
    expect(snapshot.tokens.accessToken).toBe("seed-access");
    expect(outbound).not.toHaveBeenCalled();
  });

  it("refreshes near-expiry Garmin tokens and persists the rotated refresh credential", async () => {
    const now = Date.now();
    const time = vi.spyOn(Date, "now").mockReturnValue(now);
    const seeded = await seedGrant(grant({ accessTokenExpiresAt: now + 60_000 }));
    const original = await seeded.exchangeRaw();
    outbound.mockResolvedValueOnce(
      Response.json(upstreamTokens("rotated-access", "rotated-refresh", 7200)),
    );
    const first = await refresh(seeded.clientId, original.refresh_token);
    expect(first.status).toBe(200);
    const firstTokens = await first.json<TokenPair>();
    expect(submittedForm(0).get("refresh_token")).toBe("seed-refresh");
    time.mockReturnValue(now + 7000_000);
    outbound.mockResolvedValueOnce(
      Response.json(upstreamTokens("second-access", "second-refresh")),
    );
    const second = await refresh(seeded.clientId, firstTokens.refresh_token);
    expect(second.status).toBe(200);
    expect(submittedForm(1).get("refresh_token")).toBe("rotated-refresh");
    expect(outbound).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403])(
    "revokes a terminal upstream refresh failure (%s) without leaking its body",
    async (status) => {
      const seeded = await seedGrant(grant({ accessTokenExpiresAt: Date.now() - 1000 }));
      const original = await seeded.exchangeRaw();
      outbound.mockResolvedValueOnce(
        Response.json({ secret: "private-upstream-error" }, { status }),
      );
      const failed = await refresh(seeded.clientId, original.refresh_token);
      expect(failed.status).toBe(400);
      expect(await failed.json()).toMatchObject({ error: "invalid_grant" });
      const retry = await refresh(seeded.clientId, original.refresh_token);
      expect(retry.status).toBe(400);
      expect(outbound).toHaveBeenCalledTimes(1);
    },
  );

  it.each([429, 503])(
    "preserves the grant on transient upstream failure (%s) and allows retry",
    async (status) => {
      const seeded = await seedGrant(grant({ accessTokenExpiresAt: Date.now() - 1000 }));
      const original = await seeded.exchangeRaw();
      outbound.mockResolvedValueOnce(
        Response.json({ secret: "private-upstream-error" }, { status }),
      );
      const failed = await refresh(seeded.clientId, original.refresh_token);
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({
        error: "temporarily_unavailable",
        error_description: "Garmin training is temporarily unavailable. Try again shortly.",
      });
      outbound.mockResolvedValueOnce(Response.json(upstreamTokens()));
      expect((await refresh(seeded.clientId, original.refresh_token)).status).toBe(200);
      expect(outbound).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects malformed, foreign and expired grant credentials at code exchange", async () => {
    await Promise.all(
      [
        { apiKey: "personal-key" },
        { ...grant(), kind: "personal" },
        grant({ accessToken: "" }),
        grant({ accessTokenExpiresAt: Date.now() - 1 }),
        grant({ refreshTokenExpiresAt: Date.now() - 1 }),
      ].map(async (props) => {
        const seeded = await seedGrant(props);
        const response = await exchange(seeded.clientId, seeded.code);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: "invalid_grant" });
      }),
    );

    expect(outbound).not.toHaveBeenCalled();
  });

  it("rejects expired or malformed upstream credentials before starting MCP", async () => {
    await Promise.all(
      [grant({ accessTokenExpiresAt: Date.now() - 1 }), { apiKey: "personal-key" }].map(
        async (props) => {
          const seeded = await seedGrant(props);
          const tokens = await seeded.exchangeRaw();

          const response = await dispatch("/training/mcp", {
            method: "POST",
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });

          expect(response.status).toBe(401);
          expect(response.headers.get("WWW-Authenticate")).toContain("invalid_token");
        },
      ),
    );

    expect(outbound).not.toHaveBeenCalled();
  });

  it("requires the write scope even for tokens bound to the training audience", async () => {
    const seeded = await seedGrant(grant(), { scopes: ["garmin:read"] });
    const tokens = await seeded.exchangeRaw();

    const response = await dispatch("/training/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain(scope);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("rejects Personal tokens at Training and Training tokens at Personal in the shared KV", async () => {
    const personal = await seedGrant(
      { apiKey: "personal-key" },
      { audience: `${base}/mcp`, scopes: ["garmin:read"] },
    );

    const personalTokens = await personal.exchangeRaw();
    expect(
      (
        await dispatch("/training/mcp", {
          method: "POST",
          headers: { Authorization: `Bearer ${personalTokens.access_token}` },
        })
      ).status,
    ).toBe(401);
    const training = await seedGrant(grant());
    const trainingTokens = await training.exchangeRaw();
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      new Request(`${base}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${trainingTokens.access_token}` },
      }),
      trainingEnv,
      ctx,
    );

    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(outbound).not.toHaveBeenCalled();
  });
});
