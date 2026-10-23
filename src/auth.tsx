import {
  AuthorizationError,
  CimdFetchError,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import type { Context } from "hono";
import { obtainToken, readBounded } from "./garmin";
import { GarminError } from "./garmin-error";
import { consentFormAction } from "./page-headers";
import { READ_SCOPE, WOMENS_SCOPE } from "./scopes";
import { ConsentPage } from "./pages/consent";
import { AuthorizationErrorPage, KeyErrorPage } from "./pages/errors";

export type AppEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

export type AppBindings = {
  Bindings: Env;
  Variables: { formAction?: string; parsedBody?: unknown };
};

export async function authorize(c: Context<AppBindings>) {
  const request = c.req.raw;
  const env = c.env;

  try {
    // SAFETY: OAuthProvider supplies this helper before dispatching /authorize.
    const oauth = (env as AppEnv).OAUTH_PROVIDER;

    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);

      for (const [name, value] of consent.headers) {
        c.header(name, value, { append: name === "set-cookie" });
      }

      c.set("formAction", consentFormAction(details.redirectUri));

      return await c.render(<ConsentPage details={details} handle={consent.handle} />);
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }

    if (request.headers.get("Origin") !== new URL(env.PUBLIC_URL).origin) {
      return new Response("Invalid origin", { status: 403 });
    }

    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
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
    const scopes = [READ_SCOPE];

    if (approved.request.scope.includes("offline_access")) {
      scopes.push("offline_access");
    }

    if (form.get("womensHealth") === "yes") {
      scopes.push(WOMENS_SCOPE);
    }

    const apiKey = form.get("apiKey")?.trim() ?? "";

    if (apiKey.length < 8 || apiKey.length > 4096 || /\s/.test(apiKey)) {
      for (const [name, value] of approved.headers) {
        c.header(name, value, { append: name === "set-cookie" });
      }

      c.status(400);

      return await c.render(<KeyErrorPage />);
    }

    // Verify before persisting the encrypted grant. Never save an unverified key.
    await obtainToken(apiKey);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));

    const userId = Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join(
      "",
    );

    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId,
      metadata: { source: "Garmin Personal API" },
      scope: scopes,
      props: { apiKey },
    });

    approved.headers.set("Location", redirectTo);

    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && request.method === "GET" && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }

    if (
      error instanceof AuthorizationError ||
      error instanceof CimdFetchError ||
      error instanceof GarminError
    ) {
      const message =
        error instanceof GarminError
          ? error.message
          : "This authorization request is invalid or expired. Start again from your assistant.";

      c.status(error instanceof GarminError ? 502 : 400);

      return c.render(<AuthorizationErrorPage message={message} />);
    }

    throw error;
  }
}
