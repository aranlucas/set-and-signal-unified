# Verification

The merged connector is deployed at `https://garmin-mcp.aranlucas.workers.dev/mcp`. Its Auth issuer is `https://auth.aranlucas.workers.dev/api/auth`.

## Retention update — 2026-10-24

Removed automatic 90-day expiry after reviewing Garmin's current Rev H agreement and Personal API supplemental terms. The agreement's Annex A(f)(vii) describes account-lifetime retention or an earlier deletion request; section 15.4 preserves consent and data-subject controls. The connector retains explicit deletion, disconnect, and sharing-permission withdrawal behavior. Legacy cleanup alarms cancel themselves without deleting records or rescheduling.

The combined deployment passed `pnpm check` with 105 Worker tests, including old delivery timestamps, persistence across eviction, legacy alarm handling, and deletion controls. All three production smoke checks pass. Post-deployment MCP reads preserve imported history and return the new no-expiration metadata.

Verified production version: `9662d633-02e4-40d9-9816-d24a11ceedff`. Other sections record earlier verification runs.

## Webhook URL migration — 2026-10-24

The webhook migration was deployed at `/webhook/garmin/<GARMIN_PUSH_TOKEN>` in Worker version `e092259e-ca4b-41c3-897f-0a337dd57138`. The subsequent retention deployment above preserved this route. Garmin's API Tools successfully saved all 21 configured URLs in this format. Reading the configuration after a fresh navigation confirmed the full credential-bearing paths persisted. Enabled and on-hold flags were unchanged; activity-file delivery remains disabled. The original `/garmin/push/<GARMIN_PUSH_TOKEN>` route still accepts deliveries for compatibility.

The initially proposed `/webhook/garmin?token=...` format worked against the receiver, but Garmin's configuration tool silently discarded the query string on save. A fresh read confirmed it was absent. The original working URLs were immediately restored before deploying and configuring the path-credential alternative. The receiver continues to reject credential-free delivery; the query-token route is not supported in the final implementation.

The initial webhook checks passed with 104 Worker tests, including authenticated persistence through both routes and rejection of missing/incorrect path credentials or a query token alone. After rebasing onto the merged import and retention changes, `pnpm check` passed with 111 Worker tests; the production build and API-generation check also passed. `pnpm smoke` passed all three production checks. The opt-in `push-live` test passed on the new path with an isolated synthetic user ID: authenticated delivery, duplicate acceptance, invalid-credential and invalid-category rejection, and fixture cleanup. Its temporary secret file and cleanup journal were removed. This verifies receiver behavior and saved Garmin configuration, not a new device-originated delivery.

## Token exchange — 2026-10-24

The opt-in `exchange-live` Vitest project passed against the deployed Auth and Garmin MCP services. A temporary confidential client requested only `garmin:access`, with authorization-code and RFC 8693 exchange grants. The existing Garmin-linked account completed native PKCE and consent. No refresh grant was requested or refresh token issued.

The test exchanged the resulting Auth access token at `/api/auth/oauth2/token`, verified both tokens against Auth's public JWKS, and checked the exact Garmin audience, scope, user/session/reference preservation, and expiry bounded by the subject token. The exchange response contained no refresh or ID token. The exchanged token successfully initialized MCP and listed the deployed tool catalog, including Training and Health/Activity tools. The initial run stopped at tool listing.

The subsequent retry used a fresh temporary client and extended `exchange-live` to invoke the read-only `list_workout_schedules` tool. This calls Garmin's `/partner-gateway/rest/user/permissions`, requires `WORKOUT_IMPORT`, and fetches `/training-api/schedule?startDate=2026-10-24&endDate=2026-10-24`. The tool succeeded and returned a validated empty calendar array (0 entries). The test passed again with verbose output confirming the date and count. This verifies an actual upstream Garmin read through the exchanged Auth token and private broker. It does not imply an empty activity history. No Garmin data was created, edited, or deleted.

The temporary client was deleted through Auth's native client-management API; a subsequent lookup returned HTTP 404 `client not found`. The private credential file and its directory were removed. Locally verified access JWTs retain their normal short expiry; client deletion is not evidence of immediate JWT invalidation at the resource server.

The connector's existing JWT verifier and `GarminTokens` service binding required no runtime changes. Production discovery already advertised `https://auth.aranlucas.workers.dev/api/auth`, and Auth advertised the token-exchange grant. `pnpm check` passes with 100 Worker tests, including five cases matching exchanged-token claims. The live exchange test runs separately and requires a fresh private fixture.

## Automated checks

- Connector: `pnpm check` — TypeScript, lint, formatting, and 95 Worker tests pass. These cover Training contracts, real MCP protocol reads/deletion, JWT audience/issuer/scope/expiry, retired endpoints, HTTP push receipt, account isolation, summary replacement, permission changes, retention alarms, and persistence across Durable Object eviction.
- Auth: `pnpm check`, `pnpm lint`, `pnpm format:check`, and `pnpm test` — 75 tests pass. Garmin coverage includes native Better Auth linking, S256/state, encrypted credentials, sign-in method protection, combined-provider continuation, grant revocation, and eight concurrent real Durable Object RPC calls sharing one rotating Garmin refresh.
- Production: `pnpm smoke` — three tests pass for protected-resource discovery, Auth registration, keyless setup/privacy/branding, and retired issuers.

## Live checks

The real-account workout lifecycle test was removed on October 24, 2026, after two deleted test fixtures remained as broken home-page cards. Garmin's summary API still returned the cards while the referenced workout and schedule endpoints returned 404, including schedule deletion. Workout mutation coverage now uses mocked Garmin responses; live Training API verification uses the read-only `exchange-live` calendar check. Do not create real-account workout fixtures for testing. The lifecycle result below is a historical record, not a current test command.

Chrome completed the shared Auth → Garmin → Auth consent flow with Activities, Daily Health Stats, and Training enabled. Garmin is shown as a linked account in Auth. The app callback is Auth's `/api/auth/callback/garmin`.

The `training-live` Vitest project passed Auth refresh, the 12-tool catalog, permission-checked Health/Activity reads, and all nine workout/calendar operations. It created a clearly named 60-second workout, read and edited it, scheduled it, read/listed and moved the calendar entry, then deleted both fixtures and verified no matching calendar entries remained on either date. Its temporary Auth refresh grant was revoked, and another refresh was rejected.

The `push-live` project passed authenticated receipt and duplicate acceptance on the production deployment with an isolated synthetic user ID, invalid-credential and invalid-category rejection, and authenticated fixture cleanup. The test's private cleanup journal records completion.

## Observational limits

Health/Activity reads for the signed-in account returned no received records. The receiver is configured for 15 Health categories, four Activity categories, and both common notifications. Actual device-derived summary delivery remains pending the first post-link Garmin sync; the production fixture test originates from the test runner, not Garmin. Garmin's generator rejects synthetic IDs that are not linked to the app. Starter offers no historical backfill.

Physical watch receipt was not observed. A real near-expiry Garmin token refresh was not forced; native Better Auth refresh rotation and serialization were verified under Miniflare with controlled provider responses. Workout API success confirms Garmin Connect operations, not physical device delivery.
