import icon from "../assets/icon.svg?raw";
import iconPng from "../assets/icon.png?inline";
import { env } from "cloudflare:workers";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { jsxRenderer } from "hono/jsx-renderer";
import {
  authenticate,
  garminCredential,
  GARMIN_SCOPE,
  type AuthBroker,
  type AppBindings,
} from "./auth";
import { receivePush, purgeUser } from "./push/handler";
import { userStore } from "./push/store";
import { createServer } from "./mcp";
import { htmlHeaders } from "./page-headers";
import { HomePage } from "./pages/home";
import { PrivacyPage } from "./pages/privacy";

// One router for both OAuth dispatch paths; credentials remain request-local.
export const app = createMcpHonoApp({
  host: new URL(env.PUBLIC_URL).hostname,
  maxRequestBodySize: 4 * 1024 * 1024,
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

app.get("/icon.svg", (c) =>
  c.body(icon, 200, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "public, max-age=86400",
  }),
);

app.get("/icon.png", (c) =>
  c.body(Buffer.from(iconPng.slice(iconPng.indexOf(",") + 1), "base64"), 200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400",
  }),
);

app.get("/health", (c) => c.json({ status: "ok", service: "garmin-mcp" }));

type MetadataContext = { env: Env };

const metadata = (c: MetadataContext) => ({
  resource: `${c.env.PUBLIC_URL}/mcp`,
  authorization_servers: [c.env.AUTH_ISSUER],
  resource_name: "Garmin MCP",
  scopes_supported: [GARMIN_SCOPE],
  bearer_methods_supported: ["header"],
});

app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(metadata(c)));

app.get("/.well-known/oauth-protected-resource", (c) => c.json(metadata(c)));

app.get("/training", (c) => c.redirect("/#connect", 308));

app.get("/training/privacy", (c) => c.redirect("/privacy", 308));

app.post("/webhook/garmin/:credential", (c) =>
  receivePush(c.req.raw, c.env, c.req.param("credential")),
);

// Keep existing Garmin configurations and queued deliveries working during migration.
app.post("/garmin/push/:credential", (c) =>
  receivePush(c.req.raw, c.env, c.req.param("credential")),
);

app.post("/garmin/disconnect", (c) => purgeUser(c.req.raw, c.env));

app.all("/mcp", async (c) => {
  const identity = await authenticate(c.req.raw, c.env);
  const challenge = `Bearer resource_metadata="${c.env.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp", scope="${GARMIN_SCOPE}"`;

  const reject = (status: 401 | 403, details = "") =>
    new Response(null, {
      status,
      headers: {
        "WWW-Authenticate": challenge + details,
        "Cache-Control": "no-store",
      },
    });

  if ("error" in identity) {
    if (identity.error === "missing_token") {
      return reject(401);
    }

    return reject(
      identity.error === "insufficient_scope" ? 403 : 401,
      `, error="${identity.error}"`,
    );
  }

  const { userId } = identity;
  // SAFETY: AUTH is the private GarminTokens Worker entrypoint; its reply is schema-checked below.
  const broker = c.env.AUTH as AuthBroker;
  const credential = garminCredential.safeParse(await broker.accessToken(userId));

  if (!credential.success || credential.data.expiresAt <= Date.now()) {
    return reject(
      401,
      ', error="invalid_token", error_description="Reconnect Garmin in Auth and try again."',
    );
  }

  const { accessToken, garminUserId } = credential.data;
  const store = userStore(c.env, garminUserId);
  await store.bindActivityOwner(userId, garminUserId);

  const handler = createMcpHandler(
    () => createServer(accessToken, store, fetch, { subject: userId, garminUserId }),
    {
      maxRequestBodySize: 64 * 1024,
    },
  );

  return handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") });
});

app.notFound(() => new Response("Not found", { status: 404 }));

app.onError((error) => {
  // Unexpected errors reach the Worker's redacted logger, not Hono's default logger.
  throw error;
});
