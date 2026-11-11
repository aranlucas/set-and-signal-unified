# Plan 003: Stop one imported plan session from breaking every Go training operation

> **Executor instructions**: Follow this plan step by step and run every
> verification. On a STOP condition, stop and report. When done, update
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 89b4879..HEAD -- internal/training/repository.go internal/training/schedule.go web/src/shared/lib/schemas.ts web/src/features/plan/plan-share.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (it coordinates with 002, since both touch what Go writes back)
- **Category**: bug
- **Planned at**: commit `89b4879`, 2026-11-11

## Why this matters

Go validates the stored schedule on **every load**. `decodeTrainingData`
(`internal/training/repository.go:186`) calls `ValidateSchedule`
(`internal/training/schedule.go:156-161`), which dives into `MCPDaySession`:
`routineId` max 40, `start` must be `15:04`, `label` max 80 (`schedule.go:20-24`).
The web schema allows any strings
(`web/src/shared/lib/schemas.ts:239-243` `daySession`). Plan import copies
`...session` from a shared file without checking it
(`web/src/features/plan/plan-share.ts:290-293`).

One web-stored session with `start: "6:00 AM"` or a long label makes every Go
load fail for that user: MCP tools, AI digest, routine edits, and
`/api/workout/finalize` (500). Android acknowledges a batch only after
finalize succeeds (`apps/android/src/data/cloud.ts:497-511`), so its outbox
retries the head batch forever, and no later phone workout reaches the server.

## Scope

**In scope**: `internal/training/repository.go` (load path),
`internal/training/schedule.go`, `web/src/shared/lib/schemas.ts` (`daySession`),
`web/src/features/plan/plan-share.ts` (import), and their tests
(`internal/training/repository_test.go`, the web plan-share tests under `web/test`).

**Out of scope**: the write-side Go validation for MCP/REST inputs. Keep it strict.

## Steps

1. Add a failing Go test in `repository_test.go`, following
   `TestTrainingMutationPreservesCustomExerciseSnapshot`:
   `st.WriteState("u1", {"week":{"1":[{"routineId":"r1","start":"6:00 AM"}]}})`,
   then `repo.FinalizeWorkout("u1","missing")` must return nil.
   **Verify**: it fails today with a validation error.
2. Make load tolerant: in `decodeTrainingData`, replace the hard error with a
   normalizer. Drop an invalid `start`, truncate `label` to 80 runes, and drop
   sessions with an empty or over-long `routineId`. Keep `ValidateSchedule` for writes
   (`normalizeWeek` in `internal/httpapi/program_preview.go`, MCP inputs).
   **Verify**: the step 1 test passes; `go test ./internal/training` ok.
3. Align the web: give `daySession` `start: v.optional(v.pipe(v.string(), v.regex(/^([01]\d|2[0-3]):[0-5]\d$/u)))`,
   `label` max 80 and `routineId` max 40. In plan import, drop or trim
   fields that fail. Add a plan-share test for an import with a bad start.
   **Verify**: `pnpm --dir web exec vitest run --maxWorkers=1 test` passes.

## Done criteria

- [ ] New Go and web tests pass; `go test ./internal/training` ok
- [ ] `pnpm --dir web typecheck` exit 0; CI green

## STOP conditions

- Existing stored data uses a non-`HH:MM` `start` format on purpose (check
  `web/src/features/plan` for 12-hour display parsing). If so, report it before
  changing either side.
- tightening `daySession` would reject records already in Convex: the web loader
  rejects the whole snapshot on one bad record. Make the web schema change
  normalize (via `v.fallback`) rather than reject, or stop and report.

## Maintenance notes

Go load paths should normalize and never reject: a load failure takes down
every surface for the user. Write paths stay strict.
