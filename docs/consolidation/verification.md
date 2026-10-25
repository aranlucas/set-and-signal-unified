# Unified product verification

Verified locally on October 25, 2026, then consolidated into the private
[aranlucas/set-and-signal-unified](https://github.com/aranlucas/set-and-signal-unified)
repository on `main`. All three audited source histories are retained as merge
parents. Application deployments, the live Garmin account, and the existing
Fivefold installation remain unchanged.

## Automated checks

| Check                                                        | Result                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile --ignore-scripts`            | All seven workspace projects resolve from the single lockfile                                    |
| `pnpm check:shared`                                          | Typecheck and 15 tests across four files passed                                                  |
| `pnpm check:android`                                         | Lint, types, formatting, 255 tests across 22 files, React Compiler and CPU/render budgets passed |
| `pnpm build:android`                                         | Production Android JavaScript/Hermes export passed                                               |
| `pnpm --dir web lint`                                        | Strict typed lint and policy checks passed                                                       |
| `pnpm --dir web test`                                        | Catalogue validation and 424 tests across 48 files passed                                        |
| `pnpm --dir web i18n:check`                                  | Extraction was clean; 28 localization/instruction tests passed                                   |
| `pnpm --dir web build`                                       | Frontend and Convex types and production bundle passed                                           |
| `pnpm check:garmin`                                          | API generation, codegen regression, Worker types/lint/formatting and 215 Worker tests passed     |
| `pnpm build:garmin`                                          | Production Worker bundle passed                                                                  |
| `go test -race ./...`                                        | All Go packages passed, including the new connector and OAuth tests                              |
| `go vet ./...`                                               | Passed                                                                                           |
| `go fix -diff ./...`                                         | No modernization changes remaining                                                               |
| `go build -o build/ ./cmd/...`                               | Go executables built                                                                             |
| `pnpm format:check`, `git diff --check`                      | Passed                                                                                           |
| Expo prebuild, bundle embedding, Gradle `:app:assembleDebug` | Standalone arm64 Android QA APK built successfully                                               |

Native CPU gates passed: cold 10,000-session summary p95 was about 2.1 ms
against a 16 ms budget. Render budgets still cover set logging, note input, rest
updates and the existing large-history paths. The settings snapshot accounts
for the added account section. These CPU results are development-machine
measurements, not release-device frame profiling.

## Regression coverage

- A phone save rolls back history, progression, stable source binding and outbox
  together when the queue write fails. Reopening preserves operation identities,
  original pounds, attempted zeroes and skipped sets.
- Pending writes and acknowledgements remain owner scoped. Snapshot reception
  retains queued expected values. A saved cloud plan does not echo into a new
  local edit. A delayed credential read cannot restore a signed-out account.
- Convex operation receipts survive a later deletion. A repeated completion
  cannot recreate the deleted record. Web queues retain their receipt identity
  across reloads, and legacy queues acquire an identity before sending.
- TypeScript and Go preserve Fivefold's three-miss policy, skipped-set behavior,
  original progression unit and replay guard. A per-record receipt also handles
  an older completion retried after a newer workout advanced the plan.
- Web unit changes convert loads, increments, bodyweight, hints and captured
  targets while preserving completed source values. Shared references are not
  converted twice. Stale-unit queued writes conflict instead of silently being
  interpreted in another unit.
- An in-process OAuth/MCP fixture exercises PKCE, one-use/expired consent,
  encrypted owner-bound credentials, refresh persistence, revocation and account
  deletion cleanup. Publication tests restart the service and verify that both
  successful and ambiguous outcomes avoid repeated provider writes.
- FIT review preserves explicit zero-rep attempts, retains original kilograms,
  reports absent data, and keeps unknown exercises explicit. Routine association
  supplies targets without inventing performed sets. Matching, moving a link,
  unlinking and repeated imports preserve one source identity.

## Installed Android and browser checks

A separate `app.fivefold.lifts.qa` app was installed in the Android 15 emulator.
The normal package remains `app.fivefold.lifts`. The QA build includes its
JavaScript bundle and runs with Metro stopped.

The device check opened the new Plan/account screen, started workout A, logged
one set, force-stopped and reopened the app, confirmed that the set and rest
state survived, and saved the partial session. History showed one recorded set
and the remaining skipped sets; the next workout was B and the held squat
weight stayed 45 lb. The final rebuilt QA APK was reinstalled over this same
QA installation without touching the existing Fivefold app.

The web Garmin screen was exercised with a fixture account and intercepted
local API responses. The check previewed sets before approval, rendered a
scheduled response, reviewed actual FIT-set data, associated a partial recording
with a routine, and imported it twice. The resulting state contained one
workout, the actual set, a progression receipt, and the held 60 kg target.
Desktop and mobile screenshots were captured. The browser fixture used an
in-memory store update to isolate rendering; real persistence is exercised by
the Convex and outbox tests above.

## Artifacts and limits

The generated local APK is
`apps/android/artifacts/Set-and-Signal-QA-arm64.apk`. It is debug signed, uses a
separate package/scheme, and is not a production upgrade or store release.
Screenshots and command logs from this run are under
`/tmp/fitness-unification`. Generated native directories, binaries, local
configuration and credentials are not source imports.

Production deployment, a real product/Convex/native login round trip, and a
physical Garmin publish → watch sync → execution → FIT-return cycle remain
unverified. No live Garmin writes were performed. Scheduling confirms Garmin
Connect acceptance, not delivery to every watch model. Current native/web
planned-session watch compilation is for strength workouts; native timed/cardio
recording, richer health charts, and section pagination beyond the displayed
100-record limit are follow-up scope. Unit-change conflicts retain exportable
pending work and require review before merging.

Existing tools emit non-failing ESM/peer/deprecation warnings. The Garmin test
runner warns that the production push-delivery secret is absent; its test
fixtures supply a local fake credential. The unified implementation and rollout
steps are documented in [implementation.md](implementation.md).
