<img src="assets/icon.svg" width="64" height="64" alt="">

# Garmin Personal MCP

A read-only MCP server for Garmin’s **official Personal API**, deployed on Cloudflare Workers. Built with the current stable TypeScript MCP SDK **v2.3.1** (`@modelcontextprotocol/server`), Zod 4, and Cloudflare’s OAuth provider. Dependencies are pinned in `package-lock.json`.

**Live MCP URL:** `https://garmin-mcp.aranlucas.workers.dev/mcp`

**Setup page:** <https://garmin-mcp.aranlucas.workers.dev>

## Connect

1. Open [Garmin Connect → Personal API Key](https://connect.garmin.com/app/settings/personalApiToken), choose **Create Key**, accept Garmin’s terms, choose an expiration, and save the key. Garmin displays it once.
2. Add the live MCP URL to your MCP client using remote HTTP and OAuth. Clients must support OAuth authorization code flow with S256 PKCE and either dynamic client registration or Client ID Metadata Documents.
3. In the browser consent screen, check the requesting client and return destination, paste your **Personal API key**, and click **Connect and allow**. Do not use a Garmin password or short-lived access token.
4. Optionally enable women’s health access. Those two tools are absent without this permission.

For clients that accept MCP JSON configuration, the remote server entry usually looks like this (the exact schema depends on your client):

```json
{
  "mcpServers": {
    "garmin": {
      "url": "https://garmin-mcp.aranlucas.workers.dev/mcp"
    }
  }
}
```

The server supports the current MCP per-request protocol and stateless 2025 Streamable HTTP clients. It does not implement the obsolete HTTP+SSE `/sse` transport.

## How authentication works

Garmin’s Personal API uses a self-generated key, **not a Garmin authorization-code redirect**. The consent screen here is the MCP server’s own OAuth flow:

1. The MCP client starts OAuth, opens the browser, and presents its identity, return destination, and permissions.
2. The browser posts your Garmin key over HTTPS to this Worker. Cloudflare’s library binds the consent transaction to that browser, validates PKCE, and encrypts the key in the OAuth grant in KV. The key is verified with Garmin before a grant is saved.
3. The assistant receives a separate MCP bearer token. The Worker decrypts the grant and exchanges the Garmin key for a Garmin access token when a data tool runs. Garmin credentials never appear in tool results.

Garmin’s access tokens last up to 24 hours; Garmin supports no refresh token for Personal API access. This implementation obtains a new Garmin token per data-bearing MCP request, shares it within that request, and does not persist it. MCP access tokens last one hour. Clients requesting `offline_access` can refresh their MCP session for up to 30 days. When a Garmin key expires, reconnect with a replacement key.

The key is encrypted at rest by the OAuth library, but the Worker must decrypt it to call Garmin. Use a deployment you trust. Health responses are not saved in KV. Logging avoids credentials and upstream payloads; Worker invocation URL logs are disabled.

## Tools

The tools follow Garmin’s published [Personal API schema](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/), not undocumented website endpoints. There are **24 standard tools and 2 optional women’s health tools**:

| Data | Tools |
| --- | --- |
| Activities | `list_activities`, `get_activity`, `get_activity_workouts`, `download_activity_file`, `get_wellness_activities` |
| Daily health | `get_daily_summary`, `get_daily_summaries`, `get_steps`, `get_stress`, `get_hydration`, `get_body_battery` |
| Sleep and recovery | `get_sleep`, `get_sleep_range`, `get_hrv`, `get_hrv_range` |
| Heart rate and fitness | `get_heart_rate`, `get_heart_rate_zones`, `get_fitness_age`, `get_spo2_acclimation` |
| Weight and nutrition | `get_weight_measurements`, `get_weight_range`, `get_weight_goals`, `get_nutrition` |
| Profile | `get_profile` |
| Separate consent | `get_menstrual_summary`, `get_menstrual_day` |

Dates use `YYYY-MM-DD`. Daily date range tools accept at most 31 calendar days per call; split larger requests. `list_activities` date filters are not capped because results are paged at up to 100 items per call. JSON responses are capped at 1 MiB, and original activity downloads at 2 MiB. Downloads return base64 and the upstream media type; Garmin may return a FIT archive. These are local safety limits, not claims about Garmin’s API quotas or history retention.

No workout uploads, activity editing, course publishing, or arbitrary HTTP proxy tool is exposed. An activity’s associated workouts can be read. Availability of metrics and historical records depends on your Garmin account, device, and Garmin’s API.

## Disconnect

- Delete the key in [Garmin Connect](https://connect.garmin.com/app/settings/personalApiToken) to stop Garmin access. Garmin says deletion also invalidates associated access tokens.
- Revoke the MCP **refresh token** using the advertised OAuth `revocation_endpoint` to revoke the whole grant, then remove the connector from your client. Revoking just an access token does not revoke the entire refreshable session.
- The deployment’s [privacy page](https://garmin-mcp.aranlucas.workers.dev/privacy) explains storage. Deleting the upstream key does not itself erase the encrypted MCP grant; it expires or can be revoked. The owner can erase the dedicated KV namespace to remove every authorization record.

## Develop and deploy

Requires Node 24+ and npm. No Garmin secret belongs in `.env`, source, Wrangler variables, MCP config, or this chat. Enter it through the consent page.

```sh
npm ci
npm run typegen
npm run check
npm run build
npm run deploy
npm run smoke
```

`npm run check` type-checks and runs tests inside the Cloudflare Workers runtime with **local isolated KV** and mocked outbound Garmin calls. `npm run build` runs Wrangler’s packaging dry run. `npm run smoke` checks the live deployment: health, protected MCP access, OAuth discovery, client registration, browser-bound consent, and deny. It creates an expiring smoke-test OAuth client, never a Garmin grant.

For another Cloudflare account, change `account_id` and `PUBLIC_URL` in `wrangler.jsonc`, create your own KV namespace with `npx wrangler kv namespace create garmin-mcp-oauth`, replace the binding ID, and regenerate types. `PUBLIC_URL` must exactly match the Worker’s canonical origin; tokens are bound to `${PUBLIC_URL}/mcp`.

For local interactive development, run `npm run dev -- --var PUBLIC_URL:http://localhost:8787`. The OAuth library uses `Secure`, `__Host-` consent cookies, so use a localhost-capable browser or an HTTPS development origin for browser testing. The automated tests exercise the complete authorization flow without relying on a browser’s localhost cookie policy.

## Verification and research

The test suite exercises an SDK client end to end, encrypted grant storage, browser binding, PKCE, denied/forged/replayed consent, scoped tool exposure, refresh/revocation, date validation, bounded responses, and redacted upstream errors. **Live Garmin reads remain unverified until a real key is entered through consent.** Garmin’s public token instructions do not publish a response schema; the adapter accepts the standard `access_token` and Garmin-style `accessToken` field names and fails closed for other payloads.

See [the research and source links](docs/research.md) for the new access plans, existing integrations, architectural choices, and remaining uncertainties. [The OpenAPI snapshot](docs/garmin-personal-openapi.json) was extracted from Garmin’s public Swagger page on 2026-10-21. Data supplied by Garmin Connect. Independent project, not affiliated with Garmin.
