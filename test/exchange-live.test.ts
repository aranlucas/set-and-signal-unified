import { readFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { expect, it } from "vitest";
import { z } from "zod";
import { schedulesResponse } from "../src/training/schemas";
import { required } from "./support";

// Opt-in only: prepare a dedicated confidential client and consented subject token in Auth.
// The private file stays outside the repository; only read-only Garmin tools are invoked.
const sessionSchema = z.object({
  base: z.literal("https://garmin-mcp.aranlucas.workers.dev"),
  issuer: z.literal("https://auth.aranlucas.workers.dev/api/auth"),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  subjectToken: z.string().min(1),
});

const exchangeGrant = "urn:ietf:params:oauth:grant-type:token-exchange";

const accessTokenType = "urn:ietf:params:oauth:token-type:access_token";

const exchangedTokens = z.object({
  access_token: z.string().min(1),
  issued_token_type: z.literal(accessTokenType),
  token_type: z.literal("Bearer"),
  scope: z.literal("garmin:access"),
  refresh_token: z.undefined().optional(),
  id_token: z.undefined().optional(),
});

it("exchanges a live Auth token and reads Garmin's workout calendar through MCP", async () => {
  const path = required(process.env.GARMIN_E2E_EXCHANGE_FILE, "GARMIN_E2E_EXCHANGE_FILE");
  const session = sessionSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const resource = `${session.base}/mcp`;

  const discovery = await fetch(`${session.issuer}/.well-known/oauth-authorization-server`, {
    redirect: "error",
  });

  expect(discovery.status).toBe(200);

  const metadata = z
    .object({
      issuer: z.literal(session.issuer),
      token_endpoint: z.literal(`${session.issuer}/oauth2/token`),
      jwks_uri: z.literal(`${session.issuer}/jwks`),
      grant_types_supported: z.array(z.string()),
    })
    .parse(await discovery.json());

  expect(metadata.grant_types_supported).toContain(exchangeGrant);

  const keys = createRemoteJWKSet(new URL(metadata.jwks_uri));

  const verification = {
    issuer: session.issuer,
    audience: resource,
    algorithms: ["RS256"],
    typ: "at+jwt",
    requiredClaims: ["sub", "exp", "iat"],
  };

  const subject = await jwtVerify(session.subjectToken, keys, verification);

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(session.clientId)}:${encodeURIComponent(session.clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: exchangeGrant,
      subject_token: session.subjectToken,
      subject_token_type: accessTokenType,
      resource,
      scope: "garmin:access",
    }),
  });

  expect(response.status).toBe(200);
  const tokens = exchangedTokens.parse(await response.json());
  const exchanged = await jwtVerify(tokens.access_token, keys, verification);
  expect(exchanged.payload.sub).toBe(subject.payload.sub);
  expect([exchanged.payload.aud].flat()).toEqual([resource]);
  expect(exchanged.payload.scope).toBe("garmin:access");
  expect(exchanged.payload.client_id).toBe(session.clientId);
  expect(exchanged.payload.sid).toBe(subject.payload.sid);
  expect(exchanged.payload.reference_id).toBe(subject.payload.reference_id);
  expect(exchanged.payload.exp).toBeLessThanOrEqual(subject.payload.exp ?? 0);

  const client = new Client({ name: "garmin-exchange-e2e", version: "1.0.0" });

  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      }),
    );
    const catalog = await client.listTools();
    expect(catalog.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["create_workout", "list_garmin_summaries", "get_garmin_summary"]),
    );

    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const calendar = await client.callTool({
      name: "list_workout_schedules",
      arguments: { startDate: date, endDate: date },
    });

    expect(calendar.isError).not.toBe(true);

    const result = z
      .object({ source: z.literal("Garmin Connect"), data: schedulesResponse })
      .parse(calendar.structuredContent);

    // Keep workout details private while recording the date and result count as test evidence.
    // oxlint-disable-next-line no-console -- Opt-in live-test evidence, without returned personal data.
    console.info(
      JSON.stringify({ tool: "list_workout_schedules", date, count: result.data.length }),
    );
  } finally {
    await client.close();
  }
});
