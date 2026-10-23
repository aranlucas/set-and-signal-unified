<img src="assets/icon.svg" width="64" height="64" alt="">

# Garmin Personal MCP

A read-only MCP server for Garmin’s **official Personal API**, deployed on Cloudflare Workers. Built with TypeScript MCP SDK **v2.3.1** (`@modelcontextprotocol/server`), Zod 4, and Cloudflare’s OAuth provider. Dependencies are pinned in `pnpm-lock.yaml`.

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

| Data                   | Tools                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Activities             | `list_activities`, `get_activity`, `get_activity_workouts`, `download_activity_file`, `get_wellness_activities` |
| Daily health           | `get_daily_summary`, `get_daily_summaries`, `get_steps`, `get_stress`, `get_hydration`, `get_body_battery`      |
| Sleep and recovery     | `get_sleep`, `get_sleep_range`, `get_hrv`, `get_hrv_range`                                                      |
| Heart rate and fitness | `get_heart_rate`, `get_heart_rate_zones`, `get_fitness_age`, `get_spo2_acclimation`                             |
| Weight and nutrition   | `get_weight_measurements`, `get_weight_range`, `get_weight_goals`, `get_nutrition`                              |
| Profile                | `get_profile`                                                                                                   |
| Separate consent       | `get_menstrual_summary`, `get_menstrual_day`                                                                    |

Dates use `YYYY-MM-DD`. Daily date range tools accept at most 31 calendar days per call; split larger requests. `list_activities` date filters are not capped because results are paged at up to 100 items per call. JSON responses are capped at 1 MiB, and original activity downloads at 2 MiB. Downloads return base64 and the upstream media type; Garmin may return a FIT archive. These are local safety limits, not claims about Garmin’s API quotas or history retention.

Every tool returns `{ source: "Garmin Connect", data }` in both `structuredContent` and a JSON text block. Response schemas stay inside the Garmin client; MCP tool definitions expose input schemas and annotations. Garmin responses are validated against models generated from the published API snapshot. Documented fields retain their types and optionality; additional fields are preserved. Invalid responses produce a safe tool error without including upstream values or Zod error details.

The Personal endpoint exposes no workout uploads, activity editing, course publishing, or arbitrary HTTP proxy. An activity’s associated workouts can be read. Availability of metrics and historical records depends on your Garmin account, device, and Garmin’s API.

## Optional business workout publishing

This branch adds a separate, **experimental and default-off** business Training API integration at `/training/mcp`. It uses Garmin sign-in and its own OAuth issuer, consent, write scope, and encrypted token grants. The existing `/mcp` endpoint continues to use Personal API keys.

The intended flow is `create_workout` → `schedule_workout` → sync Garmin Connect with the watch. Read-back tools are `get_workout`, `get_workout_schedule`, and `list_workout_schedules`. A successful publish or schedule does **not** confirm delivery to a watch.

Set `GARMIN_TRAINING_ENABLED=true` and `GARMIN_TRAINING_CLIENT_ID` to opt in, then install `GARMIN_TRAINING_CLIENT_SECRET` as a Worker secret. Missing credentials fail closed. The detailed Training API wire contract still needs verification against an approved application's developer-portal reference and a live device test. See [business setup, examples, and contract assumptions](docs/garmin-training.md) before enabling it.

## Disconnect

- Delete the key in [Garmin Connect](https://connect.garmin.com/app/settings/personalApiToken) to stop Garmin access. Garmin says deletion also invalidates associated access tokens.
- Revoke the MCP **refresh token** using the advertised OAuth `revocation_endpoint` to revoke the whole grant, then remove the connector from your client. Revoking just an access token does not revoke the entire refreshable session.
- The deployment’s [privacy page](https://garmin-mcp.aranlucas.workers.dev/privacy) explains storage. Deleting the upstream key does not itself erase the encrypted MCP grant; it expires or can be revoked. The owner can erase the dedicated KV namespace to remove every authorization record.

## Develop and deploy

Requires Node 24.22+ (pinned in `.node-version`) and pnpm (pinned in `packageManager`). Deployment uses Cloudflare’s [`cf` CLI](https://developers.cloudflare.com/cf/) with `cloudflare.config.ts`. No Garmin secret belongs in `.env`, source, config variables, MCP config, or this chat. Enter it through the consent page.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm run deploy
pnpm run smoke
```

`pnpm run check` type-checks, lints and format-checks with [Oxforge](https://www.npmjs.com/package/@aranlucas/oxforge) (Oxlint and Oxfmt), and runs tests inside the Cloudflare Workers runtime with **local isolated KV** and mocked outbound Garmin calls. `pnpm run typecheck` regenerates `.cloudflare/types` from `cloudflare.config.ts` before `tsc`. `pnpm run build` invokes Vite and the Cloudflare Vite plugin directly; `pnpm run deploy` builds and passes the output to `cf deploy --prebuilt`. Use `pnpm exec cf deploy --prebuilt --dry-run` after building to check the upload and bindings without deploying. `pnpm run smoke` checks the live deployment: health, protected MCP access, OAuth discovery, client registration, browser-bound consent, and deny. It creates an expiring smoke-test OAuth client, never a Garmin grant; set `SMOKE_URL` to check another deployment.

Pushes deploy through Cloudflare Workers Builds: every build runs `pnpm run check`, then `main` runs `pnpm exec vite build && pnpm exec cf deploy --prebuilt` and other branches run `CLOUDFLARE_PREVIEW_BUILD=true pnpm exec vite build && pnpm exec cf previews deploy --prebuilt`. These explicit Vite commands avoid the current `cf` CLI misidentifying Hono and the code-generation workspace as additional application frameworks. Locally, `pnpm run deploy:preview` uses the same preview build and deploy commands. Previews use the separate `garmin-mcp-preview-oauth` KV namespace (`isPreview` in `cloudflare.config.ts`) and keep the production `PUBLIC_URL`, so they validate the upload but are not a working OAuth origin.

For another Cloudflare account, change `accountId` and `PUBLIC_URL` in `cloudflare.config.ts`, create your own KV namespace with `pnpm exec cf kv namespaces create`, replace the `OAUTH_KV` ID, and regenerate types. `PUBLIC_URL` must exactly match the Worker’s canonical origin; tokens are bound to `${PUBLIC_URL}/mcp`.

For local interactive development, run `pnpm run dev`. Use `pnpm run lint:fix` and `pnpm run format` to apply fixes. `pnpm run dev` uses Vite in development mode, which sets `PUBLIC_URL` to `http://localhost:5173`; `vite.config.ts` pins that port. The OAuth library uses `Secure`, `__Host-` consent cookies, so use a localhost-capable browser or an HTTPS development origin for browser testing. The automated tests exercise the complete authorization flow without relying on a browser’s localhost cookie policy.

Page templates live in `src/pages/*.tsx`, with shared document, public-site, and consent layouts in `layout.tsx`. `src/pages.tsx` renders them to HTML strings using [Hono JSX](https://hono.dev/docs/guides/jsx), which escapes dynamic text and attributes without adding browser JavaScript. Only the trusted CSS imports bypass escaping; request handlers continue to own security headers. The regular `hono` package serves the public and consent routes. The official [`@modelcontextprotocol/hono` adapter](https://ts.sdk.modelcontextprotocol.io/v2/serving/hono.html) mounts the MCP handler after Cloudflare’s OAuth provider authenticates the request, forwards the parsed JSON body to the SDK handler, and enforces the existing 64 KiB request limit.

Tool inputs are direct Zod declarations in `src/endpoints.ts`. `GarminClient.get(schema, path, signal)` validates JSON and infers its return type from the schema; `download(path, signal)` returns a typed base64 file. Both propagate MCP cancellation to Garmin. The small JSON fetch implementation follows the schema-first concept from `zod-fetch` and is kept inline.

Run `pnpm run generate:api` after updating `docs/garmin-personal-openapi.json`. [Hey API’s Zod plugin](https://heyapi.dev/docs/openapi/typescript/plugins/zod) generates `src/garmin-api/zod.gen.ts` and formats it with the existing Oxfmt configuration; do not edit that file manually. The `codegen` workspace isolates the generator and its TypeScript 6 compiler API dependency. The application and tests use TypeScript **7.1.0-beta** with strict indexed access, exact optional properties, explicit overrides, and return-path checks. See the [code quality audit](docs/code-quality.md) for the decisions and sources.

## Verification and research

The test suite exercises an SDK client end to end, encrypted grant storage, browser binding, PKCE, denied/forged/replayed consent, scoped tool exposure, refresh/revocation, input contracts for all 26 published paths, typed response validation, structured MCP results, cancellation, bounded responses, and redacted upstream errors. **Live Garmin reads remain unverified until a real key is entered through consent.** Garmin’s public token instructions do not publish a response schema; the adapter accepts the standard `access_token` and Garmin-style `accessToken` field names and fails closed for other payloads.

See [the research and source links](docs/research.md) for the new access plans, existing integrations, architectural choices, and remaining uncertainties. [The OpenAPI snapshot](docs/garmin-personal-openapi.json) was extracted from Garmin’s public Swagger page on 2026-10-21. Data supplied by Garmin Connect. Independent project, not affiliated with Garmin.
