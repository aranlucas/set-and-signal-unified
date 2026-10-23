import { env } from "cloudflare:workers";
import { insufficientScope, type OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { jsxRenderer } from "hono/jsx-renderer";
import * as z from "zod";
import { authorize, type AppBindings } from "./auth";
import { createServer } from "./mcp";
import { htmlHeaders } from "./page-headers";
import { HomePage } from "./pages/home";
import { PrivacyPage } from "./pages/privacy";
import { READ_SCOPE } from "./scopes";
import { handleTraining } from "./training/auth";

const grantProps = z.object({ apiKey: z.string() });

// One router for both OAuth dispatch paths; credentials remain request-local.
export const app = createMcpHonoApp({
  host: new URL(env.PUBLIC_URL).hostname,
  maxRequestBodySize: 64 * 1024,
}).use<AppBindings>(jsxRenderer());

app.use("*", async (c, next) => {
  await next();

  if (c.res.headers.get("Content-Type")?.startsWith("text/html")) {
    for (const [name, value] of htmlHeaders(c.get("formAction"))) {
      c.header(name, value);
    }
  }
});

app.get("/", (c) => c.render(<HomePage publicUrl={c.env.PUBLIC_URL} />));

app.get("/privacy", (c) => c.render(<PrivacyPage />));

app.get("/health", (c) => c.json({ status: "ok", service: "garmin-personal-mcp" }));

app.all("/authorize", authorize);

app.on(
  "ALL",
  [
    "/training",
    "/training/*",
    "/.well-known/oauth-authorization-server/training",
    "/.well-known/oauth-protected-resource/training/mcp",
  ],
  handleTraining,
);

app.all("/mcp", (c) => {
  // SAFETY: OAuthProvider dispatches this protected route with its documented resource context.
  const { props, auth } = c.executionCtx as OAuthResourceContext<unknown>;

  if (!auth.scope.includes(READ_SCOPE)) {
    return insufficientScope(auth, [READ_SCOPE]);
  }

  const grant = grantProps.safeParse(props);

  if (!grant.success) {
    return c.json({ error: "invalid_token" }, 401);
  }

  const handler = createMcpHandler(() => createServer(grant.data.apiKey, auth.scope), {
    maxRequestBodySize: 64 * 1024,
  });

  return handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") });
});

app.notFound(() => new Response("Not found", { status: 404 }));

app.onError((error) => {
  // Unexpected errors reach the Worker's redacted logger, not Hono's default logger.
  throw error;
});
