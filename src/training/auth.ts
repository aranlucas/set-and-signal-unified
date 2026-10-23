import {
  AuthorizationError,
  authorizationErrorRedirect,
  CimdFetchError,
  GrantType,
  insufficientScope,
  OAuthAuthorizationServer,
  OAuthError,
  OAuthResourceServer,
  type ConsentDescription,
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod";
import { consentFormAction, html } from "../auth";
import { readBounded } from "../garmin";
import { GarminError } from "../garmin-error";
import { escape } from "../pages";
import {
  exchangeTrainingCode,
  refreshTrainingToken,
  tokenSet,
  TrainingClient,
  TrainingError,
} from "./client";
import { createTrainingServer } from "./mcp";

const WRITE_SCOPE = "garmin:workouts:write";

const REFRESH_TTL = 30 * 24 * 3600;

const EXPIRY_MARGIN = 600;

const GARMIN_AUTHORIZE = "https://connect.garmin.com/oauth2Confirm";

const enabled = z.object({ GARMIN_TRAINING_ENABLED: z.literal("true") });

const credentials = z.object({
  GARMIN_TRAINING_CLIENT_ID: z.string().trim().min(1),
  GARMIN_TRAINING_CLIENT_SECRET: z.string().trim().min(1),
});

const grantProps = z.object({ kind: z.literal("garmin-training"), tokens: tokenSet });

const accessProps = z.object({
  kind: z.literal("garmin-training"),
  tokens: tokenSet.pick({ accessToken: true, accessTokenExpiresAt: true }),
});

const upstreamData = z.object({ verifier: z.string().min(43).max(128) });

export function isTrainingPath(path: string): boolean {
  return (
    path === "/training" ||
    path.startsWith("/training/") ||
    path === "/.well-known/oauth-authorization-server/training" ||
    path === "/.well-known/oauth-protected-resource/training/mcp"
  );
}

function trainingPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Garmin Training MCP</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f4f4;color:#182f31;font:16px/1.6 system-ui,sans-serif}main{max-width:680px;margin:8vh auto;padding:36px;background:#fff;border:1px solid #d7e2e1;border-radius:16px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:#536f70}h1{font-size:34px;line-height:1.15;letter-spacing:-.04em}a{color:#006b65}code{background:#edf3f2;overflow-wrap:anywhere;padding:3px 6px;border-radius:4px}.notice{background:#f0f5f4;border-left:3px solid #098477;padding:12px 16px}button{font:inherit;font-weight:600;background:#076c63;color:white;padding:12px 20px;border:0;border-radius:8px;cursor:pointer}.secondary{color:#264b49;background:#eaf0ef;margin-left:8px}small{display:block;color:#526969;margin-top:28px}li{margin:8px 0}@media(max-width:720px){main{margin:16px;padding:24px}h1{font-size:30px}}
</style></head><body><main><div class="eyebrow">Training · Workout sending</div>${body}<small>Independent integration. Not affiliated with Garmin.</small></main></body></html>`;
}

function consentPage(details: ConsentDescription, handle: string): string {
  return trainingPage(
    "Authorize workout sending",
    `<h1>Connect ${escape(details.clientName)}.</h1><p>${details.clientDomain ? `Published by <strong>${escape(details.clientDomain)}</strong>.` : "This client’s name is self-reported."} Access will return to <strong>${escape(details.redirectHost)}</strong>.</p>${details.redirectIsLoopback ? '<p class="notice">This sends access to an app on your computer. Continue only if you started this connection.</p>' : ""}<p>Allow this assistant to create workouts and schedule them for sync to your Garmin watch. You will choose your Garmin account and approve Workout Import permission on Garmin’s next screen.</p><form method="post" action="/training/authorize"><input type="hidden" name="handle" value="${escape(handle)}"><p><strong>Requested permissions</strong></p><ul>${details.scope.map((scope) => `<li>${escape(scope)}</li>`).join("")}</ul><p><button name="decision" value="approve">Continue to Garmin</button><button class="secondary" name="decision" value="deny">Deny</button></p></form><p><a href="/training/privacy">Storage and revocation</a></p>`,
  );
}

function failed(status: number, headers = new Headers()): Response {
  return html(
    trainingPage(
      "Connection unsuccessful",
      "<h1>Connection unsuccessful.</h1><p>This connection could not be completed. Start again from your assistant.</p>",
    ),
    status,
    headers,
  );
}

function invalidGrant(): OAuthError {
  return new OAuthError("invalid_grant", {
    description: "Garmin training access has expired or was revoked. Connect again.",
  });
}

export async function fetchTraining(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Feature gating precedes URL parsing, OAuth construction, KV access and outbound requests.
  if (!enabled.safeParse(env).success) {
    return new Response("Not found", { status: 404 });
  }

  const parsed = credentials.safeParse(env);

  if (!parsed.success) {
    return Response.json(
      { error: "Garmin training is unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const config = {
    clientId: parsed.data.GARMIN_TRAINING_CLIENT_ID,
    clientSecret: parsed.data.GARMIN_TRAINING_CLIENT_SECRET,
  };

  const origin = new URL(env.PUBLIC_URL).origin;
  const issuer = `${origin}/training`;
  const resource = `${issuer}/mcp`;
  const callback = `${issuer}/callback`;
  const url = new URL(request.url);

  if (url.origin !== origin) {
    return new Response("Unknown host", { status: 421 });
  }

  const authorizationServer = new OAuthAuthorizationServer<Env>({
    issuer,
    resources: [resource],
    clientRegistrationEndpoint: "/training/oauth/register",
    clientIdMetadataDocumentEnabled: true,
    cookiePrefix: "__Host-garmin-training-",
    scopesSupported: [WRITE_SCOPE, "offline_access"],
    accessTokenTTL: 3600,
    refreshTokenTTL: REFRESH_TTL,
    async tokenExchangeCallback({ grantType, props, resource: audience, scope }) {
      const grant = grantProps.safeParse(props);

      if (!grant.success || audience !== resource || !scope.includes(WRITE_SCOPE)) {
        throw invalidGrant();
      }

      let tokens = grant.data.tokens;

      if (tokens.refreshTokenExpiresAt <= Date.now() + 60_000) {
        throw invalidGrant();
      }

      if (
        grantType === GrantType.REFRESH_TOKEN &&
        tokens.accessTokenExpiresAt <= Date.now() + (EXPIRY_MARGIN + 60) * 1000
      ) {
        try {
          tokens = tokenSet.parse(await refreshTrainingToken(config, tokens.refreshToken));
        } catch (error) {
          if (error instanceof TrainingError && [400, 401, 403].includes(error.status)) {
            throw invalidGrant();
          }

          throw new OAuthError("temporarily_unavailable", {
            description: "Garmin training is temporarily unavailable. Try again shortly.",
            statusCode: 503,
          });
        }
      }

      const now = Date.now();

      const accessTokenTTL = Math.min(
        3600,
        Math.floor((tokens.accessTokenExpiresAt - now) / 1000) - EXPIRY_MARGIN,
      );

      const refreshTokenTTL = Math.min(
        REFRESH_TTL,
        Math.floor((tokens.refreshTokenExpiresAt - now) / 1000),
      );

      // The provider and KV require a minimum 60 second lifetime; never round up past Garmin.
      if (accessTokenTTL < 60 || refreshTokenTTL < 60) {
        throw invalidGrant();
      }

      return {
        newProps: { kind: "garmin-training", tokens },
        accessTokenProps: {
          kind: "garmin-training",
          tokens: {
            accessToken: tokens.accessToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          },
        },
        accessTokenTTL,
        refreshTokenTTL,
        refreshTokenIdleTTL: refreshTokenTTL,
      };
    },
  });

  if (
    url.pathname === "/training/mcp" ||
    url.pathname.startsWith("/training/mcp/") ||
    url.pathname === "/.well-known/oauth-protected-resource/training/mcp"
  ) {
    const resourceServer = new OAuthResourceServer<Env>({
      resourceMetadata: {
        resource,
        authorization_servers: [issuer],
        resource_name: "Garmin Training MCP",
      },
      requiredScopes: [WRITE_SCOPE],
      validateToken: (bindings) => (audience, token) =>
        authorizationServer.validateToken<unknown>(audience, token, bindings),
      handler: {
        fetch(req, _env, context) {
          if (new URL(req.url).pathname !== "/training/mcp") {
            return new Response("Not found", { status: 404 });
          }

          if (!context.auth.scope.includes(WRITE_SCOPE)) {
            return insufficientScope(context.auth, [WRITE_SCOPE]);
          }

          const grant = accessProps.safeParse(context.props);

          if (!grant.success || grant.data.tokens.accessTokenExpiresAt <= Date.now()) {
            return Response.json(
              { error: "invalid_token" },
              {
                status: 401,
                headers: {
                  "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource/training/mcp"`,
                  "Cache-Control": "no-store",
                },
              },
            );
          }

          return createMcpHandler(() => createTrainingServer(grant.data.tokens.accessToken), {
            maxRequestBodySize: 64 * 1024,
          }).fetch(req);
        },
      },
    });

    return resourceServer.fetch(request, env, ctx);
  }

  if (request.method === "GET" && url.pathname === "/training") {
    return html(
      trainingPage(
        "Connect your Garmin training",
        `<h1>Send your workouts<br>to Garmin.</h1><p>Connect an MCP-compatible assistant to create workouts and schedule them for sync to your Garmin watch.</p><div class="notice"><strong>Training MCP server URL</strong><br><code>${escape(resource)}</code></div><ol><li>Add this server URL to your assistant and choose OAuth authentication.</li><li>Review the assistant’s permissions, then continue to Garmin.</li><li>Sign in to Garmin and allow Workout Import access.</li></ol><p>Workout sending uses the Garmin Business Training API. The service operator must have an approved Garmin developer application. Your Garmin Personal API key does not enable workout sending.</p><p><a href="/training/privacy">Storage and revocation</a></p>`,
      ),
    );
  }

  if (request.method === "GET" && url.pathname === "/training/privacy") {
    return html(
      trainingPage(
        "Storage and revocation",
        `<h1>You control training access.</h1><p>The server stores OAuth clients, consent transactions and authorization grants in Cloudflare KV. Garmin access and refresh tokens are encrypted by the OAuth provider library inside each grant. MCP tools never return these credentials.</p><p>Your assistant can create workouts and schedule them for sync to your Garmin watch. Workout responses are handled for the current request; the server does not store workout history.</p><p>MCP access tokens last at most one hour and expire before the Garmin access token. Refresh access ends within 30 days of an exchange and never lasts beyond the Garmin refresh token’s expiry.</p><p>Remove this service from Garmin Connect’s Connected Apps to revoke the Garmin authorization. Revoking a local MCP token or grant only removes your assistant’s local access; it does not disconnect the app at Garmin.</p><p><a href="/training">Training setup</a></p>`,
      ),
    );
  }

  if (url.pathname !== "/training/authorize" && url.pathname !== "/training/callback") {
    return authorizationServer.fetch(request, env, ctx);
  }

  const oauth = authorizationServer.getOAuthApi(env);
  let responseHeaders = new Headers();

  try {
    if (url.pathname === "/training/callback") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      }

      const resumed = await oauth.finishUpstream(request);
      responseHeaders = resumed.headers;

      if (url.searchParams.has("error")) {
        responseHeaders.set(
          "Location",
          authorizationErrorRedirect(resumed.request, "access_denied"),
        );

        return new Response(null, { status: 302, headers: responseHeaders });
      }

      const data = upstreamData.safeParse(resumed.data);
      const code = url.searchParams.get("code");

      if (!data.success || !code || code.length > 4096) {
        return failed(400, responseHeaders);
      }

      const tokens = tokenSet.parse(
        await exchangeTrainingCode(config, code, data.data.verifier, callback),
      );

      const client = new TrainingClient(tokens.accessToken);
      const permissions = await client.getPermissions();

      if (!permissions.includes("WORKOUT_IMPORT")) {
        responseHeaders.set(
          "Location",
          authorizationErrorRedirect(resumed.request, "access_denied"),
        );

        return new Response(null, { status: 302, headers: responseHeaders });
      }

      const { userId } = await client.getUserId();

      const { redirectTo } = await oauth.completeAuthorization({
        request: resumed.request,
        userId: encodeURIComponent(`garmin-training:${userId}`),
        metadata: { source: "Garmin Training API" },
        scope: resumed.request.scope,
        props: { kind: "garmin-training", tokens },
      });

      responseHeaders.set("Location", redirectTo);

      return new Response(null, { status: 302, headers: responseHeaders });
    }

    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);

      const trainingRequest = {
        ...authRequest,
        scope: [WRITE_SCOPE, ...authRequest.scope.filter((scope) => scope === "offline_access")],
      };

      const details = await oauth.describeConsent(trainingRequest);
      const consent = await oauth.beginConsent(trainingRequest);

      return html(
        consentPage(details, consent.handle),
        200,
        consent.headers,
        `${consentFormAction(details.redirectUri)} https://connect.garmin.com`,
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }

    if (request.headers.get("Origin") !== origin) {
      return new Response("Invalid origin", { status: 403 });
    }

    if (
      request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
    ) {
      return new Response("Expected a form", { status: 415 });
    }

    const raw = await readBounded(new Response(request.body), 16 * 1024);
    const form = new URLSearchParams(new TextDecoder().decode(raw));
    const handle = form.get("handle") ?? "";

    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);

      return new Response(null, { status: 302, headers: denied.headers });
    }

    const approved = await oauth.approveConsent(request, handle);
    const verifier = crypto.randomUUID() + crypto.randomUUID();

    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url");

    const upstream = await oauth.beginUpstream(approved.request, {
      data: { verifier },
      headers: approved.headers,
    });

    const location = new URL(GARMIN_AUTHORIZE);
    location.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: callback,
      state: upstream.state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    upstream.headers.set("Location", location.href);

    return new Response(null, { status: 302, headers: upstream.headers });
  } catch (error) {
    if (
      error instanceof AuthorizationError &&
      url.pathname === "/training/authorize" &&
      request.method === "GET" &&
      error.redirectTo
    ) {
      return Response.redirect(error.redirectTo, 302);
    }

    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      return failed(400, responseHeaders);
    }

    if (
      error instanceof TrainingError ||
      error instanceof GarminError ||
      error instanceof z.ZodError
    ) {
      return failed(
        error instanceof GarminError && error.status === 413 ? 413 : 502,
        responseHeaders,
      );
    }

    throw error;
  }
}
