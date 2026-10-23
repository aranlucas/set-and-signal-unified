import {
  insufficientScope,
  OAuthProvider,
  type OAuthResourceContext,
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import type { Context } from "hono";
import * as z from "zod";
import { authHandler, type AppEnv } from "./auth";
import { createServer } from "./mcp";
import { READ_SCOPE, WOMENS_SCOPE } from "./scopes";

/** Grant props saved by the consent flow in auth.ts. */
const grantProps = z.object({ apiKey: z.string() });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const publicUrl = new URL(env.PUBLIC_URL);

    if (new URL(request.url).origin !== publicUrl.origin) {
      return new Response("Unknown host", { status: 421 });
    }

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
      defaultHandler: authHandler,
      apiHandler: {
        fetch(req, _env, context) {
          if (new URL(req.url).pathname !== "/mcp") {
            return new Response("Not found", { status: 404 });
          }
          // SAFETY: OAuthProvider passes its documented resource context to the protected handler.

          const { props, auth } = context as OAuthResourceContext<unknown>;

          if (!auth.scope.includes(READ_SCOPE)) {
            return insufficientScope(auth, [READ_SCOPE]);
          }

          const grant = grantProps.safeParse(props);

          if (!grant.success) {
            return Response.json({ error: "invalid_token" }, { status: 401 });
          }

          const key = grant.data.apiKey;

          // SDK v2 serves current per-request MCP and stateless 2025 clients.
          const handler = createMcpHandler(() => createServer(key, auth.scope), {
            maxRequestBodySize: 64 * 1024,
          });

          const app = createMcpHonoApp({
            host: publicUrl.hostname,
            maxRequestBodySize: 64 * 1024,
          });

          app.all("/mcp", (c: Context) =>
            handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") }),
          );
          // Let the Worker's redacted error handler own unexpected failures.
          app.onError((error) => {
            throw error;
          });

          return app.fetch(req);
        },
      },
    });

    try {
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
