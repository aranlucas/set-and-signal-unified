import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { app } from "./app";
import type { AppEnv } from "./auth";
import { READ_SCOPE, WOMENS_SCOPE } from "./scopes";
import { isTrainingPath } from "./training/auth";

export default {
  async fetch(request: Request, bindings: Env, ctx: ExecutionContext): Promise<Response> {
    const publicUrl = new URL(request.url);
    // Each branch or version alias uses its own origin without changing shared bindings.
    const env = { ...bindings, PUBLIC_URL: publicUrl.origin };

    const provider = new OAuthProvider<AppEnv>({
      apiRoute: "/mcp",
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      scopesSupported: [READ_SCOPE, WOMENS_SCOPE, "offline_access"],
      requiredScopes: [READ_SCOPE],
      clientIdMetadataDocumentEnabled: true,
      accessTokenTTL: 3600,
      refreshTokenTTL: 30 * 24 * 3600,
      resourceMetadata: {
        resource: `${publicUrl.origin}/mcp`,
        authorization_servers: [publicUrl.origin],
        resource_name: "Garmin Personal MCP",
      },
      defaultHandler: app,
      apiHandler: app,
    });

    try {
      if (isTrainingPath(new URL(request.url).pathname)) {
        // Gate before the app parses bodies or constructs Training OAuth handlers.
        if (env.GARMIN_TRAINING_ENABLED !== "true") {
          return new Response("Not found", { status: 404 });
        }

        return await app.fetch(request, env, ctx);
      }

      // SAFETY: OAuthProvider adds OAUTH_PROVIDER to env before it calls any handler.
      return await provider.fetch(request, env as AppEnv, ctx);
    } catch {
      // Avoid logging upstream responses, authorization URLs, or credential-bearing headers.
      // oxlint-disable-next-line no-console -- Workers Logs is the only error sink.
      console.error(
        JSON.stringify({ event: "request_failed", path: new URL(request.url).pathname }),
      );

      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
