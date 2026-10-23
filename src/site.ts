import styles from "./site.css?raw";

export const garminKeyUrl = "https://connect.garmin.com/app/settings/personalApiToken";

const faqUrl = "https://developer.garmin.com/gc-developer-program/personal/personal-faq/";

const iconPaths = {
  pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  activity:
    '<circle cx="15" cy="4" r="2"/><path d="m12 8 4 3 5 1M16 7l-5 6-5-1-3 5m8-4 5 4-2 5M5 7l5 1"/>',
  moon: '<path d="M20.9 13.3A9 9 0 0 1 10.7 3.1 9 9 0 1 0 20.9 13.3Z"/>',
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  shield: '<path d="m12 3 9 4v6c0 5-9 9-9 9s-9-4-9-9V7l9-4Z"/><path d="m8 12 3 3 5-6"/>',
};

export function siteIcon(name: keyof typeof iconPaths): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]}</svg>`;
}

const brand = `<span class="brand-icon">${siteIcon("pulse")}</span><span>Garmin Personal MCP</span>`;

/** Public content shares a shell; consent retains its isolated form and security policy. */
export function sitePage(kind: "home" | "privacy", body: string): string {
  const isPrivacy = kind === "privacy";
  const setupUrl = isPrivacy ? "/#connect" : "#connect";

  const description = isPrivacy
    ? "What Garmin Personal MCP stores, how authorization expires, and how to disconnect your Garmin data."
    : "Connect your Garmin activities, sleep, and recovery to your MCP-compatible AI assistant with read-only access and Garmin’s official Personal API.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${description}">
  <meta name="theme-color" content="#faf9f6">
  <title>${isPrivacy ? "Privacy and access" : "Your training. A better conversation."} · Garmin Personal MCP</title>
  <style>${styles}</style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header wrap">
    <a class="brand" href="/" aria-label="Garmin Personal MCP home">${brand}</a>
    <nav aria-label="Main navigation">
      <a href="${setupUrl}">How it works</a>
      <a href="/privacy"${isPrivacy ? ' aria-current="page"' : ""}>Privacy</a>
      <a class="button button-small" href="${setupUrl}">Get connected <span aria-hidden="true">↗</span></a>
    </nav>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer wrap">
    <div class="footer-brand"><a class="brand" href="/">${brand}</a><p>Independent integration. Not affiliated with Garmin.<br>Data supplied by Garmin Connect.</p></div>
    <nav aria-label="Footer navigation"><a href="${isPrivacy ? "/#connect" : "/privacy"}">${isPrivacy ? "Back to setup" : "Privacy"}</a><a href="${faqUrl}" target="_blank" rel="noopener noreferrer">Garmin API FAQ <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a></nav>
  </footer>
</body>
</html>`;
}
