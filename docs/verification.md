# Verification — 2026-10-23

The merged connector is deployed at `https://garmin-mcp.aranlucas.workers.dev/mcp`. Its Auth issuer is `https://auth.aranlucas.workers.dev/api/auth`.

## Automated checks

- Connector: `pnpm check` — TypeScript, lint, formatting, and 95 Worker tests pass. These cover Training contracts, real MCP protocol reads/deletion, JWT audience/issuer/scope/expiry, retired endpoints, HTTP push receipt, account isolation, summary replacement, permission changes, retention alarms, and persistence across Durable Object eviction.
- Auth: `pnpm check`, `pnpm lint`, `pnpm format:check`, and `pnpm test` — 75 tests pass. Garmin coverage includes native Better Auth linking, S256/state, encrypted credentials, sign-in method protection, combined-provider continuation, grant revocation, and eight concurrent real Durable Object RPC calls sharing one rotating Garmin refresh.
- Production: `pnpm smoke` — three tests pass for protected-resource discovery, Auth registration, keyless setup/privacy/branding, and retired issuers.

## Live checks

Chrome completed the shared Auth → Garmin → Auth consent flow with Activities, Daily Health Stats, and Training enabled. Garmin is shown as a linked account in Auth. The app callback is Auth's `/api/auth/callback/garmin`.

The `training-live` Vitest project passed Auth refresh, the 12-tool catalog, permission-checked Health/Activity reads, and all nine workout/calendar operations. It created a clearly named 60-second workout, read and edited it, scheduled it, read/listed and moved the calendar entry, then deleted both fixtures and verified no matching calendar entries remained on either date. Its temporary Auth refresh grant was revoked, and another refresh was rejected.

The `push-live` project passed authenticated receipt and duplicate acceptance on the production deployment with an isolated synthetic user ID, invalid-credential and invalid-category rejection, and authenticated fixture cleanup. The test's private cleanup journal records completion.

## Observational limits

Health/Activity reads for the signed-in account returned no received records. The receiver is configured for 15 Health categories, four Activity categories, and both common notifications. Actual device-derived summary delivery remains pending the first post-link Garmin sync; the production fixture test originates from the test runner, not Garmin. Garmin's generator rejects synthetic IDs that are not linked to the app. Starter offers no historical backfill.

Physical watch receipt was not observed. A real near-expiry Garmin token refresh was not forced; native Better Auth refresh rotation and serialization were verified under Miniflare with controlled provider responses. Workout API success confirms Garmin Connect operations, not physical device delivery.
