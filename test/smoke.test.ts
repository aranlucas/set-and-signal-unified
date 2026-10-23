import { createHash, randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import * as z from "zod";
import { required } from "./support";

const registeredClient = z.object({ client_id: z.string() });

const base = process.env.SMOKE_URL ?? "https://garmin-mcp.aranlucas.workers.dev";

const get = (path: string, init?: RequestInit) =>
  fetch(new URL(path, base), { ...init, redirect: "manual" });

it("serves health, setup page, protected MCP, and OAuth discovery", async () => {
  const health = await get("/health");
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok" });
  const landing = await get("/");
  expect(landing.status).toBe(200);
  expect(await landing.text()).toMatch(/Personal API key/);
  const challenge = await get("/mcp", { method: "POST" });
  expect(challenge.status).toBe(401);
  expect(challenge.headers.get("www-authenticate")).toMatch(/resource_metadata=/);
  expect(await (await get("/.well-known/oauth-protected-resource/mcp")).json()).toMatchObject({
    resource: `${base}/mcp`,
  });
  expect(await (await get("/.well-known/oauth-authorization-server")).json()).toMatchObject({
    code_challenge_methods_supported: ["S256"],
    authorization_endpoint: `${base}/authorize`,
  });
});

// Creates an expiring smoke-test OAuth client, never a Garmin grant.
it("registers a public client, binds consent to the browser, and redirects on deny", async () => {
  const registered = await get("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Deployment smoke test",
      redirect_uris: ["http://localhost:9876/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });

  expect(registered.status).toBe(201);
  const { client_id: clientId } = registeredClient.parse(await registered.json());
  const verifier = randomBytes(48).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "http://localhost:9876/callback",
    response_type: "code",
    scope: "garmin:read offline_access",
    state: "deployment-smoke",
    resource: `${base}/mcp`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });

  const consent = await get(`/authorize?${params}`);
  expect(consent.status).toBe(200);
  expect(consent.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
  expect(consent.headers.get("referrer-policy")).toBe("same-origin");
  const html = await consent.text();
  expect(html).toMatch(/Garmin Personal API key/);
  expect(html).toMatch(/localhost/);
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  expect(handle).toBeTruthy();

  const denied = await get("/authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: base,
      Cookie: required(
        required(consent.headers.get("set-cookie"), "consent cookie").split(";")[0],
        "consent cookie value",
      ),
    },
    body: new URLSearchParams({ handle: required(handle, "consent handle"), decision: "deny" }),
  });

  expect(denied.status).toBe(302);
  expect(
    new URL(required(denied.headers.get("location"), "deny redirect")).searchParams.get("error"),
  ).toBe("access_denied");
});
