import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { garminKeyUrl, siteIcon, sitePage } from "./site";

const htmlEntities = new Map([
  ["&", "&#38;"],
  ["<", "&#60;"],
  [">", "&#62;"],
  ['"', "&#34;"],
  ["'", "&#39;"],
]);

export const escape = (value: string): string =>
  value.replaceAll(/[&<>"']/g, (char) => htmlEntities.get(char) ?? char);

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Garmin Personal MCP</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f4f4;color:#182f31;font:16px/1.6 system-ui,sans-serif}main{max-width:680px;margin:8vh auto;padding:36px;background:white;border:1px solid #d7e2e1;border-radius:16px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:#536f70}h1{font-size:34px;line-height:1.15;letter-spacing:-.04em;margin:16px 0 24px}p{margin:16px 0}a{color:#006b65}code{background:#edf3f2;overflow-wrap:anywhere;padding:3px 6px;border-radius:4px}label{display:block;margin:18px 0 8px;font-weight:600}input[type=password]{width:100%;font:inherit;padding:12px;border:1px solid #7a9292;border-radius:8px}button{font:inherit;font-weight:600;background:#076c63;color:white;padding:12px 20px;border:0;border-radius:8px;cursor:pointer}.secondary{color:#264b49;background:#eaf0ef;margin-left:8px}.muted,small{color:#526969}small{display:block;margin-top:24px}.notice{background:#f0f5f4;border-left:3px solid #098477;padding:12px 16px}ul,ol{padding-left:24px}li{margin:8px 0}input[type=checkbox]{margin-right:8px}hr{border:0;border-top:1px solid #e0e8e7;margin:28px 0}@media(max-width:720px){main{margin:16px;padding:24px}h1{font-size:30px}}
</style></head><body><main><div class="eyebrow">Personal data · Read only</div>${body}<hr><small>Independent integration. Not affiliated with Garmin. Data supplied by Garmin Connect.</small></main></body></html>`;
}

export function home(publicUrl: string): string {
  return sitePage(
    "home",
    `<section class="hero wrap" aria-labelledby="hero-title">
      <div>
        <h1 id="hero-title">Your training.<br><span class="accent">A better conversation.</span></h1>
        <p class="hero-intro">Bring your activities, sleep, and recovery into your AI assistant. Ask better questions with your own Garmin data.</p>
        <a class="button" href="#connect">Connect your assistant <span aria-hidden="true">↗</span></a>
        <p class="hero-note">Read only · Your key stays private</p>
      </div>
      <div class="conversation" aria-label="Example question using your Garmin data">
        <p class="conversation-label">A conversation with your data</p>
        <p class="chat-prompt">How did I sleep after my long run?</p>
        <div class="chat-data">
          <span class="brand-icon">${siteIcon("pulse")}</span>
          <div class="data-panel">
            <p class="data-label">Context from your Garmin data</p>
            <div class="data-row">${siteIcon("activity")}<div><strong>Activities</strong><span>Your runs, rides, and more</span></div></div>
            <div class="data-row">${siteIcon("moon")}<div><strong>Sleep</strong><span>Sleep data and sleep stages</span></div></div>
            <div class="data-row">${siteIcon("heart")}<div><strong>Recovery</strong><span>HRV and Body Battery</span></div></div>
          </div>
        </div>
        <p class="chat-note">Your data. More context.</p>
      </div>
    </section>
    <section class="features wrap" aria-label="What you can connect">
      <article class="feature">
        ${siteIcon("activity")}
        <h2>Training, in context.</h2>
        <p>Bring your activities into the conversation. Ask about your runs, rides, strength sessions, and more, in the context of your bigger picture.</p>
        <ul><li>Runs, rides, and other activities</li><li>Activity details and workouts</li><li>Recent and historical data</li></ul>
      </article>
      <article class="feature">
        ${siteIcon("moon")}
        <h2>Recovery, connected.</h2>
        <p>Include sleep and recovery data to get a fuller picture. Look at how your training fits with your rest and daily energy.</p>
        <ul><li>Sleep data and sleep stages</li><li>Heart rate variability (HRV)</li><li>Body Battery and daily health</li></ul>
      </article>
      <article class="feature">
        ${siteIcon("lock")}
        <h2>Access, on your terms.</h2>
        <p>You control what’s shared. Access is read only, your key is encrypted, and sensitive data like women’s health requires separate consent.</p>
        <ul><li>Encrypted key, read-only access</li><li>Separate women’s health consent</li><li>Disconnect at any time</li></ul>
      </article>
    </section>
    <section class="setup-band" aria-labelledby="setup-title">
      <div class="setup wrap" id="connect">
        <div class="setup-intro">
          <h2 id="setup-title">One connection.<br><span class="accent">More perspective.</span></h2>
          <p>Set up Garmin Personal MCP in a few simple steps and bring your own data into your MCP-compatible AI assistant.</p>
        </div>
        <div>
          <ol class="steps">
            <li><h3>Create your Garmin key</h3><p>Create a Personal API key in Garmin Connect. Save it somewhere safe: Garmin shows it only once.</p><a href="${garminKeyUrl}" target="_blank" rel="noopener noreferrer">Create a Garmin key <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a></li>
            <li><h3>Add the MCP server</h3><p>Add a remote HTTP connector in your assistant and choose OAuth authentication.</p><div class="endpoint"><label for="mcp-url">MCP server URL</label><input id="mcp-url" type="text" readonly spellcheck="false" value="${escape(publicUrl)}/mcp" aria-describedby="endpoint-help"></div><p class="endpoint-help" id="endpoint-help">Select the URL and copy it into your assistant.</p></li>
            <li><h3>Approve your connection</h3><p>Start the connection from your assistant. Check the client and return address, enter your Garmin key, and approve access.</p><p>Women’s health data requires separate consent.</p></li>
          </ol>
          <p class="setup-note">This uses Garmin’s official Personal API. Your assistant receives its own MCP token. Your Garmin key stays encrypted in the authorization grant and is never returned by MCP tools.</p>
        </div>
      </div>
    </section>
    <section class="privacy-band" aria-labelledby="privacy-cta-title">
      <div class="privacy-cta wrap">
        ${siteIcon("shield")}
        <div><h2 id="privacy-cta-title">Your data stays yours.</h2><p>Read-only access. No health data stored by this server.</p></div>
        <a href="/privacy">Read the privacy details <span aria-hidden="true">↗</span></a>
      </div>
    </section>`,
  );
}

export function consentPage(details: ConsentDescription, handle: string): string {
  return page(
    "Authorize access",
    `<h1>Connect ${escape(details.clientName)}.</h1><p>${details.clientDomain ? `Published by <strong>${escape(details.clientDomain)}</strong>.` : "This client’s name is self-reported."} Access will return to <strong>${escape(details.redirectHost)}</strong>.</p>${details.redirectIsLoopback ? '<p class="notice">This sends access to an app on your computer. Continue only if you started this connection.</p>' : ""}<p>Allow this assistant to read your Garmin activity and health data. Your Garmin key stays on this server, encrypted in the authorization grant.</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(handle)}"><p><strong>Requested permissions</strong></p><ul>${details.scope.map((scope) => `<li>${escape(scope)}</li>`).join("")}</ul><label for="apiKey">Garmin Personal API key</label><input id="apiKey" name="apiKey" type="password" autocomplete="off" required minlength="8" maxlength="4096" pattern="\\S+"><p class="muted"><a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noopener noreferrer">Create a key in Garmin Connect</a>, then paste it here. This is your personal API key, not your Garmin password or a 24-hour access token.</p><label><input type="checkbox" name="womensHealth" value="yes">Also allow women’s health data</label><p class="muted">Optional: adds menstrual cycle summary and day-view tools.</p><p><button name="decision" value="approve">Connect and allow</button><button class="secondary" name="decision" value="deny" formnovalidate>Deny</button></p></form><p><a href="/privacy">How to disconnect and delete access</a></p>`,
  );
}

export function privacyPage(): string {
  return sitePage(
    "privacy",
    `<div class="privacy-intro wrap">
      <a class="back-link" href="/#connect"><span aria-hidden="true">←</span> Back to setup</a>
      <h1>Your data.<br><span class="accent">Your call.</span></h1>
      <p>A clear look at what this server stores, how access works, and how to disconnect.</p>
    </div>
    <div class="privacy-layout wrap">
      <aside class="contents"><nav aria-label="On this page"><h2>On this page</h2><a href="#storage">What is stored</a><a href="#expiry">Access and expiry</a><a href="#disconnect">Disconnect</a><a href="#logs">Logs and infrastructure</a></nav></aside>
      <div class="privacy-sections">
        <section class="policy-section" id="storage" aria-labelledby="storage-title">
          <span class="section-number" aria-hidden="true">01</span>
          <div><h2 id="storage-title">What is stored</h2><p>This server stores OAuth client registrations, consent transactions, and authorization grants in Cloudflare KV.</p><p>Your Garmin Personal API key is encrypted within each grant by Cloudflare’s OAuth provider library. The server decrypts it to call Garmin. Use a deployment you trust.</p><p class="callout"><strong>Health data is not persisted.</strong> Garmin access tokens and API responses are held only for the current request.</p></div>
        </section>
        <section class="policy-section" id="expiry" aria-labelledby="expiry-title">
          <span class="section-number" aria-hidden="true">02</span>
          <div><h2 id="expiry-title">Access and expiry</h2><table class="expiry-table"><caption class="sr-only">Authorization token and key expiration</caption><thead><tr><th scope="col">Item</th><th scope="col">Expiry</th></tr></thead><tbody><tr><td>MCP access token</td><td>1 hour</td></tr><tr><td>MCP refresh token and grant</td><td>30 days</td></tr><tr><td>Garmin Personal API key</td><td>Expiry chosen in Garmin Connect</td></tr></tbody></table></div>
        </section>
        <section class="policy-section" id="disconnect" aria-labelledby="disconnect-title">
          <span class="section-number" aria-hidden="true">03</span>
          <div><h2 id="disconnect-title">Disconnect</h2><ol class="disconnect-steps"><li><h3>Delete your Garmin key</h3><p>Delete your Personal API key in <a href="${garminKeyUrl}">Garmin Connect</a> to stop upstream access. Garmin says this also invalidates its associated Garmin access tokens.</p></li><li><h3>Revoke your MCP connection</h3><p>Revoke your MCP <strong>refresh token</strong> through the OAuth revocation endpoint advertised by this server to revoke the entire grant. Revoking only an access token does not revoke the full refreshable session. Then remove the connector from your assistant.</p></li></ol><p class="callout"><strong>Deleting your Garmin key does not erase the encrypted MCP grant.</strong> Revoke the grant or let it expire. The deployment owner can erase the dedicated KV namespace to delete all authorization records.</p></div>
        </section>
        <section class="policy-section" id="logs" aria-labelledby="logs-title">
          <span class="section-number" aria-hidden="true">04</span>
          <div><h2 id="logs-title">Logs and infrastructure</h2><p>Application logs contain generic error events. Credentials and health payloads are not included in application logs.</p><p>Cloudflare infrastructure processes requests under the deployment owner’s account.</p></div>
        </section>
      </div>
    </div>`,
  );
}
