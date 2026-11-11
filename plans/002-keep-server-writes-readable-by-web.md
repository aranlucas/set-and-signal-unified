# Plan 002: Keep server-side training writes loadable by the web app

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> On a STOP condition, stop and report. When done, update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 89b4879..HEAD -- web/convex/training.ts web/test/app/store/convex.test.ts internal/training internal/httpapi/granular.go internal/httpapi/program_preview.go`
> Then `git apply --check plans/002-reference.patch`. It must apply cleanly.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `89b4879`, 2026-11-11

## Why this matters

The browser loads the **whole** Convex snapshot through the strict Valibot
schema `appStatePatch` (`web/src/shared/lib/schemas.ts:282`). If one record
fails, `TrainingSync.accept` throws `"Invalid training data from Convex"`
(`web/src/app/store/training-sync.ts:236-240`), and the account stays stuck
in "Changes haven't synced" on every web device. Browser and Android commits
are checked per record in `training:commit`. Go writes (every MCP tool, REST
mutation, `/api/workout/import` and `/api/workout/finalize`) use
`training:replace`, which only checks that the state is an object.
Ordinary calls store records the browser rejects:

| Path                                                                                                                 | Stored record                   | Web requirement                             |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------- |
| MCP `log_exercise_sets` for push-ups (`0662`) with no weight (`internal/training/prescription.go:444`)               | reps set without `w`            | `repsSet.w` required (`schemas.ts:111-119`) |
| MCP `log_workout` / `POST /api/workout/import` with timed or bodyweight sets (`repository.go:126-160`)               | set without `w`, or shapeless   | reps, time or cardio shape                  |
| `POST /api/routine(s)` / `set_program` with an exercise lacking `sets` (`internal/httpapi/program_preview.go:69-77`) | `exerciseConfig` without `sets` | `sets` ≥ 1 (`schemas.ts:77`)                |
| `POST /api/settings` `theme`/`accent`/`gifSize` (`internal/httpapi/granular.go:424-426`, only `max=24`)              | e.g. `"system"`, `""`           | picklists (`schemas.ts:257-261`)            |

The sibling repository fixed the same gap in "Keep server-side training writes
loadable by the web app" (aranlucas/set-and-signal#95). This repo's code is
identical at these sites. `plans/002-reference.patch` is that change adapted
here; it applies on `89b4879`.

## Current state

- `web/convex/training.ts` `replace` (≈ line 135): `JSON.parse`, object check,
  `splitState`, then a write without per-record validation. `commit` has the
  per-record checks inline.
- Legacy records already stored must not block unrelated server edits.
  Validate only **new or changed** records.

## Commands you will need

| Purpose       | Command                                                            | Expected |
| ------------- | ------------------------------------------------------------------ | -------- |
| Install       | `pnpm install --frozen-lockfile`                                   | exit 0   |
| Convex tests  | `pnpm --dir web exec vitest run --maxWorkers=1 test/app/store`     | all pass |
| Go training   | `GOMAXPROCS=1 GOGC=50 go test -p 1 ./internal/training`            | `ok`     |
| Go vet        | `go vet ./internal/httpapi ./internal/training`                    | exit 0   |
| httpapi tests | CI (`go test -race ./...`); the test binary OOMs on small machines | pass     |

## Scope

**In scope**: the files in `plans/002-reference.patch`. **Out of scope**: the web
loader itself (plan idea: quarantine bad records instead of rejecting all of them);
Android schemas (plan 005).

## Steps

1. `git apply plans/002-reference.patch`.
   **Verify**: `git diff --stat` shows 10 files.
2. Run the Convex tests.
   **Verify**: all pass. Restore `web/convex/training.ts` from HEAD and re-run:
   `rejects server replacements a browser could not load` must fail with
   `promise resolved "true" instead of rejecting`. Then restore the fix.
   (This was observed when the plan was written.)
3. Run the Go training tests and vet.
   **Verify**: `ok` and exit 0 (both observed when the plan was written).
4. Push, and let CI run `internal/httpapi`.
   `TestRoutineResponsePreservesSanitizedFields` deliberately changes:
   omitted `sets` now stores the web default 3.

## Done criteria

- [ ] Vitest store suite passes; the regression case fails without the fix
- [ ] `go test ./internal/training` ok; CI `go test -race ./...` green
- [ ] `pnpm format:check` and `gofmt -l internal` clean (`internal/exercises/catalog.go` is pre-existing)

## STOP conditions

- The patch doesn't apply (drift). Re-derive it from the sibling PR's diff; don't hand-merge silently.
- CI shows a Go writer whose finalize round-trip now fails `checkRecord`. That
  would stall Android's outbox (`apps/android/src/data/cloud.ts:497-511`), so
  report it instead of loosening the check.

## Maintenance notes

Every new Go writer of training records must produce web-schema shapes. Any
new field in `appState` needs a Go counterpart. Add one MCP fixture per new
shape to the Convex test.
