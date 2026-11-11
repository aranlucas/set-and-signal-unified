# Unified product implementation

Published at [aranlucas/set-and-signal-unified](https://github.com/aranlucas/set-and-signal-unified)
on `main`, combining all three audited source histories. Set & Signal contains the
native Android app, web planner, Go account/API/MCP server, shared training
packages, and Garmin connector. Application deployments remain unchanged.

## Application boundaries

| Path                 | Responsibility                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/android`       | Native Expo/Compose Android UI, original offline 5×5 recorder, cached web routines, account history/progress, Garmin review and publishing          |
| `web`                | Web planning, logging, history, progress and built-in Garmin settings                                                                               |
| `packages/training`  | Fivefold policy, exact load conversion, portable completed records, watch workout compiler, FIT review, source reconciliation and persistence codec |
| `packages/exercises` | Generated exercise catalogue shared by native, web tooling and the Go embed                                                                         |
| `internal/training`  | Typed Go/MCP adapters, policy application and completion receipts                                                                                   |
| `internal/garmin`    | Product-owned connector grants, PKCE connection, refresh/revocation and durable publication journal                                                 |
| `apps/garmin`        | Existing Garmin Health/Activity/Training Worker, provider API schemas and FIT parsing                                                               |

The existing shared Auth deployment remains the Garmin credential authority.
The product holds an encrypted, scoped connector grant. Garmin provider tokens
remain behind the connector's private Auth service binding.

## Training and synchronization

Android keeps `fivefold.db`, the original package/scheme, saved active sessions,
rest deadlines, plate inventory, counters and backup compatibility. The original
5×5 path remains available without an account. The new **Plan** tab caches web
strength routines and records their sets locally. Timed/cardio routine recording
remains available on web; the native planned-session recorder states its
strength-only scope before starting an unsupported routine.

Native sign-in uses the product's existing OAuth authorization-code + PKCE flow
in the system browser, including passkey-only deployments. Client registration
is open, so every client, Android included, gets an authorization code only
after the signed-in user approves an `/oauth/consent` page. The page names the
client, where the code will be sent and the requested access. Application session
material is stored with Expo SecureStore. Convex tokens are issued for the same
product owner, and cached records, drafts and queued operations are partitioned
by that owner.

A phone completion commits history, next 5×5 targets and an outbox in one SQLite
transaction. Stable operation IDs survive restart. Convex commits use expected
record values and owner-scoped operation receipts. A replay after a later
history deletion cannot recreate the deleted workout. Received cloud plans are
persisted with a distinct origin so they do not echo into the outbox.

Fivefold remains a separate `fivefold` policy: success increments once, a
skipped set holds the failure count, and the third fully attempted miss can
deload by 10%, floored to the configured increment and bar. The original policy
unit is retained even when the account displays another unit. Per-workout,
per-exercise progression receipts prevent an older retry from applying again
after a newer completion. Shared A/B lifts and the next A/B choice stay aligned.
Existing Set & Signal progression policies keep their established behavior.

The phone-history import is explicit and merges completed records and the
current A/B plan. Stable bindings prevent duplicates and prevent another account
from inheriting an earlier account's phone history. Original recorded loads,
attempted zeroes, skipped sets and notes are retained. An active session remains
local. Conflicting queued edits are retained and can be exported for recovery;
the native app currently reports the conflict instead of offering the web
client's full local/remote merge editor. A concurrent change of weight units
requires export/review in either client; a label-only conflict resolution would
misinterpret the pending loads. Web unit changes now convert stored loads,
bodyweight, hints and targets while retaining completed source values.

## Garmin inside the product

Both interfaces expose connection management, workout previews, a calendar
date, explicit publication approval, recorded-activity review and history
association. The product MCP also exposes `get_garmin_day`,
`get_garmin_activity`, and `publish_garmin_workout` through the same owner grant.
Existing standalone Garmin MCP clients remain supported.

The shared compiler produces Garmin Training API V2 strength workouts with
sets, repetitions, loads in kilograms, rest steps and known exercise mappings.
Description-only mappings are shown before publication. The server journals
before each provider write, persists the created workout ID before scheduling,
and returns the same outcome for a repeated operation ID. An ambiguous response
stays `needs_review`; it is never retried automatically with a new identity.
A successful schedule explicitly says that watch download is not confirmed.

Activity review imports actual FIT active sets with explicit repetitions and
loads. Missing details remain unavailable; planned targets never become
performed sets. The user can import as history only, associate recorded results
with a routine, or link the activity to an existing phone log. Linking preserves
phone performance and removes a separate imported copy. Associations can be
moved or unlinked. Distinct sessions on the same date retain distinct identities.

The day view reports received/absent/permission-denied sleep and HRV availability
and activity references. It currently reads up to 100 records per section and
states when more exist. Full health summaries are available through the product
MCP; richer native/web health charts and in-product section pagination remain
follow-up work. No inferred readiness score is created.

Product disconnect revokes this product's connector grant; it leaves the shared
Auth account's Garmin link intact. Imported training records remain in the
training log. Account deletion cascades product grants, pending consent and
publication journals. The product does not persist a second raw Health/FIT cache.

## Run and verify

```sh
pnpm install --frozen-lockfile
pnpm check:shared
pnpm check:android
pnpm check:garmin
pnpm --dir web lint
pnpm --dir web test
pnpm --dir web build
go test -race ./...
go vet ./...
```

Use `pnpm dev:android` for Metro and `pnpm dev` for web/API development.
`pnpm build:android` exports JavaScript/Hermes assets; an installable APK uses
the app's Expo/Gradle workflow. `FITNESS_QA=1` selects a separate
`app.fivefold.lifts.qa` installation and scheme for local verification. Normal
builds retain `app.fivefold.lifts` and its existing upgrade identity.

## Rollout

1. Deploy the updated Convex schema/functions, including operation receipts,
   against the existing training deployment.
2. Deploy the Go API with its persistent SQLite directory and existing session
   secret. Migration `0005_integrations.sql` creates encrypted integration state.
3. Keep `PUBLIC_URL`/`ORIGIN` on the product's public HTTPS origin.
   `GARMIN_AUTH_ISSUER` defaults to
   `https://auth.aranlucas.workers.dev/api/auth`; `GARMIN_MCP_RESOURCE` defaults to
   `https://garmin-mcp.aranlucas.workers.dev/mcp`. Overrides must identify the
   matching Auth issuer and connector resource.
4. Deploy the Garmin Worker using its existing Auth bindings, Garmin credentials
   and push-delivery secret. Do not change its public resource identity during
   this consolidation.
5. Build Android against the same product API (`EXPO_PUBLIC_API_URL` can override
   the default server). Production updates need the existing signing identity;
   the local QA build is separately installed and debug signed.
6. Connect a real Garmin account, publish one reviewed workout, sync a compatible
   watch, perform it and verify the returned FIT recording. A watch model was
   not required to implement these boundaries; device capability and download
   still require this final hardware check.

See [verification.md](verification.md) for executed checks and their limits, and
[imports.json](imports.json) for the imported source revisions.
