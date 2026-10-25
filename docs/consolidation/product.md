# One fitness product from Fivefold, Set & Signal, and Garmin MCP

Status: published in `aranlucas/set-and-signal-unified` on `main`, including native
account/sync, cached strength routines, account history/progress and built-in
Garmin publishing/reconciliation. This document records the architecture and
intended product direction; [implementation.md](implementation.md) gives the
current scope and remaining rollout work. No production account or training
record has been changed.

The requested outcome is one unified fitness product. Use **Set & Signal** as
the working product name and repository lineage; keep Fivefold's native Android
workout experience and Garmin MCP's integration implementation. Android-first
is confirmed, with web planning and Garmin watch execution as first-class flows.

## Product promise

Plan a session, record what actually happened, and see it alongside the signals
from your watch. The next set remains obvious even without an account or network.

The unified product has four interfaces over one training model:

- **Android:** today's workout, fast set logging, rest, warmups, plate inventory,
  resume after process death, and workout history. Expand the existing native
  logger to support saved routines after its original 5×5 path is preserved.
- **Web:** routine and calendar editing, detailed history and progress, exports,
  account management, and integration management. Retain web workout logging.
- **Garmin watch:** follow a scheduled strength session or record a free-form
  workout; sync the actual result back through the integrated Garmin module.
- **MCP:** the same user's plan, performed training, and authorized Garmin
  context. A program mutation uses the same preview and revision rules as web.

Garmin is a first-class workout destination and data source within the product.
Its connection is optional for users who train only on the phone. A person can train locally
without Garmin or sign-in. Signing in enables synchronization; linking Garmin
adds wearable data and workout execution through Garmin Connect and the watch.

### First release journey

1. An existing Fivefold installation opens and resumes its saved workout.
2. The user can continue offline, or sign in and review the proposed cloud merge.
3. The user plans a workout on web or Android and chooses **Train on phone** or
   **Train on watch**. Both choices use the same dated session and prescription.
4. Phone-led sessions save locally before success is displayed, then sync once
   through a persistent outbox. Existing timers, notifications, and widgets work.
5. Watch-led sessions preview exercises, sets, reps, loads, rest, and the calendar
   date, then publish/schedule through the built-in Garmin connection. The app
   distinguishes accepted, scheduled, awaiting device sync, and recorded states.
6. After watch sync, actual recorded activity/FIT data enters the shared history.
   The user can correct exercise mapping and recorded values. Planned sets never
   substitute for missing watch measurements; an activity without sets still
   appears as a completed activity with strength-detail availability stated.
7. Phone and watch recordings of the same session are linked, counted once, and
   can be unlinked. Free-form watch workouts can be reviewed/imported without
   requiring an earlier scheduled plan.
8. Web and MCP show the shared plan and performed results with original units,
   targets, provenance, notes, and the applicable progression policy.

Watch workout execution and import are first-release requirements, alongside
Garmin sleep/HRV context. Garmin setup lives in the product's connection settings;
users should not need to configure a separate MCP connector to use the watch.

Automatic coaching based on wearable measurements, a new recovery score,
nutrition tracking, an iOS release, and replacing Go/Convex are outside this
first release. Existing training suggestions can remain available with their
current consent and provider configuration.

## What survives from each repository

| Existing product                                    | Preserve                                                                                                                                                                     | Consolidate or retire after replacement works                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sidequest-labs/stronglifts`, product name Fivefold | Expo/Compose Android controls; transactional SQLite logging; active workout recovery; exact rest deadlines; notifications/widgets; plate inventory; explicit 5×5 progression | Separate product onboarding/branding and independent plan/history definitions                                     |
| `aranlucas/set-and-signal`                          | Web planner/log; exercise catalogue; calendars; history/stats; Convex record sync; Go HTTP/MCP; passkeys; import/export; localization                                        | Capacitor-only mobile path once native Android reaches feature parity; duplicated TypeScript training rules       |
| `aranlucas/garmin-mcp`                              | Cloudflare Worker; Health/Activity ingestion; FIT decoding; permissions and deletion handling; Training calls; event delivery                                                | Separate product-facing setup and a separately configured assistant connector once a unified connector has parity |

Keep existing connector endpoints working during migration. Their retirement
requires an explicit client migration rather than a route rename.

## Target architecture

Keep current hosting responsibilities for the first consolidation. The Go
application remains the web/API/MCP application, Convex owns synchronized
training records, and the Garmin Worker owns Garmin ingestion and retained raw
provider data. A monorepo does not require one runtime or one database.

Proposed final repository layout:

```text
set-and-signal/
  apps/
    android/                 # Fivefold Expo app, original Android package retained
    web/                     # Set & Signal React app
    garmin/                  # Existing Garmin Worker and generated provider schemas
  cmd/                       # Existing Go executable composition roots
  internal/
    training/                # Go training implementation and application operations
    httpapi/                 # HTTP and public product MCP transport
    integrations/garmin/      # User-linked connector adapter
    ...                      # Existing identity/operations packages
  packages/
    training/                # Shared pure TypeScript training module
    contracts/               # Versioned wire/backup contracts and parity examples
  convex/                    # Existing training functions, moved with build config
  docs/
```

First import Android under `apps/android` and Garmin under `apps/garmin` while
leaving the existing `web`, `cmd`, and `internal` paths intact. Move web/Convex
only in a later mechanical change so Go embedding, catalogue generation, and
deployment configuration remain reviewable. Preserve source commit provenance
when importing both projects. The end state has one pnpm workspace/lockfile and
separate CI jobs for each deployable application.

Use a private integration checkout initially: Fivefold and Garmin MCP are
private; Set & Signal is public. Publishing the combined tree is a separate
visibility decision. Preserve Set & Signal's AGPL files and Fivefold's 0BSD
attribution; Garmin MCP has no license recorded in the inspected repository
metadata. This audit does not determine relicensing authority.

### Module interfaces

- **Training module:** resolves sessions and prescriptions, commits a completed
  training record, and produces history/progress projections. Web and Android
  consume shared pure TypeScript rules. Go uses the same versioned policy
  definitions and parity examples until any implementation is retired.
- **Sync module:** persists a completion and outbox entry atomically on Android;
  transmits owner-scoped operations; resolves acknowledgements and conflicts.
  Callers do not orchestrate Convex revisions or retry transport requests.
- **Garmin adapter:** publishes/schedules product sessions, retrieves watch-led
  recordings and authorized context, and reconciles their source identities. Provider tokens, pagination,
  and response schemas remain behind this interface.

Do not make the pure training module import React, Expo, Convex clients,
localization runtimes, HTTP handlers, or the Garmin SDK. Return reason codes and
parameters; translate them in each presentation layer.

### Identity and the existing fourth dependency

Garmin MCP depends on the shared `sidequest-labs/auth` application. It verifies
that issuer's access tokens and calls its private `GarminTokens` binding.
Set & Signal currently owns separate SQLite accounts and passkeys; its provider
configuration is Google/GitHub/Apple, not a general-purpose shared-Auth client.

Add an explicit authenticated identity link from the current Set & Signal
account to a shared-Auth `(issuer, subject)`. Require ownership proof through
both sessions; never merge accounts by an equal email address. An Android
sign-in should use the system browser and PKCE and resolve to the same product
owner. Preserve existing Set & Signal owner IDs and passkeys during this phase.

After Garmin consent, the product backend can use the documented Auth token
exchange flow with an operator-provisioned confidential client. A
`workset`-only or identity-only token cannot acquire `garmin:access`. Store any
durable grant only on the server, with revocation/disconnect handling. Do not
copy Garmin refresh-token rotation into Go or expose Garmin credentials to a
client. Shared sign-in and Garmin consent remain separate capabilities even
when they live in one account flow.

Start the adapter with the connector's authenticated MCP client interface,
including bounded read pagination. Extract a smaller server interface later
only if actual usage requires it; avoid creating another Garmin implementation.

The public product MCP remains in the Go application's existing authenticated
transport. Add explicit Garmin-context operations there. Preserve the old
Garmin connector for existing clients until tool, resource, and event parity is
verified; event subscriptions must be recreated or explicitly migrated.

## Shared data rules

| Concept                                             | Authoritative owner             | Required behavior                                                                          |
| --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| Active phone workout and timer                      | That device's SQLite            | Save each edit before acknowledgment; do not replace an active session from another device |
| Hosted routines, schedule, completed training       | Owner-scoped Convex records     | Independent record writes, revision checks, durable client outbox, deletion tombstones     |
| Guest history                                       | Device/browser storage          | Never upload until the user reviews a merge into a signed-in account                       |
| Next weight for an existing Fivefold plan           | Explicit versioned policy state | Preserve current weight, failure count, next A/B, toggles, increment, and bar floor        |
| Garmin summaries, FIT, delivery state               | Existing Garmin Durable Object  | Preserve original source data, current permission checks, disconnect/delete semantics      |
| Link between performed training and Garmin activity | Product integration record      | Keep both source IDs, origin, association method, and user confirmation                    |

### A canonical completed workout

Use a stable product workout ID plus source identity `(provider, sourceId)`.
Include start/end instants, recorded local date and offset when known, routine
and target snapshots, notes, source device, and the policy version used at
completion. Imported records without a reliable timezone must say so; do not
invent an original offset from the machine performing the import.

Each set preserves `completed`, `attempted`, or `skipped`, recorded reps, and
load as `{ value, unit }`. Zero reps is an attempted set. Missing reps or load
remain missing. Preserve imported numerical precision and original source data;
derive canonical conversion values for comparisons without rounding history to
plate increments. Format/round only for display or future prescriptions.

For the initial compatibility implementation, use the currently stable exercise
IDs from Set & Signal's catalogue: squat `0043`, bench `0025`, row `0027`, press
`1456`, and deadlift `0032`. Keep explicit provider mappings; do not rely on
fuzzy name matching during normal synchronization.

An external watch activity is initially its own source record, not a completed
set-based training log. Recorded FIT sets may be imported after review, using
an explicit exercise mapping and provenance. Targets must never stand in for
performed sets.

### Progression compatibility

Create a versioned `fivefold-5x5-v1` policy with Fivefold's exact rules: 5×5,
deadlift 1×5, increase only after every rep succeeds, count only fully attempted
misses, deload after three misses when enabled, floor the 10% deload to the
increment and bar floor, and alternate A/B exactly once on completion. History
deletion does not replay progression. Restore the existing saved policy state.

Retain Set & Signal's existing linear, Greyskull, double, time, and off policies
under their own versions. Existing Set & Signal linear plans keep their current
two-miss rule. A user changes policies deliberately, with a next-load preview.
Both TypeScript clients and the Go MCP response must agree for the selected
policy; sharing TypeScript alone does not remove the Go implementation.

### Deduplication, corrections, and Garmin matching

Synchronize by source identity and operation ID. Do not deduplicate by date:
multiple training sessions on one day are legitimate. Replayed completion
operations cannot append another workout, alternate A/B again, or progress twice.
Deleted records retain tombstones so an offline device cannot resurrect them.

Suggested Garmin matches can use time overlap and sport, but require explicit
confirmation unless a reliable external correlation ID exists. Neither a
scheduled workout nor a timestamp match proves completion. Matching attaches
context without incrementing training count or strength volume twice. Users can
unlink an incorrect match. A standalone Garmin run remains visible as activity
without becoming a strength workout.

Show sleep/HRV/activity fields as received measurements, with source and receipt
times. Support available, not received, permission denied, stale, and disconnected
states. Missing data is not zero. Garmin delivery may arrive later, and Starter
does not provide automatic historical backfill. Do not silently alter next
training weights from wearable data.

## Evidence and consequences

Audited source heads, captured from the local clones:

| Source       | Commit                                     |
| ------------ | ------------------------------------------ |
| Fivefold     | `77449215428276153d3a63f410224d2794d185c5` |
| Set & Signal | `18bf58097836fd27f7ff855e2dcafbd764fa9607` |
| Garmin MCP   | `6f02d05a0056e10f8c3028e5c0e6fddcc0241a30` |

These are static source observations, not results of executing the apps.

| Evidence                                                                                                                         | Finding                                                                                                            | Implementation path                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| E1: Fivefold `src/domain/workout.ts`, `nextPlan` and `finishSession`; `docs/architecture.md`                                     | Explicit mutable policy state, three fully attempted misses, original session units, no replay on history deletion | Preserve a distinct policy and migrate its state before sharing rules                           |
| E2: Set & Signal `web/src/domain/training/progression.ts`, `DELOAD_AFTER` and `readSession`; `internal/training/prescription.go` | Two-miss linear policy and separate web/Go implementations                                                         | Version policies and run shared behavioral examples across all implementations                  |
| E3: Set & Signal `web/src/shared/lib/types.ts`, `Workout`, `RepsSet`, `AppState`; `internal/training/types.go`                   | Historical weights use the profile unit and need a richer provenance/unit contract                                 | Migrate persisted/HTTP/Convex/export contracts together before mixed-unit import                |
| E4: Set & Signal `web/src/features/settings/import-csv.ts`, `mergeImport`                                                        | Existing importer skips every later workout on an occupied date                                                    | Build identity-based migration/sync; do not reuse date deduplication                            |
| E5: Garmin `src/auth.ts`, `cloudflare.config.ts`, README architecture; Set & Signal `internal/config/config.go`                  | Separate identity authorities; Garmin uses external Auth broker                                                    | Add a proven account link and delegated connector grant                                         |
| E6: Garmin `src/mcp.ts`, `src/activity/mcp.ts`, README activity/FIT/events sections                                              | Missing source data and ambiguous schedule delivery have explicit semantics                                        | Keep availability, source attribution, and reviewed activity associations                       |
| E7: Set & Signal `docs/convex.md`, `web/convex/schema.ts`; Fivefold `src/data/storage.ts`                                        | Hosted per-record sync and native transactional logging are both worth preserving                                  | Add native outbox and owner-scoped operations rather than replace either storage implementation |

Source links: [Fivefold architecture](https://github.com/sidequest-labs/stronglifts/blob/77449215428276153d3a63f410224d2794d185c5/docs/architecture.md),
[Set & Signal contracts](https://github.com/aranlucas/set-and-signal/blob/18bf58097836fd27f7ff855e2dcafbd764fa9607/web/src/shared/lib/types.ts),
[Set & Signal progression](https://github.com/aranlucas/set-and-signal/blob/18bf58097836fd27f7ff855e2dcafbd764fa9607/web/src/domain/training/progression.ts),
[Garmin integration](https://github.com/aranlucas/garmin-mcp/blob/6f02d05a0056e10f8c3028e5c0e6fddcc0241a30/README.md).

Continue with the ordered build slices and acceptance criteria in
[implementation.md](implementation.md).
