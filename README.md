# Garmin MCP

One Garmin connector using the shared [Auth service](https://auth.aranlucas.workers.dev). Sign into Auth and link Garmin; no Personal API key is accepted or required.

Add this remote HTTP connector with OAuth authentication:

```text
https://garmin-mcp.aranlucas.workers.dev/mcp
```

Auth handles client registration, PKCE, consent, access/refresh tokens, and Garmin account linking. The Garmin callback is `https://auth.aranlucas.workers.dev/api/auth/callback/garmin`. Existing Personal and Training connections must be removed and connected again at `/mcp`; their issuers and grants are retired. `/training/mcp`, `/authorize`, and the old local token/registration endpoints are no longer served.

## Tools and data availability

- Nine Training tools: create/get/update/delete workout; schedule/get/update/delete calendar entry; list calendar entries.
- `list_garmin_summaries`: paginate Health/Activity push summaries by category and a date range of at most 31 days.
- `get_garmin_summary`: retrieve a received record by category and summary ID.
- `delete_stored_garmin_data`: delete this connector's retained Health/Activity data after explicit confirmation.

Health categories include dailies (steps and daily heart rate), epochs, sleeps, bodyComps, stressDetails, userMetrics, pulseox, allDayRespiration, healthSnapshot, hrv, bloodPressures, skinTemp, nutrition, hydration, and breathingVariations. Activity categories include activities, activityDetails, manuallyUpdatedActivities, and moveIQActivities. Responses use Garmin's approved push models, rather than the retired Personal API response models.

**Garmin Starter has no historical backfill.** Summaries start arriving after the user authorizes sharing and syncs their device. Empty results mean no received records, not zero activity. Records expire 90 days after their latest accepted delivery. Original activity-file downloads, profile/settings, goals, fitness age, and women's health tools from the Personal API are not exposed by this connector.

Workout mutations require user approval of details and dates. Do not repeat an ambiguous write automatically. A successful schedule operation does not confirm watch delivery.

## Architecture

The connector verifies Auth's RS256 access JWTs with exact issuer, `/mcp` audience, expiry, and `garmin:access` scope, using `jose`. Auth stores encrypted Garmin credentials with Better Auth's native generic OAuth plugin. A private `GarminTokens` service binding returns a usable Garmin access token and immutable Garmin user ID. A per-user Durable Object in Auth serializes rotating Garmin refresh tokens and rechecks current linking/banned status before returning a credential.

Auth also supports [RFC 8693 token exchange](https://github.com/sidequest-labs/auth/blob/main/docs/oauth.md#token-exchange-between-auth-resources). An exchanged Auth access token works here when its audience is exactly `https://garmin-mcp.aranlucas.workers.dev/mcp` and its scope includes `garmin:access`. Exchange cannot add scopes absent from the subject token, so an identity-only Auth token cannot gain Garmin access. A service performing exchange needs an operator-provisioned confidential client, the permitted incoming and target resources, and consent. This connector only verifies the resulting token; it needs no exchange client or secret. Exchange does not return Garmin credentials or replace the private `GarminTokens` binding. Direct MCP clients continue using Auth's PKCE authorization and refresh flow.

Garmin push delivery is persisted in one SQLite Durable Object per immutable Garmin user ID. Records are upserted; more complete Health summaries replace earlier summaries for the same start time. A daily alarm deletes expired records, and reads also exclude them immediately. Tools cannot choose another user's store. Each Health/Activity read checks current Garmin permissions. Deregistration purges records and blocks late retries; permission changes purge and block only the withdrawn category. Reconnecting through Auth starts collection again.

Garmin's endpoint configuration supports URLs, without a custom authentication-header field. The private delivery URL contains an HMAC credential derived from the Garmin app secret with the fixed context `garmin-mcp/push/v1`. Keep that configured URL private. The server validates it with constant-time comparison. Do not use the public client ID as authentication. Delivery credentials and callback URLs are stripped from returned data. The service disables automatic invocation logs and URL tracing, and logs only fixed operational event names.

Auth's Disconnect action calls Garmin's required `DELETE /partner-gateway/rest/user/registration`, purges retained summaries via an authenticated server request, and removes the linked account. Removing only an MCP client stops that client's access; disconnect Garmin to stop collection. Review [privacy and AI processing](https://garmin-mcp.aranlucas.workers.dev/privacy) before connecting an assistant.

## Configuration and development

The shared Auth implementation is [sidequest-labs/auth](https://github.com/sidequest-labs/auth). Auth requires `GARMIN_CLIENT_ID`, private `GARMIN_CLIENT_SECRET`, `GARMIN_MCP_RESOURCE`, the `GarminTokens` RPC export, and its `GARMIN_BROKER` binding. The connector uses `AUTH_ISSUER=https://auth.aranlucas.workers.dev/api/auth` (the issuer includes `/api/auth`), an `AUTH` binding to the `auth` Worker's `GarminTokens` export, `USER_DATA`, and the private `GARMIN_PUSH_TOKEN`. Application credentials are server configuration, never user-supplied API keys.

Use Garmin's API Configuration Tool to enable Health, Activity, and Training. Configure the supported push categories and both common notification endpoints with the private delivery URL. Do not configure ping or activity-file delivery: the receiver deliberately does not fetch callback URLs.

```sh
pnpm install
pnpm check
pnpm build
pnpm deploy
pnpm smoke
```

`pnpm check` runs Worker type generation, TypeScript, Oxlint, formatting, and Worker tests. The Cloudflare Vitest project provides fake secrets and a local store; it never uses production data. `jose` is a direct dependency for maintained, typed JWT/JWKS verification; Better Auth owns authorization and consent in the shared Auth service. MCP transport/registration uses `@modelcontextprotocol/server`, and inputs/provider payloads use Zod.

For the opt-in real-account lifecycle test, prepare a private session file outside the repository containing `base`, `issuer`, `clientId`, and `refreshToken` through the real browser OAuth flow. Then run:

```sh
GARMIN_E2E_SESSION_FILE=/private/path/session.json pnpm exec vitest run --project training-live
```

The live test creates a clearly named 60-second workout, reads and edits it, schedules and moves it, deletes both fixtures, verifies the two-day calendar is clean, and revokes its test refresh grant. It writes a private cleanup journal beside the session file. Auth access JWTs have a 15-minute lifetime; revoking a refresh grant prevents refresh immediately, while disconnecting Garmin blocks the broker on the next request.

To verify real Auth token exchange and a read-only Garmin API call through the deployed MCP, provision a temporary confidential client in Auth with `client_secret_basic`, `authorization_code` and `urn:ietf:params:oauth:grant-type:token-exchange` grants, the Garmin MCP resource, and `garmin:access` scope. Complete PKCE and consent with that client. Save `base`, `issuer`, `clientId`, `clientSecret`, and the resulting `subjectToken` in a private JSON file outside the repository. Request no refresh grant; the access token expires within 15 minutes.

```sh
GARMIN_E2E_EXCHANGE_FILE=/private/path/exchange.json pnpm exec vitest run --project exchange-live --silent=false --reporter=verbose
```

The test performs the native exchange, checks JWKS signatures, audience, scope, subject/session preservation and expiry, then initializes MCP and lists tools with the exchanged token. It calls `list_workout_schedules` for the current Los Angeles calendar date, which checks Garmin permissions and fetches the Training API calendar. It validates the response and prints only the date and count, keeping workout details, tokens and credentials private. Remove the temporary client through Auth's client-management API and delete the private file afterward.

The isolated production delivery test is also opt-in:

```sh
GARMIN_E2E_PUSH_SECRET_FILE=/private/path/push-secrets.json pnpm exec vitest run --project push-live
```

Its private JSON file contains the configured `GARMIN_PUSH_TOKEN`. The test submits a synthetic Garmin user ID, checks authenticated delivery and duplicate acceptance, rejects invalid delivery, and purges that isolated store in a `finally` block. It never uses the signed-in account's ID. See [verification evidence and limits](docs/verification.md).
