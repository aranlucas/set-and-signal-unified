import type { PropsWithChildren } from "hono/jsx";
import siteStyles from "../site.css?raw";
import { Icon } from "./icon";
import { garminFaqUrl } from "./links";

type DocumentProps = PropsWithChildren<{
  title: string;
  styles: string;
  description?: string;
  themeColor?: string;
  serviceName?: string;
}>;

function Document({
  title,
  styles,
  description,
  themeColor,
  serviceName = "Garmin MCP",
  children,
}: DocumentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {description && <meta name="description" content={description} />}
        {themeColor && <meta name="theme-color" content={themeColor} />}
        <title>
          {title} · {serviceName}
        </title>
        {/* Only trusted, build-time CSS bypasses escaping. Page content always uses JSX. */}
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

function Brand() {
  return (
    <>
      <span class="brand-icon">
        <Icon name="pulse" />
      </span>
      <span>Garmin MCP</span>
    </>
  );
}

type SiteLayoutProps = PropsWithChildren<{ kind: "home" | "privacy" }>;

export function SiteLayout({ kind, children }: SiteLayoutProps) {
  const isPrivacy = kind === "privacy";
  const setupUrl = isPrivacy ? "/#connect" : "#connect";

  const description = isPrivacy
    ? "What Garmin MCP stores, how authorization expires, and how to disconnect your Garmin data."
    : "Connect Garmin Health, Activity, and Training to your MCP-compatible assistant with shared Auth sign-in.";

  return (
    <Document
      title={isPrivacy ? "Privacy and access" : "Your training. A better conversation."}
      styles={siteStyles}
      description={description}
      themeColor="#faf9f6"
    >
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <header class="site-header wrap">
        <a class="brand" href="/" aria-label="Garmin MCP home">
          <Brand />
        </a>
        <nav aria-label="Main navigation">
          <a href={setupUrl}>How it works</a>
          <a href="/privacy" aria-current={isPrivacy ? "page" : undefined}>
            Privacy
          </a>
          <a class="button button-small" href={setupUrl}>
            Get connected <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main id="main">{children}</main>
      <footer class="site-footer wrap">
        <div class="footer-brand">
          <a class="brand" href="/">
            <Brand />
          </a>
          <p>
            Independent integration. Not affiliated with Garmin.
            <br />
            Data supplied by Garmin Connect.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <a href={isPrivacy ? "/#connect" : "/privacy"}>
            {isPrivacy ? "Back to setup" : "Privacy"}
          </a>
          <a href={garminFaqUrl} target="_blank" rel="noopener noreferrer">
            Garmin API FAQ <span aria-hidden="true">↗</span>
            <span class="sr-only"> (opens in a new tab)</span>
          </a>
        </nav>
      </footer>
    </Document>
  );
}
