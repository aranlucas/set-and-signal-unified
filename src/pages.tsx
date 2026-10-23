import type { Child } from "hono/jsx";
import { renderToString } from "hono/jsx/dom/server";
import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { ConsentPage } from "./pages/consent";
import { AuthorizationErrorPage, KeyErrorPage } from "./pages/errors";
import { HomePage } from "./pages/home";
import { PrivacyPage } from "./pages/privacy";

function renderPage(element: Child): string {
  return `<!doctype html>${renderToString(element)}`;
}

export function home(publicUrl: string): string {
  return renderPage(<HomePage publicUrl={publicUrl} />);
}

export function privacyPage(): string {
  return renderPage(<PrivacyPage />);
}

export function consentPage(details: ConsentDescription, handle: string): string {
  return renderPage(<ConsentPage details={details} handle={handle} />);
}

export function keyErrorPage(): string {
  return renderPage(<KeyErrorPage />);
}

export function authorizationErrorPage(message: string): string {
  return renderPage(<AuthorizationErrorPage message={message} />);
}
