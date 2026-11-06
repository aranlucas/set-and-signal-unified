# Correctness and reliability audit — 2026-11-06

Baseline: remote default `52cefb3` (merged untangle pass). This is a behavior audit;
public interfaces and the established architecture remain the contract. All tests
and builds run in CI only. No production data, accounts or Garmin writes are used.

## Inventory recorded before implementation

| Surface                        | Journeys and boundaries                                                                                                         | Evidence to inspect                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Go HTTP and MCP                | Passkey/OIDC sign-in, cookies versus bearer authorization, admin guards, account-scoped reads and mutations                     | `internal/httpapi`, `internal/auth`, `internal/oauth`, existing protocol tests |
| SQLite identity and operations | Single-use challenges/codes/refresh tokens, registration/invite transactions, disabled users, durable integration journals      | `internal/store`, `internal/garmin`                                            |
| Convex hosted training         | Subject ownership, service-only replacement, optimistic compare-and-swap, operation receipts, validation and record ordering    | `web/convex/training.ts`, `internal/convex/client.go`, Convex tests            |
| Web                            | Sign-in failures, planning/logging/history, local pending queue, storage failures, reconnect/conflict review, account switching | `web/src/app/store`, auth features, Vitest tests                               |
| Shared training                | Units, workout source identities, progression exactly once, Garmin reconciliation                                               | `packages/training`, `internal/training`                                       |
| Android                        | Offline session completion, atomic SQLite history/queue writes, explicit guest import, account switching and token refresh      | `apps/android/src/data`, tests and existing e2e flows                          |
| Garmin Worker                  | OAuth consent and owner isolation, webhook ingestion, FIT handling, scheduling ambiguity and retries                            | `apps/garmin/src`, tests; Go publication journal                               |
| Operations                     | CI gates, embedded web build ordering, isolated fixtures, resource cleanup and network deadlines                                | `.github/workflows`, `cmd`, `.railway`                                         |

## Initial findings and hypotheses

No defect is asserted solely from a pattern. Findings will record realistic
triggers, expected/actual results, confidence, and CI regression evidence.

Rejected initial hypotheses:

- Go OAuth single-use token reads are not a demonstrated concurrent replay:
  the store uses immediate SQLite transactions. Account disabling is also checked
  during bearer verification.
- Garmin ambiguous create/schedule failures are not falsely reported as delivered:
  the durable publication journal records `needs_review` and does not replay writes.
- Web queue acknowledgment storage failure does not erase unacknowledged edits:
  queue persistence precedes replacement of the live queue; durable operation IDs
  make replay safe.
- Hosted full-document replacement is not available to ordinary browser identities:
  the Convex mutation requires the service claim and Go uses revision CAS.

## Framework applicability and validation plan

Published npm metadata verified `e2e` 0.23.0 (tester-army/e2e) and
`@e2e-dev/web` 0.15.5, Node ^22.22.3 or >=24.8.0. Current upstream quickstart,
CI and GitHub Actions documentation were read; deterministic steps need no model
credentials. Android already uses the real e2e/mobile packages; existing flows and
CI applicability are under review. Shared packages and Garmin protocol services
retain meaningful runner coverage; a UI smoke assertion cannot validate those APIs.

CI must preserve existing Go race/vet, Vitest, web build, Android and Garmin gates.
New regressions will include a CI-only defective-baseline reproduction when fixes
are justified. Browser/native journeys will use controlled local fixtures and no
paid agent calls. Validation results remain pending until CI evidence exists.

## Confirmed finding R1 — late Android upload crosses session boundary

High impact, realistic on slow/offline connections, high confidence. In
`apps/android/src/data/cloud.ts:synchronize`, generation was checked before the
awaited Convex mutation but not after it or between awaited finalizations. Sign
out of A and restore/sign into B while A's mutation is pending: the continuation
calls global `cloudApi` with A's workout ID using B's credentials. With the same
workout ID, B's progression can be finalized; without it, A's committed outbox can
remain in an inconsistent state. Expected: stop the stale continuation, retain
A's queue for a safe idempotent retry under A. Fix: check generation after every
network boundary and before acknowledging the batch. Regression: deferred mutation
and deferred first finalization across an account switch, asserting zero B
finalizations and retention of A's pending batch. Independent reviewer identified
and parent confirmed the concrete path before edits.

## Confirmed finding R2 — stale push timer consumes its replacement

Medium impact/likelihood, high confidence. In `internal/push/push.go`, an old
`time.AfterFunc` callback already waiting for the service mutex survives `Stop`.
If the user extends or cancels rest meanwhile, the callback unconditionally
removes the current timer and sends an obsolete alert. A replacement can no
longer be canceled by its owner. Expected: only the currently registered timer
may consume its handle and send. Fix compares timer identity under the mutex.
Regression uses Go's existing synctest clock with a deliberately blocked old
callback; no wall-clock timing assumptions or external push services.

## Implementation and CI scope

R1 is covered in `apps/android/tests/cloud-generation.test.ts` for switches at
both awaited boundaries. R2 is covered by `TestRestTimerDiscardsStaleCallback`
for replacement and cancellation. The reliability workflow restores only the two
defective implementation files from baseline `52cefb3`, runs the new regressions,
and requires their specific assertion failures (not merely any nonzero exit).
The normal CI suites run the fixed implementation independently.

Web e2e drives the supported offline demo bodyweight form, verifies persistence
across full navigation, then converts units and reloads. This is deliberately
scoped evidence for local persistence; it does not claim hosted Convex/passkey
journey coverage. Native e2e builds a disposable release APK on an Android CI
emulator and checks an in-progress set survives process restart without entering
completed history. Existing broader device suites remain preserved. e2e 0.23.0,
web engine 0.15.5 and mobile engine 0.12.6 are pinned in the lockfile; versions and
engine peer requirements were verified against the published npm registry.

The shared training library has no application UI or honest independent browser
journey. Published `e2e/engine` hooks are platform interaction contracts; adding a
custom fake UI/engine would not strengthen protocol coverage. Existing shared
Vitest, Go protocol tests, Convex isolation/CAS tests and Garmin Worker tests remain
required. Garmin's authenticated portal requires the external identity/Garmin
services; no production login or paid provider dependency is introduced.

Validation and final independent implementation review: pending CI/review.

Independent implementation review accepted both production fixes and challenged
the validation code. Corrected all three objections before submission: use the
published screen locator API, enter the auto-guest demo directly and explicitly
reload for persistence assertions, and mock the Convex constructor so session
regressions never open live WebSockets. Existing native selectors were checked
against current UI. No local tests/builds were run; only installation with
`--ignore-scripts`, source inspection, formatting and whitespace checks.
