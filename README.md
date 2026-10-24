# Garmin MCP

One Garmin connector using the shared [Auth service](https://auth.aranlucas.workers.dev). Sign into Auth and link Garmin; no Personal API key is accepted or required.

Add this remote HTTP connector with OAuth authentication:

```text
https://garmin-mcp.aranlucas.workers.dev/mcp
```

Auth handles client registration, PKCE, consent, access/refresh tokens, and Garmin account linking. The Garmin callback is `https://auth.aranlucas.workers.dev/api/auth/callback/garmin`. Existing Personal and Training connections must be removed and connected again at `/mcp`; their issuers and grants are retired. `/training/mcp`, `/authorize`, and the old local token/registration endpoints are no longer served.

## Account resource

`resources/list` advertises the read-only `garmin://account` resource with MIME type `application/json`. Read it through `resources/read` with `{"uri":"garmin://account"}` to obtain `{"userId":"<immutable Garmin User ID>"}`. This is Garmin's `userID` for developer-portal requests such as an Activity File resend, not the Auth subject, display name, email address, activity ID, or a credential.

The resource uses the linked account identity already validated by the authenticated `/mcp` request. The existing Auth broker check still runs on every request and may refresh an expired Garmin credential; reading this resource adds no further token lookup or Garmin API call. It accepts no account selector and returns no access tokens, refresh tokens, or other profile fields. MCP result cache hints specify private scope and a zero cache lifetime. Unauthenticated requests, invalid credentials, and disconnected accounts receive HTTP 401; a server without linked-account identity returns a fixed resource-unavailable error rather than an empty or guessed ID. Reconnect Garmin in Auth if the account is unavailable.

## Tools and data availability

- Nine Training tools: create/get/update/delete workout; schedule/get/update/delete calendar entry; list calendar entries.
- `list_garmin_summaries`: paginate Health/Activity push summaries by category and a date range of at most 31 days.
- `get_garmin_summary`: retrieve a received record by category and summary ID.
- `get_garmin_day`: gather one date's Health summaries and Activity references across all categories, with per-category availability and pagination.
- `get_garmin_activity`: retrieve a stored activity by Garmin activity ID, combining its summary, JSON details, and all automatically decoded FIT messages and fields.
- Activity reads through `get_garmin_summary` also include the complete decoded FIT payload under `fit` when the record has an `activityId`.
- `delete_stored_garmin_data`: delete this connector's retained Health/Activity data after explicit confirmation.

Health categories include dailies (steps and daily heart rate), epochs, sleeps, bodyComps, stressDetails, userMetrics, pulseox, allDayRespiration, healthSnapshot, hrv, bloodPressures, skinTemp, nutrition, hydration, and breathingVariations. Activity categories include activities, activityDetails, manuallyUpdatedActivities, and moveIQActivities. Responses use Garmin's approved push models, rather than the retired Personal API response models.

**Garmin Starter has no automatic historical backfill.** Summaries start arriving after the user authorizes sharing and syncs their device. Empty results mean no received records, not zero activity. Stored records have no automatic expiration: users can delete stored data, disconnect Garmin, or withdraw sharing permissions to remove the affected records. The connector downloads only FIT files announced through Garmin’s Activity API delivery. Profile/settings, goals, fitness age, and women's health tools from the Personal API are not exposed.

Workout mutations require user approval of details and dates. Do not repeat an ambiguous write automatically. A successful schedule operation does not confirm watch delivery.

### Read a day's data

Call `get_garmin_day` with:

```json
{ "date": "2026-10-23", "limitPerType": 50 }
```

`limitPerType` is optional (default 50, maximum 100). The result's `data.sections` contains every supported summary category. Health records contain `{ summaryId, receivedAt, summary }`, preserving Garmin's measurement fields and units. Activity records contain `{ summaryId, receivedAt, activityId }`; `activityId` is `null` when Garmin did not supply a valid activity ID. Use `get_garmin_summary` with the section's type and summary ID for the full record, or `get_garmin_activity` with an activity ID for combined activity details and FIT data. The day tool does not download files or embed activity samples.

Each section reports `availability` as `available`, `not_received`, or `permission_denied`. Missing records do not mean zero measurements or activity. Current Health and Activity sharing permissions are checked independently, so an authorized category remains readable when the other is denied. Permission lookup failures return a tool error rather than an empty day.

Records follow the stored Garmin `calendarDate`, or the device-offset local start date when no calendar date was supplied. Receipt timestamps indicate when this connector received the record, not when the measurement happened. Every measurement within the page is preserved; no recovery score or other interpretation is calculated. When a section has `hasMore: true`, continue with `list_garmin_summaries`, passing its type, the requested date as both `startDate` and `endDate`, and `nextOffset` as `offset`.

### Complete activity data from FIT

The JSON `activityDetails` payload is preserved, apart from routing credentials. If Garmin does not include exercises, sets, repetitions, weights, or rest in that payload, the connector cannot reconstruct them from heart-rate samples. This is not a blanket Starter limitation: Garmin's [current program table](https://developer.garmin.com/gc-developer-program/overview/) includes Activity JSON and FIT in Starter, with push-only delivery and no historical data.

Garmin `activityFiles` notifications are accepted by the existing authenticated push receiver. The callback metadata is saved privately in the same account store as the summaries. After the account has made an authenticated MCP request, its Auth identity is available for background retrieval. A durable alarm fetches and decodes pending FIT files automatically, checking the current Auth link and Garmin activity permission. Reads can also finish a pending download. No file export or base64 input is required.

Call `get_garmin_activity` with an `activityId` from `list_garmin_summaries` to get `{ activityId, summary, details, fit }`. Existing `get_garmin_summary` activity reads retain their fields and add `fit`. Files and summaries are associated by Garmin’s explicit `activityId`, including the distinct `-detail` and `-file` summary IDs; suffixes and timestamps are not used to guess a match. The standalone `decode_strength_activity_file` tool has been removed.

Garmin’s Activity API 2.0 reference documents one-use file links that expire after 24 hours. Only the exact HTTPS business API activity-file callback is accepted; redirects are rejected. Downloads use the linked account’s business access token. Callback URLs never appear in tools or logs and are removed on claim or expiry. The complete decoded FIT payload is retained, with the same deletion, disconnect, and permission-withdrawal controls as summaries. Ambiguous download failures are not automatically repeated because the link may already have been consumed.

`fit.messages` contains every SDK-decoded message grouped by its FIT message key, such as `recordMesgs`, `sessionMesgs`, `lapMesgs`, `eventMesgs`, `deviceInfoMesgs`, `setMesgs`, `developerDataIdMesgs`, and `fieldDescriptionMesgs`. No sport-specific whitelist filters the output. Samples, GPS, heart rate, cadence, power, swimming records, workout steps, and any other messages remain available when present. Unknown messages and fields retain numeric keys; developer field definitions accompany their values. Order is preserved within each message type. Profile scale/offset and component/subfield expansion are applied. Timestamps remain FIT epoch seconds, enum values remain numeric profile IDs, coordinates remain semicircles, and 64-bit integers are decimal strings to preserve precision.

The `fit.sets` convenience view returns ordered FIT `set` messages, including explicit active/rest type, repetitions, kilograms, duration in seconds, timestamps where available, and all category/subtype identifiers with known FIT exercise names. Missing or unknown values stay `null`; zero is preserved. Rest is never inferred from gaps, targets are never substituted for recorded performance, and `fit.strengthAvailability` is `no_recorded_sets` for files without sets, not a claim that no strength training happened. FIT exercise identifiers may differ from Garmin Connect's display labels, and an original file may not reflect later Connect edits.

The pinned SDK does not support FIT compressed-timestamp records (distinct from ZIP compression); these are rejected without partial results.

The pinned official [`@garmin/fitsdk`](https://github.com/garmin/fit-javascript-sdk) handles binary decoding, CRC validation, units, and profile mappings. It was chosen over a custom parser because Garmin maintains the format and ships TypeScript declarations. Inputs are bounded to 1 MiB, 25,000 records including definitions, 2,000 sets, and 4,000 exercise entries. Invalid/truncated files, trailing bytes, decoder errors, and limit violations fail without partial results; all SDK-decoded fields are returned, including GPS, device metadata, health samples, unknown fields, and developer fields. Decoded output is limited to 8 MiB and stored in 64 KiB chunks to avoid SQLite value limits.

FIT availability is explicit: `available`, `not_received`, `downloading`, `expired`, `unsupported_file_type`, or an unavailable/download-failure state. Missing sets do not mean no strength training occurred. Existing activities without a delivered file cannot acquire FIT detail through historical backfill. See [FIT verification and operating requirements](docs/strength-activity-files.md).

### Events

Event-capable MCP clients can subscribe to `garmin.activity.completed` (Workout finished), `garmin.sleep.available`, `garmin.body_composition.recorded`, and `garmin.health_snapshot.available`. Every matching authorized subscription receives an independent signed webhook. Workout completion supports sport and minimum-duration filters and fires after Garmin sync. Repeated deliveries, existing records, and historical imports do not create new completion events. Subscriptions, pending deliveries, retries, and expiry persist in the account's Durable Object. [Event setup, delivery semantics, and verification limits](docs/mcp-events.md).

### One-time personal activity import

An operator can fetch their own activities with a Personal API key or access token and deliver normalized summaries through the existing private push endpoint. This is an explicit local import, not Garmin Starter backfill. It adds no public credential-entry endpoint and does not save the Personal credential in the connector. Imported summaries carry `importSource: "garmin-personal-api"` and use Garmin's activity ID as the summary ID, so repeats update the same record. Native Garmin deliveries take precedence over imports. The existing account permission, disconnect, and deletion rules apply; imported records have no automatic expiration.

Prepare a private JSON file outside the repository with `personalApiKey` (or `personalAccessToken`), `garminUserId`, `pushToken`, `expectedActivityId`, `startDate`, and `endDate`. Resolve `garminUserId` from the account's existing Auth Garmin link; do not substitute the numeric Personal API profile ID. Verify `expectedActivityId` in that same user's Garmin Connect account. The importer checks that the activity is present and validates all fetched pages before delivering anything. It imports activity summaries, not detailed samples or other health categories.

```sh
GARMIN_BACKFILL_SETTINGS_FILE=/private/path/backfill.json pnpm exec vitest run --project personal-backfill-live
GARMIN_BACKFILL_SETTINGS_FILE=/private/path/backfill.json GARMIN_BACKFILL_COMMIT=1 pnpm exec vitest run --project personal-backfill-live
```

The first command only fetches and validates. The second imports through the production receiver. Both write a private activity-ID journal beside the settings file. Verify the imported records afterward with `list_garmin_summaries`. Keep both the Personal credential and push credential out of command arguments and logs.

## Architecture

The connector verifies Auth's RS256 access JWTs with exact issuer, `/mcp` audience, expiry, and `garmin:access` scope, using `jose`. Auth stores encrypted Garmin credentials with Better Auth's native generic OAuth plugin. A private `GarminTokens` service binding returns a usable Garmin access token and immutable Garmin user ID. A per-user Durable Object in Auth serializes rotating Garmin refresh tokens and rechecks current linking/banned status before returning a credential.

Auth also supports [RFC 8693 token exchange](https://github.com/sidequest-labs/auth/blob/main/docs/oauth.md#token-exchange-between-auth-resources). An exchanged Auth access token works here when its audience is exactly `https://garmin-mcp.aranlucas.workers.dev/mcp` and its scope includes `garmin:access`. Exchange cannot add scopes absent from the subject token, so an identity-only Auth token cannot gain Garmin access. A service performing exchange needs an operator-provisioned confidential client, the permitted incoming and target resources, and consent. This connector only verifies the resulting token; it needs no exchange client or secret. Exchange does not return Garmin credentials or replace the private `GarminTokens` binding. Direct MCP clients continue using Auth's PKCE authorization and refresh flow.

Garmin push delivery is persisted in one SQLite Durable Object per immutable Garmin user ID. Records are upserted; more complete Health summaries replace earlier summaries for the same start time. Records remain available regardless of their activity or delivery age. Legacy cleanup alarms are canceled without deleting history. Tools cannot choose another user's store. Each Health/Activity read checks current Garmin permissions. Deregistration purges records and blocks late retries; permission changes purge and block only the withdrawn category. Reconnecting through Auth starts collection again.

Retention was checked against the [current Garmin Connect Developer License Agreement, Rev H](https://developerportal.garmin.com/sites/default/files/Garmin%20Connect%20Developer%20License%20Agreement%20-%20Rev%20H.pdf) on October 24, 2026. Annex A(f)(vii) describes retention for the account lifetime or until a deletion request, whichever comes first; section 15.4 requires consent and data-subject controls. Neither that agreement nor the Personal API supplemental terms reviewed requires a fixed 90-day limit. The connector's former limit was an application choice.

Garmin's endpoint configuration supports URLs, without a custom authentication-header field. Configure the private delivery URL as `https://garmin-mcp.aranlucas.workers.dev/webhook/garmin/<GARMIN_PUSH_TOKEN>`. The configuration tool discards query parameters when saving endpoint URLs, so a `?token=...` credential cannot be used. The token is an HMAC credential derived from the Garmin app secret with the fixed context `garmin-mcp/push/v1`; it is a static delivery credential, not a signature over the request body. Keep the entire configured URL private. The server validates the token with constant-time comparison. The previous `/garmin/push/<GARMIN_PUSH_TOKEN>` route remains supported for existing configurations and queued deliveries. Do not use the public client ID as authentication. Delivery credentials and callback URLs are stripped from returned data. The service disables automatic invocation logs and URL tracing, and logs only fixed operational event names.

Other webhook providers can have separate `/webhook/<source>` routes with their own authentication and payload validation. This Garmin receiver accepts only Garmin payloads. MCP messages and event subscription methods use the authenticated `/mcp` transport. Outgoing MCP Events use each subscribed client's verified HTTPS callback.

Auth's Disconnect action calls Garmin's required `DELETE /partner-gateway/rest/user/registration`, purges retained summaries via an authenticated server request, and removes the linked account. Removing only an MCP client stops that client's access; disconnect Garmin to stop collection. Review [privacy and AI processing](https://garmin-mcp.aranlucas.workers.dev/privacy) before connecting an assistant.

## Configuration and development

The shared Auth implementation is [sidequest-labs/auth](https://github.com/sidequest-labs/auth). Auth requires `GARMIN_CLIENT_ID`, private `GARMIN_CLIENT_SECRET`, `GARMIN_MCP_RESOURCE`, the `GarminTokens` RPC export, and its `GARMIN_BROKER` binding. The connector uses `AUTH_ISSUER=https://auth.aranlucas.workers.dev/api/auth` (the issuer includes `/api/auth`), an `AUTH` binding to the `auth` Worker's `GarminTokens` export, `USER_DATA`, and the private `GARMIN_PUSH_TOKEN`. Application credentials are server configuration, never user-supplied API keys.

Use Garmin's API Configuration Tool to enable Health, Activity, and Training. Configure the supported push categories and both common notification endpoints with the private delivery URL. Enable Activity Files delivery to the same private URL to collect complete FIT activity data automatically. Ordinary summary ping/pull delivery remains unsupported. Make one authenticated MCP request after deploying this version so the account’s existing Auth link is bound for background file retrieval.

```sh
pnpm install
pnpm check
pnpm build
pnpm deploy
pnpm smoke
```

`pnpm check` runs Worker type generation, TypeScript, Oxlint, formatting, and Worker tests. The Cloudflare Vitest project provides fake secrets and a local store; it never uses production data. `jose` is a direct dependency for maintained, typed JWT/JWKS verification; Better Auth owns authorization and consent in the shared Auth service. MCP transport/registration uses `@modelcontextprotocol/server`, and inputs/provider payloads use Zod.

Workout and schedule mutations are tested with mocked Garmin responses in the Worker suite. Do not create workouts or calendar entries in a real Garmin account for testing. The former `training-live` lifecycle test was removed after deleted fixtures left broken cards in Garmin Connect's home-page summaries. Use the read-only `exchange-live` test below for live Training API verification.

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
