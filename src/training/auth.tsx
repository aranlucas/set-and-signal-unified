import {
  AuthorizationError,
  authorizationErrorRedirect,
  CimdFetchError,
  GrantType,
  insufficientScope,
  OAuthAuthorizationServer,
  OAuthError,
  OAuthResourceServer,
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { Context } from "hono";
import type { AppBindings } from "../auth";
import { consentFormAction } from "../page-headers";
import {
  TrainingHomePage,
  TrainingPrivacyPage,
  TrainingConsentPage,
  TrainingErrorPage,
} from "../pages/training";
import { readBounded } from "../garmin";
import { GarminError } from "../garmin-error";
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

function invalidGrant(): OAuthError {
  return new OAuthError("invalid_grant", {
    description: "Garmin training access has expired or was revoked. Connect again.",
  });
}

export async function handleTraining(c: Context<AppBindings>): Promise<Response> {
  const request = c.req.raw;
  const env = c.env;
  // SAFETY: Worker dispatch supplies the full runtime context; Hono types only its common subset.
  const ctx = c.executionCtx as ExecutionContext;

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

  const url = new URL(request.url);
  const origin = url.origin;
  const issuer = `${origin}/training`;
  const resource = `${issuer}/mcp`;
  const callback = `${issuer}/callback`;

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
    return c.render(<TrainingHomePage resource={resource} />);
  }

  if (request.method === "GET" && url.pathname === "/training/privacy") {
    return c.render(<TrainingPrivacyPage />);
  }

  if (url.pathname !== "/training/authorize" && url.pathname !== "/training/callback") {
    return authorizationServer.fetch(request, env, ctx);
  }

  const oauth = authorizationServer.getOAuthApi(env);

  try {
    if (url.pathname === "/training/callback") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      }

      const resumed = await oauth.finishUpstream(request);
      const responseHeaders = resumed.headers;

      for (const [name, value] of responseHeaders) {
        c.header(name, value, { append: name === "set-cookie" });
      }

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
        c.status(400);

        return await c.render(<TrainingErrorPage />);
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

      for (const [name, value] of consent.headers) {
        c.header(name, value, { append: name === "set-cookie" });
      }

      c.set("formAction", `${consentFormAction(details.redirectUri)} https://connect.garmin.com`);

      return await c.render(<TrainingConsentPage details={details} handle={consent.handle} />);
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
      c.status(400);

      return c.render(<TrainingErrorPage />);
    }

    if (
      error instanceof TrainingError ||
      error instanceof GarminError ||
      error instanceof z.ZodError
    ) {
      c.status(error instanceof GarminError && error.status === 413 ? 413 : 502);

      return c.render(<TrainingErrorPage />);
    }

    throw error;
  }
}
